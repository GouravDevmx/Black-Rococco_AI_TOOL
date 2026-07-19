const { getService } = require('./services');
const { getClient, preferenceLines } = require('./clients');
const { endTimeForAppointment } = require('./availability');
const { DEFAULT_COUNTRY_DIAL_CODE, WHATSAPP_ADMIN_PHONE, BUSINESS_TIME_ZONE, STATUS_LABELS } = require('../config');

function phoneFromWhatsAppUrl(url) {
  return (String(url || '').match(/phone=([^&]+)/) || [])[1] || '';
}

function normalizeWhatsAppPhoneForLink(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) digits = `${DEFAULT_COUNTRY_DIAL_CODE}${digits}`;
  return digits;
}

function whatsappDeepLink(phone, message) {
  const normalized = normalizeWhatsAppPhoneForLink(phone);
  return `https://api.whatsapp.com/send/?phone=${normalized}&text=${encodeURIComponent(message)}`;
}

function adminWhatsAppPhone(db) {
  return normalizeWhatsAppPhoneForLink(WHATSAPP_ADMIN_PHONE || phoneFromWhatsAppUrl(db.settings?.contact?.whatsappUrl) || db.settings?.contact?.whatsappNumber);
}

function whatsappBookingUrl(db, appt) {
  const client = getClient(db, appt.clientId) || {};
  const service = getService(db, appt.serviceId) || {};
  const msg = `Hola Black Rococo, confirmo mi cita ${appt.folio}: ${service.name} el ${appt.date} a las ${appt.time}. Mi nombre es ${client.name}.`;
  const phone = normalizeWhatsAppPhoneForLink(phoneFromWhatsAppUrl(db.settings?.contact?.whatsappUrl) || db.settings?.contact?.whatsappNumber) || '5213326553522';
  return `https://api.whatsapp.com/send/?phone=${phone}&text=${encodeURIComponent(msg)}`;
}

function compactGoogleDate(date, time) {
  return `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
}

function googleCalendarTemplateUrl(db, appt) {
  const service = getService(db, appt.serviceId) || {};
  const client = getClient(db, appt.clientId) || {};
  const start = compactGoogleDate(appt.date, appt.time);
  const end = compactGoogleDate(appt.date, endTimeForAppointment(db, appt));
  const details = [
    `Folio: ${appt.folio}`,
    `Clienta: ${client.name || ''}`,
    `WhatsApp: ${client.whatsapp || ''}`,
    `Servicio: ${service.name || ''}`,
    `Estado: ${STATUS_LABELS[appt.status] || appt.status}`,
    ...preferenceLines({ ...client, ...(appt.preferencesSnapshot || {}) })
  ].join('\n');
  const location = `${db.settings?.contact?.address1 || ''}, ${db.settings?.contact?.address2 || ''}`.trim();
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Black Rococo - ${service.name || 'Cita'} - ${client.name || 'Clienta'}`,
    dates: `${start}/${end}`,
    ctz: BUSINESS_TIME_ZONE,
    details,
    location
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function adminWhatsAppAlertUrl(db, appt) {
  const service = getService(db, appt.serviceId) || {};
  const client = getClient(db, appt.clientId) || {};
  const prefText = preferenceLines({ ...client, ...(appt.preferencesSnapshot || {}) }).join('\n');
  const msg = `Nueva cita ${appt.folio} en Black Rococo\nClienta: ${client.name || ''}\nWhatsApp: ${client.whatsapp || ''}\nServicio: ${service.name || ''}\nFecha: ${appt.date}\nHora: ${appt.time}\nTotal: $${service.price || 0}${prefText ? `\n${prefText}` : ''}`;
  return whatsappDeepLink(adminWhatsAppPhone(db), msg);
}

function clientReminderWhatsAppUrl(db, appt, hoursBefore = '') {
  const service = getService(db, appt.serviceId) || {};
  const client = getClient(db, appt.clientId) || {};
  const when = hoursBefore ? ` en ${hoursBefore} horas` : '';
  const drink = client.drinkChoice ? `\nTenemos anotada tu bebida favorita: ${client.drinkChoice}.` : '';
  const msg = `Hola ${client.name || ''} ✨ Te recordamos tu cita${when} en Black Rococo.\nServicio: ${service.name || ''}\nFecha: ${appt.date}\nHora: ${appt.time}\nDirección: ${db.settings?.contact?.address1 || ''}, ${db.settings?.contact?.address2 || ''}${drink}\nResponde este mensaje si necesitas ayuda.`;
  return whatsappDeepLink(client.whatsapp, msg);
}

module.exports = {
  phoneFromWhatsAppUrl,
  normalizeWhatsAppPhoneForLink,
  whatsappDeepLink,
  adminWhatsAppPhone,
  whatsappBookingUrl,
  compactGoogleDate,
  googleCalendarTemplateUrl,
  adminWhatsAppAlertUrl,
  clientReminderWhatsAppUrl
};
