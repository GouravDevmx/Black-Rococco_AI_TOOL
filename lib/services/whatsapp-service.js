const {
  whatsappBookingUrl,
  googleCalendarTemplateUrl,
  clientReminderWhatsAppUrl,
  adminWhatsAppAlertUrl
} = require('../domains/whatsapp');

// Pure URL construction — no network, no side effects. Builds the deep links the
// client and admin tap after a booking is confirmed.
class WhatsAppService {
  constructor(db) {
    this.db = db;
  }

  // "Confirm my booking" link the client taps.
  bookingConfirmationUrl(appt) {
    return whatsappBookingUrl(this.db, appt);
  }

  // "Add to my calendar" link (Google Calendar template URL, not the API).
  addToCalendarUrl(appt) {
    return googleCalendarTemplateUrl(this.db, appt);
  }

  clientReminderUrl(appt, hoursBefore = '') {
    return clientReminderWhatsAppUrl(this.db, appt, hoursBefore);
  }

  adminAlertUrl(appt) {
    return adminWhatsAppAlertUrl(this.db, appt);
  }
}

module.exports = { WhatsAppService };
