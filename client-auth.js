const { writeDb } = require('../db');
const { json, readBody, safeString, generateId } = require('../helpers');
const { USE_SUPABASE } = require('../config');

function getService(db, id) {
  return db.services.find(s => s.id === id);
}

function groupedServices(db, includePaused = false) {
  return db.services
    .filter(s => includePaused || s.active)
    .sort((a, b) => (a.sort || 0) - (b.sort || 0))
    .reduce((acc, service) => {
      if (!acc[service.cat]) acc[service.cat] = [];
      acc[service.cat].push(service);
      return acc;
    }, {});
}

// Admin routes: create/edit/delete a service, toggle "featured" (homepage carousel).
// Called only after requireAdmin() has already passed and `db` has been loaded.
async function handleAdminRoutes({ req, res, pathname, db, salonId }) {
  if (req.method === 'POST' && pathname === '/api/admin/services') {
    const body = await readBody(req);
    if (!safeString(body.name, 140)) { json(res, 400, { error: 'El servicio necesita un nombre.' }); return true; }
    if (!safeString(body.cat, 40)) { json(res, 400, { error: 'El servicio necesita una categoría.' }); return true; }
    db.counters.service = Number(db.counters.service || 1000) + 1;
    const imageUrls = Array.isArray(body.imageUrls) ? body.imageUrls.map(u => safeString(u, 1000)).filter(Boolean).slice(0, 3) : (body.imageUrl ? [safeString(body.imageUrl, 1000)] : []);
    const service = {
      id: generateId(USE_SUPABASE, 'svc', db.counters.service),
      cat: safeString(body.cat, 40).toUpperCase(),
      name: safeString(body.name, 140),
      desc: safeString(body.desc, 500),
      price: Math.max(0, Math.round(Number(body.price) || 0)),
      dur: Math.max(5, Math.round(Number(body.dur) || 30)),
      imageUrl: imageUrls[0] || '',
      imageUrls,
      active: body.active !== false,
      // `Number(body.sort) || default` swallowed a legitimate sort of 0, since
      // 0 is falsy — so a service could never be placed first. Check presence.
      sort: Number.isFinite(Number(body.sort)) && body.sort !== '' && body.sort !== null && body.sort !== undefined
        ? Number(body.sort)
        : (db.services.length + 1) * 10
    };
    db.services.push(service);
    if (body.featured) {
      db.settings.featuredServiceIds = db.settings.featuredServiceIds || [];
      db.settings.featuredServiceIds.push(service.id);
    }
    await writeDb(db, salonId);
    json(res, 201, { service, featuredServiceIds: db.settings.featuredServiceIds || [] });
    return true;
  }

  const serviceMatch = pathname.match(/^\/api\/admin\/services\/([^/]+)$/);
  if (serviceMatch) {
    const service = db.services.find(s => s.id === serviceMatch[1]);
    if (!service) { json(res, 404, { error: 'Servicio no encontrado.' }); return true; }
    if (req.method === 'PATCH') {
      const body = await readBody(req);
      if (body.price !== undefined) service.price = Math.max(0, Math.round(Number(body.price) || 0));
      if (body.active !== undefined) service.active = Boolean(body.active);
      if (body.name !== undefined) service.name = safeString(body.name, 140);
      if (body.desc !== undefined) service.desc = safeString(body.desc, 500);
      if (body.dur !== undefined) service.dur = Math.max(5, Math.round(Number(body.dur) || service.dur));
      if (body.cat !== undefined) service.cat = safeString(body.cat, 40).toUpperCase();
      if (body.imageUrl !== undefined || body.imageUrls !== undefined) {
        const urls = Array.isArray(body.imageUrls) ? body.imageUrls.map(u => safeString(u, 1000)).filter(Boolean).slice(0, 3) : (body.imageUrl ? [safeString(body.imageUrl, 1000)] : service.imageUrls || []);
        service.imageUrls = urls;
        service.imageUrl = urls[0] || '';
      }
      if (body.sort !== undefined) {
        const nextSort = Number(body.sort);
        service.sort = Number.isFinite(nextSort) ? nextSort : service.sort; // 0 is valid
      }
      if (body.featured !== undefined) {
        db.settings.featuredServiceIds = db.settings.featuredServiceIds || [];
        const already = db.settings.featuredServiceIds.includes(service.id);
        if (body.featured && !already) db.settings.featuredServiceIds.push(service.id);
        if (!body.featured && already) db.settings.featuredServiceIds = db.settings.featuredServiceIds.filter(id => id !== service.id);
      }
      await writeDb(db, salonId);
      json(res, 200, { service, featuredServiceIds: db.settings.featuredServiceIds || [] });
      return true;
    }
    if (req.method === 'DELETE') {
      db.services = db.services.filter(s => s.id !== service.id);
      db.settings.featuredServiceIds = (db.settings.featuredServiceIds || []).filter(id => id !== service.id);
      // Drop the deleted service from any promotion that targeted it. Without
      // this, service-scoped promos keep a dangling id forever — harmless to
      // matching (it simply never matches) but it silently rots the data, and a
      // promo can end up scoped to nothing while still looking active.
      for (const promo of db.promotions || []) {
        if (promo.scope === 'services' && Array.isArray(promo.serviceIds) && promo.serviceIds.includes(service.id)) {
          promo.serviceIds = promo.serviceIds.filter(id => id !== service.id);
          promo.updatedAt = new Date().toISOString();
        }
      }
      // NOTE: existing appointments keep their history. Postgres sets their
      // service_id to NULL (schema.sql: on delete set null) and the UI falls
      // back to "Servicio", so past bookings stay visible instead of vanishing.
      await writeDb(db, salonId);
      json(res, 200, { ok: true });
      return true;
    }
  }

  return false;
}

module.exports = { getService, groupedServices, handleAdminRoutes };
