const { writeDb } = require('../db');
const { json, readBody, safeString, generateId } = require('../helpers');
const { USE_SUPABASE } = require('../config');

// STORY 2.4 — one persistence pattern.
//
// This module used the repository layer; nine other domains manipulated
// db.<collection> directly. Two patterns for the same job is worse than either
// one, so the repository layer was removed and everything now uses the direct
// pattern that the majority already used. See TECHNICAL_DEBT_REPORT.md for why
// that direction (rather than migrating the other nine onto repositories).

// Only what the public site needs. Deliberately narrow: no internal ids beyond
// the one needed for React keys, no timestamps, no inactive members.
function publicStaffMember(m) {
  return {
    id: m.id,
    name: m.name,
    role: m.role,
    bio: m.bio,
    photoUrl: m.photoUrl,
    instagram: m.instagram
  };
}

function publicStaff(db) {
  return (db.staff || [])
    .filter(m => m.active)
    .sort((a, b) => (a.sort || 0) - (b.sort || 0))
    .map(publicStaffMember);
}

async function handleAdminRoutes({ req, res, pathname, db, salonId }) {
  if (!Array.isArray(db.staff)) db.staff = [];

  // CREATE
  if (req.method === 'POST' && pathname === '/api/admin/staff') {
    const body = await readBody(req);
    const name = safeString(body.name, 120);
    if (!name) { json(res, 400, { error: 'El nombre es obligatorio.' }); return true; }

    db.counters.staff = Number(db.counters.staff || 1000) + 1;
    const now = new Date().toISOString();
    const member = {
      id: generateId(USE_SUPABASE, 'stf', db.counters.staff),
      name,
      role: safeString(body.role, 120),
      bio: safeString(body.bio, 600),
      photoUrl: safeString(body.photoUrl, 1000),
      instagram: safeString(body.instagram, 200),
      active: body.active !== false,
      sort: Number.isFinite(Number(body.sort)) && body.sort !== undefined && body.sort !== ''
        ? Number(body.sort)
        : (db.staff.length + 1) * 10,
      createdAt: now,
      updatedAt: now
    };
    db.staff.push(member);

    await writeDb(db, salonId);
    json(res, 201, { member });
    return true;
  }

  const idMatch = pathname.match(/^\/api\/admin\/staff\/([^/]+)$/);

  // UPDATE — partial: only fields actually present in the body are touched, so
  // saving the form without re-picking a photo cannot blank out photoUrl.
  if (req.method === 'PATCH' && idMatch) {
    const body = await readBody(req);
    const patch = {};
    if (body.name !== undefined) patch.name = safeString(body.name, 120);
    if (body.role !== undefined) patch.role = safeString(body.role, 120);
    if (body.bio !== undefined) patch.bio = safeString(body.bio, 600);
    if (body.photoUrl !== undefined) patch.photoUrl = safeString(body.photoUrl, 1000);
    if (body.instagram !== undefined) patch.instagram = safeString(body.instagram, 200);
    if (body.active !== undefined) patch.active = Boolean(body.active);
    if (body.sort !== undefined) patch.sort = Number(body.sort) || 0;

    const member = db.staff.find(m => m.id === idMatch[1]);
    if (!member) { json(res, 404, { error: 'Miembro del equipo no encontrado.' }); return true; }
    Object.assign(member, patch);
    member.updatedAt = new Date().toISOString();

    await writeDb(db, salonId);
    json(res, 200, { member });
    return true;
  }

  // DELETE
  if (req.method === 'DELETE' && idMatch) {
    const before = db.staff.length;
    db.staff = db.staff.filter(m => m.id !== idMatch[1]);
    if (db.staff.length === before) {
      json(res, 404, { error: 'Miembro del equipo no encontrado.' });
      return true;
    }
    await writeDb(db, salonId);
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}

module.exports = { handleAdminRoutes, publicStaff, publicStaffMember };
