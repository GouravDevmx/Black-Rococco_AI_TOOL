const https = require('https');
const http = require('http');
const { getService } = require('./services');
const { getClient, preferenceLines } = require('./clients');
const { endTimeForAppointment, appointmentDateTime } = require('./availability');
const { publicAppointment } = require('./appointments');
const { adminWhatsAppPhone, clientReminderWhatsAppUrl } = require('./whatsapp');
const { readDb, writeDb } = require('../db');
const { json, safeString, generateId } = require('../helpers');
const {
  USE_SUPABASE, SITE_URL, BUSINESS_TIME_ZONE,
  GOOGLE_CALENDAR_WEBHOOK_URL, WHATSAPP_ADMIN_WEBHOOK_URL, BOOKING_WEBHOOK_URL,
  CLIENT_REMINDER_WEBHOOK_URL, CLIENT_REMINDER_HOURS
} = require('../config');

// Builds the JSON payload sent to Make/Zapier/n8n/custom webhooks for a
// booking event (new booking, or a client reminder at N hours before).
function appointmentAutomationPayload(db, appt, eventName = 'booking.created') {
  const service = getService(db, appt.serviceId) || {};
  const client = getClient(db, appt.clientId) || {};
  const appointment = publicAppointment(db, appt);
  return {
    event: eventName,
    createdAt: new Date().toISOString(),
    siteUrl: SITE_URL,
    businessTimeZone: BUSINESS_TIME_ZONE,
    appointment,
    calendar: {
      title: `Black Rococo - ${service.name || 'Cita'} - ${client.name || 'Clienta'}`,
      start: `${appt.date}T${appt.time}:00`,
      end: `${appt.date}T${endTimeForAppointment(db, appt)}:00`,
      timeZone: BUSINESS_TIME_ZONE,
      location: `${db.settings?.contact?.address1 || ''}, ${db.settings?.contact?.address2 || ''}`.trim(),
      description: [`Folio: ${appt.folio}`, `Clienta: ${client.name || ''}`, `WhatsApp: ${client.whatsapp || ''}`, `Servicio: ${service.name || ''}`, ...preferenceLines({ ...client, ...(appt.preferencesSnapshot || {}) })].join('\n'),
      googleCalendarUrl: appointment.googleCalendarUrl
    },
    whatsapp: {
      adminPhone: adminWhatsAppPhone(db),
      adminMessageUrl: appointment.adminWhatsappUrl,
      clientReminderUrl: appointment.clientReminderUrl
    }
  };
}

function addNotification(db, input) {
  db.counters.notification = Number(db.counters.notification || 1000) + 1;
  const notification = {
    id: generateId(USE_SUPABASE, 'not', db.counters.notification),
    kind: input.kind || 'info',
    channel: input.channel || 'admin_panel',
    title: safeString(input.title, 180),
    message: safeString(input.message, 1000),
    appointmentId: input.appointmentId || null,
    status: input.status || 'unread',
    unread: input.unread !== false,
    actionLabel: input.actionLabel || '',
    actionUrl: input.actionUrl || '',
    error: input.error || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  db.notifications.push(notification);
  return notification;
}

function postJson(webhookUrl, payload, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(webhookUrl);
      const body = JSON.stringify(payload);
      const lib = url.protocol === 'https:' ? https : http;
      const req = lib.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      }, response => {
        response.resume();
        response.on('end', () => {
          if (response.statusCode >= 200 && response.statusCode < 300) resolve({ statusCode: response.statusCode });
          else reject(new Error(`Webhook returned ${response.statusCode}`));
        });
      });
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error('Webhook timeout'));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

async function updateNotificationStatus(salonId, notificationId, status, error = '') {
  try {
    const db = await readDb(salonId);
    const notification = db.notifications.find(n => n.id === notificationId);
    if (!notification) return;
    notification.status = status;
    notification.updatedAt = new Date().toISOString();
    if (error) notification.error = safeString(error, 500);
    await writeDb(db, salonId);
  } catch (_) {}
}

