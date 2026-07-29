// reminders.js — message templating + one-tap confirmation links.
//
// The reminder ENGINE (scheduling, webhook dispatch) lives in notifications.js.
// This module owns the two things that make reminders actually reduce
// no-shows: readable templated messages, and a link the client can tap to
// confirm or cancel without logging in.
//
// Confirmation links are signed, not guessable: the token is an HMAC of the
// appointment id, so a client can't confirm someone else's booking by editing
// a number in the URL, and we don't need a session for a one-tap action.

const crypto = require('crypto');
const { json, readBody, safeString } = require('../helpers');
const { getService } = require('./services');
const { getClient } = require('./clients');
const { writeDb } = require('../db');

const SECRET = process.env.SESSION_SECRET || 'black-rococo-dev-secret';

function confirmToken(appointmentId) {
  return crypto.createHmac('sha256', SECRET)
    .update(`confirm:${appointmentId}`)
    .digest('base64url')
    .slice(0, 22);
}

function confirmUrl(db, appt) {
  const base = (db.settings?.contact?.siteUrl || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return `${base}/confirmar?a=${encodeURIComponent(appt.id)}&t=${confirmToken(appt.id)}`;
}

/* Fill a template. Unknown placeholders are left visible rather than silently
   blanked — a salon proofreading its own message should SEE "{profesionl}" and
   fix the typo, not wonder why the name vanished. */
function renderTemplate(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (whole, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key] ?? '') : whole
  );
}

function templateVars(db, appt) {
  const service = getService(db, appt.serviceId);
  const client = getClient(db, appt.clientId);
  const staff = (db.staff || []).find(s => s.id === appt.staffId);
  const d = new Date(`${appt.date}T${appt.time}:00`);
  const fecha = isNaN(d) ? appt.date : d.toLocaleDateString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long'
  });
  return {
    cliente: (client?.name || '').split(' ')[0] || 'clienta',
    nombre: client?.name || '',
    servicio: service?.name || 'tu servicio',
    fecha,
    hora: appt.time,
    profesional: staff?.name || 'nuestro equipo',
    salon: db.settings?.brand?.name || 'Black Rococo',
    folio: appt.folio || '',
    precio: appt.finalPrice != null ? `$${appt.finalPrice}` : '',
    confirmar: confirmUrl(db, appt)
  };
}

/* Build the outgoing message for a given trigger. Returns null when that
   trigger is switched off, so callers can simply skip. */
function buildMessage(db, appt, trigger) {
  const cfg = db.settings?.reminders;
  if (!cfg || cfg.enabled === false) return null;

  let template = null;
  if (trigger === 'onBooking') {
    if (cfg.onBooking?.enabled === false) return null;
    template = cfg.onBooking?.template;
  } else if (trigger === 'afterVisit') {
    if (!cfg.afterVisit?.enabled) return null;
    template = cfg.afterVisit?.template;
  } else if (typeof trigger === 'number') {
    const rule = (cfg.schedule || []).find(s => Number(s.hoursBefore) === Number(trigger));
    if (!rule || rule.enabled === false) return null;
    template = rule.template;
  }
  if (!template) return null;
  return renderTemplate(template, templateVars(db, appt));
}

/* Public confirmation endpoint. Deliberately does NOT require a session:
   the signed token in the link is the authorisation, so confirming is one tap
   from WhatsApp. */
async function handlePublicRoutes({ req, res, pathname, db, salonId }) {
  // POST /api/appointments/confirm  { appointmentId, token, action }
  if (req.method === 'POST' && pathname === '/api/appointments/confirm') {
    const body = await readBody(req);
    const id = safeString(body.appointmentId, 80);
    const token = safeString(body.token, 40);
    const action = body.action === 'cancel' ? 'cancel' : 'confirm';

    const appt = db.appointments.find(a => a.id === id);
    if (!appt) return json(res, 404, { error: 'No encontramos esa cita.' }), true;
    // Timing-safe compare so the token can't be brute-forced byte by byte.
    const expected = confirmToken(id);
    const ok = token.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
    if (!ok) return json(res, 403, { error: 'Enlace inválido o vencido.' }), true;

    if (['deleted', 'cancelled'].includes(appt.status)) {
      return json(res, 200, { ok: true, status: appt.status, alreadyResolved: true }), true;
    }

    if (action === 'cancel') {
      appt.status = 'deleted';
      appt.clientCancelledAt = new Date().toISOString();
    } else {
      appt.status = 'confirmed';
      appt.clientConfirmedAt = new Date().toISOString();
    }
    // Keep the admin board card in step with the client's own action.
    const linked = (db.notifications || []).find(n => n.appointmentId === appt.id && n.kind === 'new_booking');
    if (linked) {
      linked.status = appt.status;
      linked.reminderNote = action === 'cancel'
        ? 'La clienta canceló desde el recordatorio.'
        : 'La clienta confirmó desde el recordatorio ✓';
      linked.updatedAt = new Date().toISOString();
    }
    await writeDb(db, salonId);
    return json(res, 200, { ok: true, status: appt.status, action }), true;
  }

  // GET /api/appointments/confirm-info?a=..&t=..  — details for the landing page
  if (req.method === 'GET' && pathname === '/api/appointments/confirm-info') {
    const url = new URL(req.url, 'http://localhost');
    const id = safeString(url.searchParams.get('a'), 80);
    const token = safeString(url.searchParams.get('t'), 40);
    const appt = db.appointments.find(a => a.id === id);
    if (!appt || token !== confirmToken(id)) {
      return json(res, 403, { error: 'Enlace inválido.' }), true;
    }
    const v = templateVars(db, appt);
    return json(res, 200, {
      appointment: {
        folio: appt.folio, date: appt.date, time: appt.time, status: appt.status,
        serviceName: v.servicio, clientName: v.nombre, staffName: v.profesional
      }
    }), true;
  }

  return false;
}

module.exports = {
  handlePublicRoutes,
  renderTemplate,
  templateVars,
  buildMessage,
  confirmToken,
  confirmUrl
};
