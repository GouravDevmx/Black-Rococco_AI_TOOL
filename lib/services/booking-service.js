const { writeDb, insertAppointmentAtomic, markPersisted } = require('../db');
const logger = require('../logger');
const { generateId, normalizePhone, safeString } = require('../helpers');
const { USE_SUPABASE, BUSINESS_TZ_OFFSET } = require('../config');
const { getService } = require('../domains/services');
const { hasOverlap } = require('../domains/availability');
const { publicAppointment } = require('../domains/appointments');

const { BookingError, SlotConflictError } = require('./errors');
const { ClientService } = require('./client-service');
const { PromotionService } = require('./promotion-service');
const { CalendarService } = require('./calendar-service');
const { NotificationService } = require('./notification-service');
const { WhatsAppService } = require('./whatsapp-service');

// ---------------------------------------------------------------------------
// BookingService — the booking WORKFLOW.
//
// This class orchestrates; it does not implement. Client identity lives in
// ClientService, discounts in PromotionService, calendar sync in
// CalendarService, and so on. What lives here is the ORDER things must happen
// in, and which steps are allowed to fail.
//
// The single most important property, and the reason the ordering below is not
// arbitrary:
//
//     A booking that has been confirmed to the client MUST exist.
//
// So the workflow has a hard boundary. Everything before it can reject the
// booking. Everything after it CANNOT — once the appointment row is in
// Postgres, the client has a real appointment, and no failure in notifications,
// calendar sync or promo counters may surface to them as an error.
//
// It is HTTP-agnostic: no req, no res. It throws BookingError (which carries a
// status) and returns plain objects. lib/domains/bookings.js is the thin
// adapter that translates that to HTTP.
// ---------------------------------------------------------------------------
class BookingService {
  constructor(db, salonId) {
    this.db = db;
    this.salonId = salonId;
    this.clients = new ClientService(db, salonId);
    this.promotions = new PromotionService(db);
    this.calendar = new CalendarService(db);
    this.notifications = new NotificationService(db, salonId);
    this.whatsapp = new WhatsAppService(db);
  }

  /**
   * Parses and validates raw input. Pure and synchronous — no I/O, so it is
   * trivially testable and every rejection is cheap.
   *
   * IDENTICAL for customer and admin bookings by design (see `isAdmin` in
   * create()). Do not add an admin bypass here.
   *
   * @throws {BookingError}
   */
  validate(input) {
    const serviceId = safeString(input.serviceId, 80);
    const date = safeString(input.date, 20);
    const time = safeString(input.time, 10);
    const name = safeString(input.name, 120);
    const whatsapp = normalizePhone(input.whatsapp);

    const service = getService(this.db, serviceId);
    if (!service || !service.active) {
      throw new BookingError('Selecciona un servicio válido.', 400, 'INVALID_SERVICE');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BookingError('Selecciona una fecha válida.', 400, 'INVALID_DATE');
    }
    if (!this.db.settings.booking.times.includes(time)) {
      throw new BookingError('Selecciona un horario válido.', 400, 'INVALID_TIME');
    }
    // Compared in the salon's timezone, not the server's — a Railway container
    // running in UTC must not think a 9am Guadalajara slot is already in the past.
    if (new Date(`${date}T${time}:00${BUSINESS_TZ_OFFSET}`).getTime() <= Date.now()) {
      throw new BookingError('Ese horario ya pasó. Elige un horario disponible.', 400, 'PAST_SLOT');
    }
    if (name.length < 2) {
      throw new BookingError('Escribe tu nombre.', 400, 'INVALID_NAME');
    }
    if (whatsapp.length < 8) {
      throw new BookingError('Escribe un WhatsApp válido.', 400, 'INVALID_WHATSAPP');
    }

    return {
      service, serviceId, date, time, name, whatsapp,
      promoCode: input.promoCode,
      profilePatch: {
        styleChoice: input.styleChoice,
        colorChoice: input.colorChoice,
        drinkChoice: input.drinkChoice,
        timePreference: input.timePreference,
        notes: input.notes,
        allergies: input.allergies
      }
    };
  }

