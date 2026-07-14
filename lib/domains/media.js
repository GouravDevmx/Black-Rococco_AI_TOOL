const { writeDb } = require('../db');
const { json, readBody, safeString, generateId } = require('../helpers');
const { USE_SUPABASE } = require('../config');

function publicMediaItem(m) {
  return {
    id: m.id,
    kind: m.kind,
    url: m.url,
    posterUrl: m.posterUrl,
    title: m.title,
    description: m.description,
    category: m.category
  };
}

function publicMedia(db) {
  const sorted = db.media.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const gallery = sorted.filter(m => m.showInGallery).map(publicMediaItem);
  const carousel = sorted.filter(m => m.showInCarousel).map(publicMediaItem);
  const categories = [...new Set(gallery.map(m => m.category).filter(Boolean))];
  return { gallery, carousel, categories };
}

// Admin routes: create/edit/delete a media item, and bulk reorder.
async function handleAdminRoutes({ req, res, pathname, db, salonId }) {
  if (req.method === 'POST' && pathname === '/api/admin/media') {
    const body = await readBody(req);
    if (!safeString(body.url, 1000)) { json(res, 400, { error: 'Sube un archivo primero.' }); return true; }
    db.counters.media += 1;
    const media = {
      id: generateId(USE_SUPABASE, 'media', db.counters.media),
      kind: body.kind === 'video' ? 'video' : 'image',
      url: safeString(body.url, 1000),
      posterUrl: safeString(body.posterUrl, 1000),
      title: safeString(body.title, 140),
      description: safeString(body.description, 400),
      category: safeString(body.category, 60),
      order: Number(body.order) || (db.media.length + 1) * 10,
      showInCarousel: Boolean(body.showInCarousel),
      showInGallery: body.showInGallery !== false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.media.push(media);
    await writeDb(db, salonId);
    json(res, 201, { media });
    return true;
  }

  const mediaMatch = pathname.match(/^\/api\/admin\/media\/([^/]+)$/);
  if (mediaMatch) {
    const media = db.media.find(m => m.id === mediaMatch[1]);
    if (!media) { json(res, 404, { error: 'Elemento no encontrado.' }); return true; }
    if (req.method === 'PATCH') {
      const body = await readBody(req);
      if (body.kind !== undefined) media.kind = body.kind === 'video' ? 'video' : 'image';
      if (body.url !== undefined) media.url = safeString(body.url, 1000);
      if (body.posterUrl !== undefined) media.posterUrl = safeString(body.posterUrl, 1000);
      if (body.title !== undefined) media.title = safeString(body.title, 140);
      if (body.description !== undefined) media.description = safeString(body.description, 400);
      if (body.category !== undefined) media.category = safeString(body.category, 60);
      if (body.order !== undefined) media.order = Number(body.order) || media.order;
      if (body.showInCarousel !== undefined) media.showInCarousel = Boolean(body.showInCarousel);
      if (body.showInGallery !== undefined) media.showInGallery = Boolean(body.showInGallery);
      media.updatedAt = new Date().toISOString();
      await writeDb(db, salonId);
      json(res, 200, { media });
      return true;
    }
    if (req.method === 'DELETE') {
      db.media = db.media.filter(m => m.id !== media.id);
      await writeDb(db, salonId);
      json(res, 200, { ok: true });
      return true;
    }
  }

  if (req.method === 'POST' && pathname === '/api/admin/media-reorder') {
    const body = await readBody(req);
    const ids = Array.isArray(body.ids) ? body.ids : [];
    ids.forEach((id, i) => {
      const media = db.media.find(m => m.id === id);
      if (media) media.order = (i + 1) * 10;
    });
    await writeDb(db, salonId);
    json(res, 200, { media: db.media.slice().sort((a, b) => (a.order || 0) - (b.order || 0)) });
    return true;
  }

  return false;
}

module.exports = { publicMediaItem, publicMedia, handleAdminRoutes };
