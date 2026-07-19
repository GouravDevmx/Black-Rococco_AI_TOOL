const { resolveBookingPromotion } = require('../domains/promotions');
const { BookingError } = require('./errors');

// Owns discount resolution and the usage counter. Deliberately knows nothing
// about HTTP or appointments — it answers one question: "given this service and
// this (optional) code, what does the client actually pay?"
class PromotionService {
  constructor(db) {
    this.db = db;
  }

  /**
   * @throws {BookingError} when the supplied code is invalid/expired/used up.
   */
  resolve(service, promoCode) {
    const resolution = resolveBookingPromotion(this.db, service, promoCode);
    if (resolution.error) throw new BookingError(resolution.error, 400, 'INVALID_PROMO');
    return resolution;
  }

  finalPrice(service, resolution) {
    return resolution.promo ? resolution.finalPrice : service.price;
  }

  // The snapshot stored ON the appointment. Frozen at booking time on purpose:
  // if the promo is later edited or deleted, this appointment must still show
  // the price and terms the client actually agreed to.
  snapshot(service, resolution) {
    if (!resolution.promo) return null;
    const p = resolution.promo;
    return {
      id: p.id,
      code: p.code,
      label: p.label,
      type: p.type,
      value: p.value,
      discountAmount: resolution.discountAmount,
      originalPrice: service.price
    };
  }

  // Only called AFTER the appointment is safely persisted — never speculatively.
  incrementUsage(resolution) {
    if (!resolution.promo) return;
    resolution.promo.usageCount = (resolution.promo.usageCount || 0) + 1;
  }
}

module.exports = { PromotionService };
