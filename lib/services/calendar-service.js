const { syncAppointmentToCalendar, removeAppointmentFromCalendar } = require('../domains/google-calendar');

// Google Calendar sync. Every method here is SECONDARY to the booking: a
// calendar failure must never fail a booking that already succeeded, so the
// orchestrator calls these inside a try/catch and logs rather than throwing.
class CalendarService {
  constructor(db) {
    this.db = db;
  }

  // Returns { eventId } on success, or null/undefined if calendar isn't
  // configured. Never throws in a way that should reach the client.
  async sync(appt) {
    return syncAppointmentToCalendar(this.db, appt);
  }

  async remove(appt) {
    return removeAppointmentFromCalendar(this.db, appt);
  }
}

module.exports = { CalendarService };
