// A domain error carrying the HTTP status the route should surface.
// Services never touch req/res — they throw this, and the thin HTTP adapter in
// lib/domains/bookings.js translates it. That is what keeps the services
// testable without a server and reusable from non-HTTP callers (cron, scripts).
class BookingError extends Error {
  constructor(message, status = 400, code = 'BOOKING_ERROR') {
    super(message);
    this.name = 'BookingError';
    this.status = status;
    this.code = code;
  }
}

// The slot was taken between our pre-check and the atomic insert. 409, not 400:
// the request was well-formed, the world just changed underneath it.
class SlotConflictError extends BookingError {
  constructor(message = 'Ese horario acaba de ocuparse. Elige otro horario.') {
    super(message, 409, 'SLOT_CONFLICT');
    this.name = 'SlotConflictError';
  }
}

module.exports = { BookingError, SlotConflictError };
