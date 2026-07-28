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
  CLIENT_REMINDER_WEBHOOK_URL, CLIENT_REMINDER_HOURS, BIRTHDAY_WEBHOOK_URL
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
    title: `Cita ${appt.folio}`,
    message: `${appointment.clientName} · ${appointment.serviceName} · ${appt.date} ${appt.time}`,
    appointmentId: appt.id,
    // The notification's status tracks the appointment's — this is what drives
    // the Jira-style columns (new / in_progress / paid / closed / deleted).
    status: appt.status || 'new',
    unread: (appt.status || 'new') === 'new',
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
    if (['deleted', 'closed'].includes(appt.status)) continue;
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
      // One card per reservation: a reminder annotates the existing booking
      // notification rather than spawning its own, so the admin board doesn't
      // fill up with duplicate rows for the same appointment.
      const linked = db.notifications.find(n => n.appointmentId === appt.id && n.kind === 'new_booking');
      if (linked) {
        linked.reminderNote = CLIENT_REMINDER_WEBHOOK_URL
          ? `Recordatorio ${key} enviado a ${appointment.clientName}.`
          : `Recordatorio ${key} pendiente para ${appointment.clientName}.`;
        linked.updatedAt = new Date().toISOString();
      }
      appt.remindersSent[key] = {
        status: CLIENT_REMINDER_WEBHOOK_URL ? 'queued' : 'setup_required',
        notificationId: linked ? linked.id : null,
        attemptedAt: new Date().toISOString()
      };
      changed = true;
      if (CLIENT_REMINDER_WEBHOOK_URL) {
        dispatches.push({ notificationId: linked ? linked.id : null, webhookUrl: CLIENT_REMINDER_WEBHOOK_URL, payload });
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

/* Once-a-day-ish birthday greetings. Sends TWO messages via webhook: one to
   the client wishing them happy birthday, and one to the admin as a heads-up.
   Dedupes with a per-year marker on the client so a restart or an extra run in
   the same day can't double-send. Date compared in salon-local terms using the
   stored YYYY-MM-DD birthday (month+day only — year of birth is ignored). */
async function processBirthdays(salonId) {
  let db;
  try {
    db = await readDb(salonId, ['clients', 'notifications']);
  } catch (_) { return; }

  const now = new Date();
  const todayMMDD = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const year = now.getFullYear();
  let changed = false;
  const dispatches = [];

  for (const client of db.clients) {
    if (!client.birthday || client.birthday.length < 5) continue;
    // birthday stored as YYYY-MM-DD; compare month-day only.
    const bMMDD = client.birthday.slice(5, 10);
    if (bMMDD !== todayMMDD) continue;
    if (client.lastBirthdayGreetedYear === year) continue; // already greeted this year

    client.lastBirthdayGreetedYear = year;
    changed = true;

    const firstName = (client.name || '').split(' ')[0] || 'clienta';
    // Admin-panel card (always created, even without a webhook configured).
    addNotification(db, {
      kind: 'birthday',
      channel: 'admin_panel',
      title: `🎂 Cumpleaños de ${client.name}`,
      message: BIRTHDAY_WEBHOOK_URL
        ? `Felicitación enviada automáticamente a ${client.name}.`
        : `Hoy cumple años ${client.name}. Configura BIRTHDAY_WEBHOOK_URL para felicitar automáticamente, o escríbele por WhatsApp.`,
      status: 'new',
      actionLabel: client.whatsapp ? 'Felicitar por WhatsApp' : '',
      actionUrl: client.whatsapp
        ? `https://wa.me/${String(client.whatsapp).replace(/\D/g, '')}?text=${encodeURIComponent(`¡Feliz cumpleaños, ${firstName}! 🎉 De parte de todo el equipo de Black Rococo. 💅`)}`
        : ''
    });

    if (BIRTHDAY_WEBHOOK_URL) {
      // One payload the automation can fan out to client + admin.
      dispatches.push({
        webhookUrl: BIRTHDAY_WEBHOOK_URL,
        payload: {
          event: 'client.birthday',
          client: { name: client.name, firstName, whatsapp: client.whatsapp || '', email: client.email || '' },
          messageToClient: `¡Feliz cumpleaños, ${firstName}! 🎉 Te deseamos un día hermoso. Con cariño, el equipo de Black Rococo. 💅`,
          messageToAdmin: `Hoy es el cumpleaños de ${client.name}${client.whatsapp ? ` (${client.whatsapp})` : ''}.`
        }
      });
    }
  }

  if (changed) await writeDb(db, salonId);
  for (const d of dispatches) dispatchWebhook(salonId, null, d.webhookUrl, d.payload);
}

module.exports = {
  appointmentAutomationPayload,
  addNotification,
  postJson,
  updateNotificationStatus,
  dispatchWebhook,
  registerBookingNotifications,
  processClientReminders,
  processBirthdays,
  handleAdminRoutes
};
