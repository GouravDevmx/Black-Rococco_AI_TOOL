const { writeDb } = require('../db');
const { json, readBody, safeString, generateId } = require('../helpers');
const { USE_SUPABASE } = require('../config');

// Legacy "publish to social" tracker (pre-dates the media library). Still
// used to merge into the homepage's static gallery fallback for backward
// compatibility — see publicSettings() in server.js.
function publicSettings(db) {
  const uploadedGallery = db.posts
    .filter(p => p.imageUrl)
    .slice()
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .map(p => ({ title: p.caption || 'Resultado Black Rococo', imageUrl: p.imageUrl }));
  return {
    ...db.settings,
    gallery: [...uploadedGallery, ...(db.settings.gallery || [])].slice(0, 16)
  };
}

async function handleAdminRoutes({ req, res, pathname, db, salonId }) {
  if (req.method === 'POST' && pathname === '/api/admin/posts') {
    const body = await readBody(req);
    const caption = safeString(body.caption, 1000);
    const imageUrl = safeString(body.imageUrl, 1000);
    const targets = Array.isArray(body.targets) ? body.targets.map(t => safeString(t, 40)).filter(Boolean) : [];
    if (!caption) { json(res, 400, { error: 'La descripción es obligatoria.' }); return true; }
    db.counters.post += 1;
    const post = {
      id: generateId(USE_SUPABASE, 'post', db.counters.post),
      caption,
      imageUrl,
      targets: targets.length ? targets : ['instagram'],
      publishedAt: new Date().toISOString()
    };
    db.posts.push(post);
    await writeDb(db, salonId);
    json(res, 201, { post });
    return true;
  }
  return false;
}

module.exports = { publicSettings, handleAdminRoutes };