  /**
   * Reserves the slot. This is THE transactional boundary (STORY 4).
   *
   * hasOverlap() above is only a fast, friendly pre-check — it can and will lose
   * a race. The real guarantee is the partial unique index in sql/schema.sql on
   * (salon_id, appt_date, appt_time) WHERE status <> 'cancelled'. Postgres
   * itself serializes this, so two simultaneous bookings for the same slot
   * cannot both succeed: one gets a unique violation and is turned into a 409.
   *
   * @throws {SlotConflictError}
   */
  async reserveSlot(apptDraft) {
    if (!USE_SUPABASE) return apptDraft; // local JSON mode: no DB to enforce it

    const inserted = await insertAppointmentAtomic(this.salonId, apptDraft);
    if (inserted.conflict) throw new SlotConflictError();
    return inserted.row;
  }

  buildDraft({ client, service, serviceId, date, time, promoResolution }) {
    this.db.counters.appointment += 1;
    return {
      id: generateId(USE_SUPABASE, 'apt', this.db.counters.appointment),
      folio: `BR-${this.db.counters.appointment}`,
      clientId: client.id,
      serviceId,
      date,
      time,
      // Clients with a deposit on file skip the deposit gate entirely.
      status: client && client.depositOnFile ? 'confirmed' : 'new',
      preferencesSnapshot: this.clients.preferencesSnapshot(client),
      finalPrice: this.promotions.finalPrice(service, promoResolution),
      appliedPromotion: this.promotions.snapshot(service, promoResolution),
      remindersSent: {},
      createdAt: new Date().toISOString()
    };
  }

  /**
   * The full workflow.
   *
   * @param {object} input     raw request body
   * @param {boolean} isAdmin  walk-in/phone booking made by the salon.
   *
   * `isAdmin` does NOT relax any validation — admin and customer bookings run
   * the exact same checks and the exact same atomic insert. It exists only so
   * non-validation concerns (e.g. notification copy) can differ later. If you
   * ever write `if (isAdmin) skip <a validation>`, you have reintroduced the
   * bug this design exists to prevent: an admin double-booking over a customer.
   *
   * @throws {BookingError|SlotConflictError}
   */
  async create(input, { isAdmin = false } = {}) {
    // ---- Phase 1: validate. Cheap, pure, may reject. ----
    const v = this.validate(input);

    // Fast pre-check for a friendly error. Not authoritative — reserveSlot() is.
    if (hasOverlap(this.db, v.date, v.time, v.serviceId)) throw new SlotConflictError();

    // ---- Phase 2: resolve dependencies. May still reject. ----
    const { client } = await this.clients.findOrCreate({
      name: v.name,
      whatsapp: v.whatsapp,
      profilePatch: v.profilePatch
    });
    const promoResolution = this.promotions.resolve(v.service, v.promoCode);

    // ---- Phase 3: COMMIT. The point of no return. ----
    const draft = this.buildDraft({ ...v, client, promoResolution });
    const appt = await this.reserveSlot(draft);
    this.db.appointments.push(appt);
    // Already in Postgres via the atomic insert — fold into the read snapshot so
    // the record-level diff in writeDb() doesn't INSERT it a second time.
    if (USE_SUPABASE) markPersisted(this.db, 'appointments', appt);

    // ================= BOOKING IS NOW REAL =================
    // Past this line the client HAS an appointment. Nothing below may throw to
    // them. A failed webhook must never present as a failed booking.
    // =======================================================
    try {
      const calendarResult = await this.calendar.sync(appt);
      if (calendarResult?.eventId) appt.googleEventId = calendarResult.eventId;

      // Counted only now that the booking is genuinely persisted — never
      // speculatively, or a rejected booking would burn a promo use.
      this.promotions.incrementUsage(promoResolution);

      const dispatches = this.notifications.register(appt, calendarResult);
      await writeDb(this.db, this.salonId);
      // Fired only AFTER the write lands, so we can't notify the owner about a
      // booking that failed to save.
      this.notifications.dispatch(dispatches);
    } catch (err) {
      // The booking itself is already committed and is NOT at risk here. Log
      // loudly so the failure is diagnosable, but never surface it to the client.
      logger.error(
        `Booking ${appt.folio} committed, but a secondary step ` +
        `(notifications/calendar/promo count) failed`,
        err
      );
    }

    return {
      appointment: publicAppointment(this.db, appt),
      whatsappUrl: this.whatsapp.bookingConfirmationUrl(appt),
      addToCalendarUrl: this.whatsapp.addToCalendarUrl(appt),
      clientReminderUrl: this.whatsapp.clientReminderUrl(appt),
      note: this.db.settings.booking.confirmNote,
      isAdmin
    };
  }
}

module.exports = { BookingService };
