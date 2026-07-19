const { registerBookingNotifications, dispatchWebhook } = require('../domains/notifications');

// Notifications are SECONDARY to the booking. They are deliberately split into
// two phases:
//
//   1. register()  — records notification rows in memory (persisted by writeDb)
//   2. dispatch()  — fires the webhooks, AFTER the transaction is committed
//
// Firing webhooks before the write is committed would mean a failed write could
// leave the salon owner already notified about a booking that doesn't exist.
class NotificationService {
  constructor(db, salonId) {
    this.db = db;
    this.salonId = salonId;
  }

  // Phase 1: returns the dispatches to be fired once the write has landed.
  register(appt, calendarResult = null) {
    return registerBookingNotifications(this.db, appt, calendarResult);
  }

  // Phase 2: fire-and-forget. Never awaited — a slow webhook must not make the
  // client wait for their booking confirmation.
  dispatch(dispatches = []) {
    for (const d of dispatches) {
      dispatchWebhook(this.salonId, d.notificationId, d.webhookUrl, d.payload);
    }
  }
}

module.exports = { NotificationService };
