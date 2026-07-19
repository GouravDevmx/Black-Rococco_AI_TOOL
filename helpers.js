const { addNotification } = require('./notifications');
const { adminWhatsAppPhone, whatsappDeepLink } = require('./whatsapp');
const { writeDb } = require('../db');
const { json, readBody, safeString, normalizePhone, cleanDateString, generateId } = require('../helpers');
const { USE_SUPABASE } = require('../config');

// Public route: a visitor registering interest in a course from the
// client-facing Academia screen.
async function handlePublicRoutes({ req, res, pathname, db, salonId }) {
  if (req.method === 'POST' && pathname === '/api/course-registrations') {
    const body = await readBody(req);
    const courseId = safeString(body.courseId, 80);
    const name = safeString(body.name, 120);
    const whatsapp = normalizePhone(body.whatsapp);
    const email = safeString(body.email, 160);
    const notes = safeString(body.notes, 600);
    const course = db.courses.find(c => c.id === courseId);
    if (!course || !course.active) { json(res, 400, { error: 'Selecciona un curso válido.' }); return true; }
    if (name.length < 2) { json(res, 400, { error: 'Escribe tu nombre.' }); return true; }
    if (whatsapp.length < 8) { json(res, 400, { error: 'Escribe un WhatsApp válido.' }); return true; }

    db.counters.registration += 1;
    const registration = {
      id: generateId(USE_SUPABASE, 'reg', db.counters.registration),
      courseId,
      name,
      whatsapp,
      email,
      notes,
      status: 'new',
      createdAt: new Date().toISOString()
    };
    db.courseRegistrations.push(registration);
    addNotification(db, {
      kind: 'course_registration',
      channel: 'admin_panel',
      title: `Nueva inscripción: ${course.title}`,
      message: `${name} se registró en "${course.title}" · WhatsApp: ${whatsapp}`,
      status: 'unread',
      actionLabel: 'Ver academia'
    });
    await writeDb(db, salonId);

    const waMessage = `Hola Black Rococo Academy, quiero confirmar mi inscripción al curso "${course.title}". Mi nombre es ${name}.`;
    json(res, 201, {
      registration,
      whatsappUrl: whatsappDeepLink(adminWhatsAppPhone(db), waMessage),
      note: 'Nuestro equipo confirmará tu lugar por WhatsApp en las próximas horas.'
    });
    return true;
  }
  return false;
}

// Admin routes: create/edit/delete a course, and update a registration's status.
async function handleAdminRoutes({ req, res, pathname, db, salonId }) {
  if (req.method === 'POST' && pathname === '/api/admin/courses') {
    const body = await readBody(req);
    if (!safeString(body.title, 200)) { json(res, 400, { error: 'El curso necesita un título.' }); return true; }
    db.counters.course += 1;
    const course = {
      id: generateId(USE_SUPABASE, 'course', db.counters.course),
      title: safeString(body.title, 200),
      description: safeString(body.description, 1000),
      price: Math.max(0, Math.round(Number(body.price) || 0)),
      duration: safeString(body.duration, 100),
      level: safeString(body.level, 60),
      imageUrls: Array.isArray(body.imageUrls) ? body.imageUrls.map(u => safeString(u, 1000)).filter(Boolean).slice(0, 12) : [],
      capacity: Math.max(0, Math.round(Number(body.capacity) || 0)),
      startDate: cleanDateString(body.startDate),
      active: body.active !== false,
      sort: Number(body.sort) || (db.courses.length + 1) * 10,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.courses.push(course);
    await writeDb(db, salonId);
    json(res, 201, { course });
    return true;
  }

  const courseMatch = pathname.match(/^\/api\/admin\/courses\/([^/]+)$/);
  if (courseMatch) {
    const course = db.courses.find(c => c.id === courseMatch[1]);
    if (!course) { json(res, 404, { error: 'Curso no encontrado.' }); return true; }
    if (req.method === 'PATCH') {
      const body = await readBody(req);
      if (body.title !== undefined) course.title = safeString(body.title, 200);
      if (body.description !== undefined) course.description = safeString(body.description, 1000);
      if (body.price !== undefined) course.price = Math.max(0, Math.round(Number(body.price) || 0));
      if (body.duration !== undefined) course.duration = safeString(body.duration, 100);
      if (body.level !== undefined) course.level = safeString(body.level, 60);
      if (body.imageUrls !== undefined) course.imageUrls = Array.isArray(body.imageUrls) ? body.imageUrls.map(u => safeString(u, 1000)).filter(Boolean).slice(0, 12) : [];
      if (body.capacity !== undefined) course.capacity = Math.max(0, Math.round(Number(body.capacity) || 0));
      if (body.startDate !== undefined) course.startDate = cleanDateString(body.startDate);
      if (body.active !== undefined) course.active = Boolean(body.active);
      if (body.sort !== undefined) course.sort = Number(body.sort) || course.sort;
      course.updatedAt = new Date().toISOString();
      await writeDb(db, salonId);
      json(res, 200, { course });
      return true;
    }
    if (req.method === 'DELETE') {
      db.courses = db.courses.filter(c => c.id !== course.id);
      db.courseRegistrations = db.courseRegistrations.filter(r => r.courseId !== course.id);
      await writeDb(db, salonId);
      json(res, 200, { ok: true });
      return true;
    }
  }

  const registrationMatch = pathname.match(/^\/api\/admin\/course-registrations\/([^/]+)$/);
  if (req.method === 'PATCH' && registrationMatch) {
    const registration = db.courseRegistrations.find(r => r.id === registrationMatch[1]);
    if (!registration) { json(res, 404, { error: 'Inscripción no encontrada.' }); return true; }
    const body = await readBody(req);
    const next = safeString(body.status, 30);
    if (!['new', 'confirmed', 'cancelled'].includes(next)) { json(res, 400, { error: 'Estado inválido.' }); return true; }
    registration.status = next;
    await writeDb(db, salonId);
    json(res, 200, { registration });
    return true;
  }

  return false;
}

module.exports = { handlePublicRoutes, handleAdminRoutes };