function dispatchWebhook(salonId, notificationId, webhookUrl, payload) {
  if (!webhookUrl) return;
  postJson(webhookUrl, payload)
    .then(() => updateNotificationStatus(salonId, notificationId, 'sent'))
    .catch(err => updateNotificationStatus(salonId, notificationId, 'failed', err.message));
}

// Called right after a booking is created: writes the admin-panel
// notifications and returns any webhook deliveries that still need to be
// fired (the caller dispatches them after the HTTP response is already sent).
function registerBookingNotifications(db, appt, calendarResult = null) {
  const dispatches = [];
  const appointment = publicAppointment(db, appt);
  const basePayload = appointmentAutomationPayload(db, appt, 'booking.created');

  // One notification per booking with all 3 action links packed in.
  let calendarStatus, calendarMsg;
  if (calendarResult?.eventId) {
    calendarStatus = 'sent';
    calendarMsg = 'Evento creado automáticamente en Google Calendar.';
  } else if (calendarResult?.error) {
    calendarStatus = 'failed';
    calendarMsg = 'Error al crear evento — reconecta en Admin → Integraciones.';
  } else {
    calendarStatus = GOOGLE_CALENDAR_WEBHOOK_URL ? 'queued' : 'setup_required';
    calendarMsg = GOOGLE_CALENDAR_WEBHOOK_URL ? 'Evento enviado a webhook de Google Calendar.' : null;
  }

  addNotification(db, {
    kind: 'new_booking',
    channel: 'admin_panel',
    title: `Nueva cita ${appt.folio}`,
    message: `${appointment.clientName} · ${appointment.serviceName} · ${appt.date} ${appt.time}`,
    appointmentId: appt.id,
    status: 'unread',
    actionUrl: JSON.stringify({
      whatsapp: { label: 'WhatsApp clienta', url: appointment.clientReminderUrl },
      calendar: { label: calendarStatus === 'sent' ? 'Ver en Google Calendar' : 'Agregar a Calendar', url: appointment.googleCalendarUrl, status: calendarStatus, message: calendarMsg },
      agenda: { label: 'Ver agenda', url: null }
    }),
    actionLabel: 'multi'
  });

  if (GOOGLE_CALENDAR_WEBHOOK_URL && calendarStatus !== 'sent') {
    dispatches.push({ notificationId: null, webhookUrl: GOOGLE_CALENDAR_WEBHOOK_URL, payload: basePayload });
  }
  if (WHATSAPP_ADMIN_WEBHOOK_URL) {
    dispatches.push({ notificationId: null, webhookUrl: WHATSAPP_ADMIN_WEBHOOK_URL, payload: basePayload });
  }
  if (BOOKING_WEBHOOK_URL) {
    dispatches.push({ notificationId: null, webhookUrl: BOOKING_WEBHOOK_URL, payload: basePayload });
  }

  return dispatches;
}

