const { getService } = require('./services');
const { getClient, clientPreferences } = require('./clients');
const { appointmentPrice } = require('./promotions');
const { adminWhatsAppAlertUrl, clientReminderWhatsAppUrl, googleCalendarTemplateUrl } = require('./whatsapp');
const { STATUS_LABELS } = require('../config');

// The single place that turns a stored appointment (just ids + a status)
// into everything a screen actually needs to show: names, current price
// (respecting any promo applied at booking time), and ready-to-click
// WhatsApp/Calendar links. If a field is missing/wrong on any appointment
// anywhere in the app (client screen, admin agenda, client profile
// history), this is where it's assembled.
function publicAppointment(db, appt) {
  const service = getService(db, appt.serviceId) || {};
  const client = getClient(db, appt.clientId) || {};
  return {
    ...appt,
    statusLabel: STATUS_LABELS[appt.status] || appt.status,
    serviceName: service.name || 'Servicio',
    servicePrice: appointmentPrice(db, appt),
    originalServicePrice: service.price || 0,
    appliedPromotion: appt.appliedPromotion || null,
    serviceDuration: service.dur || 0,
    clientName: client.name || 'Clienta',
    clientWhatsapp: client.whatsapp || '',
    clientEmail: client.email || '',
    clientInstagram: client.instagram || '',
    clientPreferences: clientPreferences({ ...client, ...(appt.preferencesSnapshot || {}) }),
    adminWhatsappUrl: adminWhatsAppAlertUrl(db, appt),
    clientReminderUrl: clientReminderWhatsAppUrl(db, appt),
    googleCalendarUrl: googleCalendarTemplateUrl(db, appt)
  };
}

module.exports = { publicAppointment };
