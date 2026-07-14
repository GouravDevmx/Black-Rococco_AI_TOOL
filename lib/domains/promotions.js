const { getService } = require('./services');
const { writeDb } = require('../db');
const { json, readBody, safeString, cleanDateString, todayYmd, generateId } = require('../helpers');
const { USE_SUPABASE } = require('../config');

function promotionIsWithinWindow(promo, dateStr) {
  if (promo.startDate && dateStr < promo.startDate) return false;
  if (promo.endDate && dateStr > promo.endDate) return false;
  return true;
}

function promotionHasUsage(promo) {
  return promo.usageLimit === 0 || promo.usageCount < promo.usageLimit;
}

function promotionAppliesToService(promo, service) {
  if (!service) return false;
  if (promo.scope === 'all') return true;
  if (promo.scope === 'category') return promo.categoryValue && promo.categoryValue === service.cat;
  if (promo.scope === 'services') return promo.serviceIds.includes(service.id);
  return false;
}

function activePromotions(db, dateStr = todayYmd()) {
  return db.promotions.filter(p => p.active && promotionIsWithinWindow(p, dateStr) && promotionHasUsage(p));
}

function publicPromotion(promo) {
  return {
    id: promo.id,
    label: promo.label,
    title: promo.title,
    note: promo.note,
    type: promo.type,
    value: promo.value,
    scope: promo.scope,
    categoryValue: promo.categoryValue,
    serviceIds: promo.serviceIds,
    autoApply: promo.autoApply,
    imageUrl: promo.imageUrl || '',
    startDate: promo.startDate,
    endDate: promo.endDate
  };
}

function discountAmountFor(service, promo) {
  const price = Number(service.price || 0);
  if (promo.type === 'fixed') return Math.min(price, Math.max(0, promo.value));
  return Math.round(price * (Math.max(0, Math.min(100, promo.value)) / 100));
}

// Picks the best applicable promotion for a booking: an exact code match if
// one was typed, otherwise the best auto-apply promo for that service.
function resolveBookingPromotion(db, service, rawCode) {
  const candidates = activePromotions(db).filter(p => promotionAppliesToService(p, service));
  const code = safeString(rawCode, 40).trim().toUpperCase();
  let promo = null;
  if (code) {
    promo = candidates.find(p => p.code && p.code === code) || null;
    if (!promo) return { error: 'Ese código de promoción no es válido o ya expiró.' };
  } else {
    const autoCandidates = candidates.filter(p => p.autoApply && !p.code);
    promo = autoCandidates.sort((a, b) => discountAmountFor(service, b) - discountAmountFor(service, a))[0] || null;
  }
  if (!promo) return { promo: null };
  const discountAmount = discountAmountFor(service, promo);
  const finalPrice = Math.max(0, Number(service.price || 0) - discountAmount);
  return { promo, discountAmount, finalPrice };
}

function appointmentPrice(db, appt) {
  if (appt.finalPrice != null) return Number(appt.finalPrice);
  const service = getService(db, appt.serviceId) || {};
  return Number(service.price || 0);
}

// Admin routes: create/edit/delete a promotion.
async function handleAdminRoutes({ req, res, pathname, db, salonId }) {
  if (req.method === 'POST' && pathname === '/api/admin/promotions') {
    const body = await readBody(req);
    const type = body.type === 'fixed' ? 'fixed' : 'percent';
    const value = Math.max(0, Number(body.value) || 0);
    const scope = ['all', 'category', 'services'].includes(body.scope) ? body.scope : 'all';
    if (!safeString(body.title, 200)) { json(res, 400, { error: 'La promoción necesita un título.' }); return true; }
    if (value <= 0) { json(res, 400, { error: 'El valor del descuento debe ser mayor a 0.' }); return true; }
    db.counters.promotion += 1;
    const promotion = {
      id: generateId(USE_SUPABASE, 'promo', db.counters.promotion),
      code: safeString(body.code, 40).toUpperCase(),
      label: safeString(body.label, 80) || 'PROMOCIÓN',
      title: safeString(body.title, 200),
      note: safeString(body.note, 300),
      type,
      value,
      scope,
      categoryValue: safeString(body.categoryValue, 40),
      serviceIds: Array.isArray(body.serviceIds) ? body.serviceIds.map(id => safeString(id, 80)).filter(Boolean) : [],
      startDate: cleanDateString(body.startDate),
      endDate: cleanDateString(body.endDate),
      active: body.active !== false,
      autoApply: body.autoApply !== false,
      imageUrl: safeString(body.imageUrl, 1000),
      usageLimit: Math.max(0, Number(body.usageLimit) || 0),
      usageCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.promotions.push(promotion);
    await writeDb(db, salonId);
    json(res, 201, { promotion });
    return true;
  }

  const promotionMatch = pathname.match(/^\/api\/admin\/promotions\/([^/]+)$/);
  if (promotionMatch) {
    const promotion = db.promotions.find(p => p.id === promotionMatch[1]);
    if (!promotion) { json(res, 404, { error: 'Promoción no encontrada.' }); return true; }
    if (req.method === 'PATCH') {
      const body = await readBody(req);
      if (body.code !== undefined) promotion.code = safeString(body.code, 40).toUpperCase();
      if (body.label !== undefined) promotion.label = safeString(body.label, 80);
      if (body.title !== undefined) promotion.title = safeString(body.title, 200);
      if (body.note !== undefined) promotion.note = safeString(body.note, 300);
      if (body.type !== undefined) promotion.type = body.type === 'fixed' ? 'fixed' : 'percent';
      if (body.value !== undefined) promotion.value = Math.max(0, Number(body.value) || 0);
      if (body.scope !== undefined) promotion.scope = ['all', 'category', 'services'].includes(body.scope) ? body.scope : 'all';
      if (body.categoryValue !== undefined) promotion.categoryValue = safeString(body.categoryValue, 40);
      if (body.serviceIds !== undefined) promotion.serviceIds = Array.isArray(body.serviceIds) ? body.serviceIds.map(id => safeString(id, 80)).filter(Boolean) : [];
      if (body.startDate !== undefined) promotion.startDate = cleanDateString(body.startDate);
      if (body.endDate !== undefined) promotion.endDate = cleanDateString(body.endDate);
      if (body.active !== undefined) promotion.active = Boolean(body.active);
      if (body.autoApply !== undefined) promotion.autoApply = Boolean(body.autoApply);
      if (body.imageUrl !== undefined) promotion.imageUrl = safeString(body.imageUrl, 1000);
      if (body.usageLimit !== undefined) promotion.usageLimit = Math.max(0, Number(body.usageLimit) || 0);
      promotion.updatedAt = new Date().toISOString();
      await writeDb(db, salonId);
      json(res, 200, { promotion });
      return true;
    }
    if (req.method === 'DELETE') {
      db.promotions = db.promotions.filter(p => p.id !== promotion.id);
      await writeDb(db, salonId);
      json(res, 200, { ok: true });
      return true;
    }
  }

  return false;
}

module.exports = {
  activePromotions,
  publicPromotion,
  discountAmountFor,
  resolveBookingPromotion,
  appointmentPrice,
  promotionAppliesToService,
  handleAdminRoutes
};