// Background job (see server.js's setInterval). In Supabase mode, runs once
// per active salon; in local mode, runs against the single JSON file.
async function processClientReminders(salonId) {
  let db;
  const dispatches = [];
  let changed = false;
  try {
    // Scoped read: this job only inspects appointments and writes
    // notifications. Loading every collection (media, posts, courses,
    // clientPhotos, ...) every 10 minutes was pure overhead at scale.
    db = await readDb(salonId, ['appointments', 'services', 'clients', 'notifications']);
  } catch (_) {
    return;
  }
  const now = Date.now();
  for (const appt of db.appointments) {
    if (['cancelled', 'completed'].includes(appt.status)) continue;
    const apptTime = appointmentDateTime(appt).getTime();
    if (!Number.isFinite(apptTime) || apptTime <= now) continue;
    appt.remindersSent = appt.remindersSent || {};
    for (const hoursBefore of CLIENT_REMINDER_HOURS) {
      const key = `${hoursBefore}h`;
      if (appt.remindersSent[key]) continue;
      const dueAt = apptTime - hoursBefore * 60 * 60 * 1000;
      if (now < dueAt) continue;
      const appointment = publicAppointment(db, appt);
      const payload = appointmentAutomationPayload(db, appt, `client.reminder.${key}`);
      payload.reminder = { hoursBefore, dueAt: new Date(dueAt).toISOString() };
      const notification = addNotification(db, {
        kind: 'client_reminder',
        channel: 'client_whatsapp_reminder',
        title: `Recordatorio clienta ${appt.folio}`,
        message: CLIENT_REMINDER_WEBHOOK_URL ? `Recordatorio ${key} programado para ${appointment.clientName}.` : `Falta configurar CLIENT_REMINDER_WEBHOOK_URL. Usa el botón para enviar recordatorio manual a ${appointment.clientName}.`,
        appointmentId: appt.id,
        status: CLIENT_REMINDER_WEBHOOK_URL ? 'queued' : 'setup_required',
        actionLabel: 'Enviar recordatorio',
        actionUrl: clientReminderWhatsAppUrl(db, appt, hoursBefore)
      });
      appt.remindersSent[key] = {
        status: CLIENT_REMINDER_WEBHOOK_URL ? 'queued' : 'setup_required',
        notificationId: notification.id,
        attemptedAt: new Date().toISOString()
      };
      changed = true;
      if (CLIENT_REMINDER_WEBHOOK_URL) {
        dispatches.push({ notificationId: notification.id, webhookUrl: CLIENT_REMINDER_WEBHOOK_URL, payload });
      }
    }
  }
  if (changed) await writeDb(db, salonId);
  for (const d of dispatches) dispatchWebhook(salonId, d.notificationId, d.webhookUrl, d.payload);
}

// Admin routes: mark one/all notifications read, delete one, clear all.
async function handleAdminRoutes({ req, res, pathname, db, salonId }) {
  if (req.method === 'POST' && pathname === '/api/admin/notifications/read-all') {
    for (const notification of db.notifications) {
      notification.unread = false;
      notification.updatedAt = new Date().toISOString();
    }
    await writeDb(db, salonId);
    json(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/admin/notifications/clear-all') {
    db.notifications = [];
    await writeDb(db, salonId);
    json(res, 200, { ok: true });
    return true;
  }

  const notificationDeleteMatch = pathname.match(/^\/api\/admin\/notifications\/([^/]+)$/);
  if (req.method === 'DELETE' && notificationDeleteMatch) {
    const id = notificationDeleteMatch[1];
    // Previously this filtered unconditionally and always returned 200, so
    // deleting a non-existent id reported success. Report 404 instead, in line
    // with every other delete route.
    const before = db.notifications.length;
    db.notifications = db.notifications.filter(n => n.id !== id);
    if (db.notifications.length === before) {
      json(res, 404, { error: 'Notificación no encontrada.' });
      return true;
    }
    await writeDb(db, salonId);
    json(res, 200, { ok: true });
    return true;
  }

  const notificationReadMatch = pathname.match(/^\/api\/admin\/notifications\/([^/]+)\/read$/);
  if (req.method === 'PATCH' && notificationReadMatch) {
    const notification = db.notifications.find(n => n.id === notificationReadMatch[1]);
    if (!notification) { json(res, 404, { error: 'Notificación no encontrada.' }); return true; }
    notification.unread = false;
    notification.updatedAt = new Date().toISOString();
    await writeDb(db, salonId);
    json(res, 200, { notification });
    return true;
  }

  return false;
}

module.exports = {
  appointmentAutomationPayload,
  addNotification,
  postJson,
  updateNotificationStatus,
  dispatchWebhook,
  registerBookingNotifications,
  processClientReminders,
  handleAdminRoutes
};
