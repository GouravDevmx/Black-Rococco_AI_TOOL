// This module is now a thin HTTP layer. The booking WORKFLOW (validation,
// client creation, promos, the atomic slot insert, calendar, notifications)
// lives in lib/services/ — hence the short import list: everything the old
// monolith needed directly is now a dependency of BookingService instead.
const { getService } = require('./services');
const { getAvailability } = require('./availability');
const { publicAppointment } = require('./appointments');
const { clientPreferences } = require('./clients');
const { removeAppointmentFromCalendar } = require('./google-calendar');
const { writeDb } = require('../db');
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
    const serviceId = safeString(url.searchParams.get('serviceId'), 80);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { json(res, 400, { error: 'Valid date is required' }); return true; }
    if (!getService(db, serviceId)) { json(res, 400, { error: 'Valid serviceId is required' }); return true; }
    json(res, 200, { date, serviceId, slots: getAvailability(db, date, serviceId) });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/rebook') {
    const whatsapp = normalizePhone(url.searchParams.get('whatsapp') || '');
    if (whatsapp.length < 8) { json(res, 400, { error: 'Escribe un WhatsApp válido.' }); return true; }
    const client = db.clients.find(c => normalizePhone(c.whatsapp) === whatsapp);
    if (!client) { json(res, 200, { found: false }); return true; }
    const last = db.appointments
      .filter(a => a.clientId === client.id && a.status !== 'cancelled')
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

  try {
    const result = await bookingService.create(body, { isAdmin });
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
    if (![...STATUS_FLOW, 'cancelled'].includes(next)) { json(res, 400, { error: 'Estado inválido.' }); return true; }
    if (next === 'cancelled' && appt.status !== 'cancelled') await removeAppointmentFromCalendar(db, appt);
    appt.status = next;
    await writeDb(db, salonId);
    json(res, 200, { appointment: publicAppointment(db, appt) });
    return true;
  }
  return false;
}

module.exports = { handlePublicRoutes, createBooking, handleAdminRoutes };
