const gcal = require('../googleCalendarClient');
const authLib = require('../auth');
const { getService } = require('./services');
const { getClient } = require('./clients');
const { endTimeForAppointment } = require('./availability');
const { readDb, writeDb } = require('../db');
const { json, text } = require('../helpers');
const { BUSINESS_TIME_ZONE, GOOGLE_CALENDAR_CONFIGURED } = require('../config');

// Called from the booking flow right after an appointment is created.
// Returns { eventId } on success, { error } if connected-but-failed, or
// null if this salon hasn't connected Google Calendar at all (in which
// case the existing webhook/manual-link fallback in notifications.js
// still applies — nothing changes for salons that haven't set this up).
async function syncAppointmentToCalendar(db, appt) {
  const integration = db.settings.googleCalendarIntegration || {};
  if (!integration.connected || !integration.refreshToken) return null;

  try {
    const { access_token } = await gcal.refreshAccessToken(integration.refreshToken);
    const service = getService(db, appt.serviceId) || {};
    const client = getClient(db, appt.clientId) || {};
    const eventBody = {
      summary: `${service.name || 'Cita'} - ${client.name || 'Clienta'}`,
      description: [
        `Folio: ${appt.folio}`,
        `Clienta: ${client.name || ''}`,
        `WhatsApp: ${client.whatsapp || ''}`,
        `Servicio: ${service.name || ''}`
      ].join('\n'),
      start: { dateTime: `${appt.date}T${appt.time}:00`, timeZone: BUSINESS_TIME_ZONE },
      end: { dateTime: `${appt.date}T${endTimeForAppointment(db, appt)}:00`, timeZone: BUSINESS_TIME_ZONE }
    };
    const event = await gcal.insertEvent(access_token, integration.calendarId || 'primary', eventBody);
    return { eventId: event.id };
  } catch (err) {
    return { error: err.message };
  }
}

// Called when an appointment's status changes to 'cancelled', so the
// calendar slot actually frees up instead of staying blocked forever.
async function removeAppointmentFromCalendar(db, appt) {
  const integration = db.settings.googleCalendarIntegration || {};
  if (!integration.connected || !integration.refreshToken || !appt.googleEventId) return;
  try {
    const { access_token } = await gcal.refreshAccessToken(integration.refreshToken);
    await gcal.deleteEvent(access_token, integration.calendarId || 'primary', appt.googleEventId);
  } catch (_) {
    // Non-fatal: worst case, a stale event stays on the calendar and the
    // salon owner deletes it manually. Never let this block a status update.
  }
}

// Admin routes: initiate connection, check status, disconnect.
async function handleAdminRoutes({ req, res, pathname, db, salonId }) {
  if (req.method === 'GET' && pathname === '/api/admin/google-calendar/connect') {
    if (!GOOGLE_CALENDAR_CONFIGURED) {
      json(res, 400, { error: 'Google Calendar no está configurado en este servidor todavía (faltan GOOGLE_OAUTH_CLIENT_ID/SECRET).' });
      return true;
    }
    // Basic CSRF protection on the OAuth round-trip — a signed, short-lived
    // nonce. Single-salon mode: no need to identify which salon this is for.
    const state = authLib.createSessionToken({ purpose: 'google_oauth' });
    res.writeHead(302, { Location: gcal.buildAuthUrl(state) });
    res.end();
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/admin/google-calendar/status') {
    const integration = db.settings.googleCalendarIntegration || {};
    json(res, 200, {
      configured: GOOGLE_CALENDAR_CONFIGURED,
      connected: Boolean(integration.connected),
      email: integration.connectedEmail || '',
      connectedAt: integration.connectedAt || ''
    });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/admin/google-calendar/disconnect') {
    db.settings.googleCalendarIntegration = {};
    await writeDb(db, salonId);
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}

// Public route: Google redirects the browser here after the owner
// approves/denies access. Deliberately NOT behind requireAdmin — the state
// param (created in /connect above) is what verifies this round-trip is
// legitimate, not a session cookie.
async function handleCallbackRoute(req, res, url, salonId) {
  const errorParam = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const session = state ? authLib.verifySessionToken(state) : null;

  if (errorParam || !session || session.purpose !== 'google_oauth') {
    res.writeHead(302, { Location: '/#admin?gcal=denied' });
    res.end();
    return;
  }

  try {
    const tokens = await gcal.exchangeCodeForTokens(code);
    const email = await gcal.getUserEmail(tokens.access_token);
    const db = await readDb(salonId);
    db.settings.googleCalendarIntegration = {
      connected: true,
      refreshToken: tokens.refresh_token,
      calendarId: 'primary',
      connectedEmail: email,
      connectedAt: new Date().toISOString()
    };
    await writeDb(db, salonId);
    res.writeHead(302, { Location: '/#admin?gcal=connected' });
    res.end();
  } catch (err) {
    res.writeHead(302, { Location: '/#admin?gcal=error' });
    res.end();
  }
}

module.exports = {
  syncAppointmentToCalendar,
  removeAppointmentFromCalendar,
  handleAdminRoutes,
  handleCallbackRoute
};
