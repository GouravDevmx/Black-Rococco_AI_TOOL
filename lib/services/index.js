// Service layer (EPIC 1 / STORY 3).
//
// Booking responsibilities are split into dedicated, HTTP-agnostic services.
// The route handler in lib/domains/bookings.js is now a thin adapter: it reads
// the body, calls BookingService, and translates BookingError -> HTTP status.
//
//   BookingService      orchestrates the workflow (the ORDER of operations)
//   ClientService       client identity: find-or-create, profile merge
//   PromotionService    discount resolution + usage counting
//   CalendarService     Google Calendar sync
//   NotificationService admin/owner notifications + webhook dispatch
//   WhatsAppService     deep-link construction
//
// None of them import req/res. They can be driven from a cron job or a test
// with no server running.
const { BookingService } = require('./booking-service');
const { ClientService } = require('./client-service');
const { PromotionService } = require('./promotion-service');
const { CalendarService } = require('./calendar-service');
const { NotificationService } = require('./notification-service');
const { WhatsAppService } = require('./whatsapp-service');
const { BookingError, SlotConflictError } = require('./errors');

// Builds the whole service graph for one request.
function services(db, salonId) {
  return {
    booking: new BookingService(db, salonId),
    clients: new ClientService(db, salonId),
    promotions: new PromotionService(db),
    calendar: new CalendarService(db),
    notifications: new NotificationService(db, salonId),
    whatsapp: new WhatsAppService(db)
  };
}

module.exports = {
  services,
  BookingService,
  ClientService,
  PromotionService,
  CalendarService,
  NotificationService,
  WhatsAppService,
  BookingError,
  SlotConflictError
};
