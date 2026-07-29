// This module is now a thin HTTP layer. The booking WORKFLOW (validation,
// client creation, promos, the atomic slot insert, calendar, notifications)
// lives in lib/services/ — hence the short import list: everything the old
// monolith needed directly is now a dependency of BookingService instead.
const { getService } = require('./services');
const { getAvailability, getVisitAvailability, planVisit, canScheduleVisit, assignStaffForVisit } = require('./availability');
const { publicAppointment } = require('./appointments');
const { clientPreferences } = require('./clients');
const { removeAppointmentFromCalendar } = require('./google-calendar');
const { writeDb } = require('../db');
const slotHolds = require('../slot-holds');
const realtime = require('../realtime');
const { BookingService } = require('../services/booking-service');
const verify = require('./verify');
const { currentClientSession } = require('./client-auth');
const { BookingError } = require('../services/errors');
const { json, readBody, safeString, normalizePhone } = require('../helpers');
const { STATUS_FLOW } = require('../config');

// Public route: GET /api/availability?date=&serviceId=, POST /api/bookings,
// GET /api/rebook?whatsapp= (returning-client quick rebook lookup)
async function handlePublicRoutes({ req, res, pathname, url, db, salonId }) {
  if (req.method === 'GET' && pathname === '/api/availability') {
    const date = safeString(url.searchParams.get('date'), 20);
    // Accepts a single serviceId (legacy) or serviceIds=a,b,c for a visit with
    // several services. Both go through the same visit planner so the times
    // shown always reflect what the client actually selected.
    const idsParam = safeString(url.searchParams.get('serviceIds'), 400);
    const single = safeString(url.searchParams.get('serviceId'), 80);
    const serviceIds = (idsParam ? idsParam.split(',') : [single])
      .map(s => s.trim()).filter(Boolean);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { json(res, 400, { error: 'Valid date is required' }); return true; }
    if (!serviceIds.length || serviceIds.some(id => !getService(db, id))) {
      json(res, 400, { error: 'Valid serviceId is required' }); return true;
    }
    const plan = planVisit(db, serviceIds);
    json(res, 200, {
      date,
      serviceId: serviceIds[0],
      serviceIds,
      // Surfaced so the UI can say "1h 30min en total" and explain when two
      // specialists work at the same time.
      visit: {
        totalMinutes: plan.totalMinutes,
        parallel: plan.areas.length > 1,
        areas: plan.areas.map(a => ({ area: a.area, minutes: a.minutes, services: a.services.map(s => s.name) }))
      },
      slots: getVisitAvailability(db, date, serviceIds, safeString(url.searchParams.get('holder'), 60))
    });
    return true;
  }

  // POST /api/slots/hold — reserve a slot while the client fills the form.
  // Prevents the "picked a time, filled everything, got an error" dead end.
  if (req.method === 'POST' && pathname === '/api/slots/hold') {
    const body = await readBody(req);
    const date = safeString(body.date, 20);
    const time = safeString(body.time, 10);
    const holder = safeString(body.holder, 60);
    const ids = Array.isArray(body.serviceIds) ? body.serviceIds.map(String).filter(Boolean) : [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !time || !holder || !ids.length) {
      json(res, 400, { error: 'Datos incompletos.' }); return true;
    }
    // Releasing first means moving between times never strands the old slot.
    slotHolds.releaseAllFor(holder);

    if (!canScheduleVisit(db, date, time, ids)) {
      json(res, 409, { error: 'Ese horario acaba de ocuparse.', held: false }); return true;
    }
    const areas = planVisit(db, ids).areas.map(a => a.area);
    const ok = slotHolds.hold(date, time, areas, holder);
    if (!ok) { json(res, 409, { error: 'Otra clienta está apartando ese horario.', held: false }); return true; }

    // Tell every other open booking page to refresh its grid immediately.
    realtime.broadcast('availability', { date });
    json(res, 200, { held: true, expiresInMs: slotHolds.HOLD_TTL_MS });
    return true;
  }

  // POST /api/slots/release — client changed their mind or left the step.
  if (req.method === 'POST' && pathname === '/api/slots/release') {
    const body = await readBody(req);
    const holder = safeString(body.holder, 60);
    if (holder) {
      slotHolds.releaseAllFor(holder);
      realtime.broadcast('availability', { date: safeString(body.date, 20) });
    }
    json(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/rebook') {
    const whatsapp = normalizePhone(url.searchParams.get('whatsapp') || '');
    if (whatsapp.length < 8) { json(res, 400, { error: 'Escribe un WhatsApp válido.' }); return true; }
    const client = db.clients.find(c => normalizePhone(c.whatsapp) === whatsapp);
    if (!client) { json(res, 200, { found: false }); return true; }
    const last = db.appointments
      .filter(a => a.clientId === client.id && a.status !== 'deleted')
      .sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`))[0];
    if (!last) { json(res, 200, { found: false }); return true; }
    const service = getService(db, last.serviceId);
    json(res, 200, {
      found: true,
      name: client.name,
      whatsapp: client.whatsapp,
      service: service ? { id: service.id, name: service.name, price: service.price, dur: service.dur, active: service.active } : null,
      preferences: clientPreferences(client)
    });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/bookings') {
    await createBooking({ req, res, db, salonId });
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// HTTP ADAPTER (STORY 3).
//
// This used to be a ~90-line monolith that validated input, created clients,
// resolved promos, inserted the appointment, synced the calendar, registered
// notifications and fired webhooks — all inline.
//
// It is now a thin adapter: read body -> call BookingService -> translate the
// result (or a BookingError) to HTTP. The workflow itself lives in
// lib/services/booking-service.js, which knows nothing about req/res.
//
// The API contract is UNCHANGED — same routes, same request bodies, same
// response shapes, same status codes. The frontend needs no changes.
//
// STORY 4: admin (walk-in / phone / WhatsApp) and customer bookings both route
// through the SAME BookingService.create(). `isAdmin` does not relax any
// validation; it exists only so non-validation concerns can differ later.
/* "10:30" + 45min -> "11:15". Used to stack same-area services back-to-back. */
function addMinutesToTime(time, minutes) {
  const [h, m] = String(time).split(':').map(Number);
  const total = (h * 60 + m) + Number(minutes || 0);
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

async function createBooking({ req, res, db, salonId, isAdmin = false }) {
  const body = await readBody(req);

  // Identity gate (only when REQUIRE_BOOKING_VERIFICATION=true):
  // admin bookings and logged-in clients pass; anonymous visitors must have
  // verified the WhatsApp number they're booking with (br_verify cookie).
  if (!isAdmin && verify.REQUIRE_BOOKING_VERIFICATION) {
    const session = currentClientSession(req);
    if (!session && !verify.isVerifiedForWhatsapp(req, body.whatsapp)) {
      return json(res, 403, {
        error: 'Verifica tu WhatsApp para confirmar la reserva.',
        needVerification: true
      });
    }
  }

  const bookingService = new BookingService(db, salonId);

  /* Multi-service visit (e.g. manicure + pedicure). Each service becomes its
     own appointment — that's what the agenda, the specialists and the
     per-service pricing all need — but they share a groupId so the visit can
     be shown and managed as one thing. Services in different areas start at
     the SAME time (parallel specialists); services in the same area are
     stacked back-to-back because one person does them in sequence. */
  const extraIds = Array.isArray(body.serviceIds)
    ? body.serviceIds.map(String).filter(Boolean)
    : [];
  if (!isAdmin && extraIds.length > 1) {
    if (!canScheduleVisit(db, body.date, body.time, extraIds)) {
      return json(res, 409, { error: 'Ese horario ya no tiene lugar para todos los servicios. Elige otro.' });
    }
    const plan = planVisit(db, extraIds);
    const staffByArea = assignStaffForVisit(db, body.date, extraIds);
    const groupId = `grp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const created = [];
    try {
      for (const areaPlan of plan.areas) {
        // Within an area, services run one after another.
        let cursor = body.time;
        for (const svc of areaPlan.services) {
          const r = await bookingService.create(
            { ...body, serviceId: svc.id, time: cursor },
            { isAdmin }
          );
          const appt = db.appointments.find(a => a.id === r.appointment.id);
          if (appt) {
            appt.groupId = groupId;
            appt.staffId = staffByArea[areaPlan.area] || null;
          }
          created.push(r);
          cursor = addMinutesToTime(cursor, Number(svc.dur || 60));
        }
      }
      await writeDb(db, salonId);
      if (body.holder) slotHolds.releaseAllFor(String(body.holder));
      realtime.broadcast('availability', { date: body.date });
      const first = created[0];
      return json(res, 201, {
        appointment: first.appointment,
        appointments: created.map(c => c.appointment),
        groupId,
        visit: { totalMinutes: plan.totalMinutes, parallel: plan.areas.length > 1 },
        whatsappUrl: first.whatsappUrl,
        addToCalendarUrl: first.addToCalendarUrl,
        clientReminderUrl: first.clientReminderUrl
      });
    } catch (err) {
      if (err instanceof BookingError) return json(res, err.status || 400, { error: err.message });
      throw err;
    }
  }

  try {
    const result = await bookingService.create(body, { isAdmin });
    // Booking landed: drop this browser's hold and tell every other open
    // booking page to refresh, so the slot vanishes for them immediately.
    if (body.holder) slotHolds.releaseAllFor(String(body.holder));
    realtime.broadcast('availability', { date: body.date });
    return json(res, 201, {
      appointment: result.appointment,
      whatsappUrl: result.whatsappUrl,
      addToCalendarUrl: result.addToCalendarUrl,
      clientReminderUrl: result.clientReminderUrl,
      note: result.note
    });
  } catch (err) {
    // BookingError carries the right status (400 validation, 409 slot taken).
    // Anything else is a genuine bug and is rethrown to the server's error
    // handler, which logs the stack and returns a 500 — we must not swallow it.
    if (err instanceof BookingError) {
      return json(res, err.status, { error: err.message });
    }
    throw err;
  }
}

// Admin route: advance/set an appointment's status (new -> confirmed -> ... -> completed, or cancelled).
// Also: POST /api/admin/bookings for manual admin booking creation (Story 21).
async function handleAdminRoutes({ req, res, pathname, url, db, salonId }) {
  if (req.method === 'POST' && pathname === '/api/admin/bookings') {
    await createBooking({ req, res, db, salonId, isAdmin: true });
    return true;
  }

  // Story 14: Weekly agenda — return appointments for a date range
  if (req.method === 'GET' && pathname === '/api/admin/appointments/range') {
    const start = safeString(url.searchParams.get('start'), 20);
    const end = safeString(url.searchParams.get('end'), 20);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      json(res, 400, { error: 'start and end dates required (YYYY-MM-DD).' });
      return true;
    }
    const appointments = db.appointments
      .filter(a => a.date >= start && a.date <= end)
      .map(a => publicAppointment(db, a))
      .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
    json(res, 200, { appointments, start, end });
    return true;
  }

  const apptStatusMatch = pathname.match(/^\/api\/admin\/appointments\/([^/]+)\/status$/);
  if (req.method === 'PATCH' && apptStatusMatch) {
    const appt = db.appointments.find(a => a.id === apptStatusMatch[1]);
    if (!appt) { json(res, 404, { error: 'Cita no encontrada.' }); return true; }
    const body = await readBody(req);
    const next = safeString(body.status, 30) || STATUS_FLOW[(STATUS_FLOW.indexOf(appt.status) + 1) % STATUS_FLOW.length];
    if (![...STATUS_FLOW, 'deleted'].includes(next)) { json(res, 400, { error: 'Estado inválido.' }); return true; }
    if (next === 'deleted' && appt.status !== 'deleted') await removeAppointmentFromCalendar(db, appt);
    appt.status = next;
    // Keep the single linked notification in lock-step with the appointment so
    // the admin board shows one card per reservation, not a growing pile.
    const linked = db.notifications.find(n => n.appointmentId === appt.id && n.kind === 'new_booking');
    if (linked) {
      linked.status = next;
      linked.unread = next === 'new';
      linked.updatedAt = new Date().toISOString();
    }
    await writeDb(db, salonId);
    json(res, 200, { appointment: publicAppointment(db, appt) });
    return true;
  }
  return false;
}

module.exports = { handlePublicRoutes, createBooking, handleAdminRoutes };
