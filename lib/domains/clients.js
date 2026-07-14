const { getService } = require('./services');
const { appointmentPrice } = require('./promotions');
const { appointmentDateTime } = require('./availability');
const { writeDb } = require('../db');
const { json, readBody, safeString, normalizePhone, cleanDateString } = require('../helpers');

function getClient(db, id) {
  return db.clients.find(c => c.id === id);
}

function clientPreferences(client = {}) {
  return {
    styleChoice: client.styleChoice || '',
    colorChoice: client.colorChoice || '',
    drinkChoice: client.drinkChoice || '',
    timePreference: client.timePreference || '',
    notes: client.notes || '',
    allergies: client.allergies || ''
  };
}

function preferenceLines(client = {}) {
  const lines = [];
  if (client.styleChoice) lines.push(`Estilo preferido: ${client.styleChoice}`);
  if (client.colorChoice) lines.push(`Color favorito: ${client.colorChoice}`);
  if (client.drinkChoice) lines.push(`Bebida: ${client.drinkChoice}`);
  if (client.timePreference) lines.push(`Horario preferido: ${client.timePreference}`);
  if (client.allergies) lines.push(`Alergias/cuidados: ${client.allergies}`);
  if (client.notes) lines.push(`Notas: ${client.notes}`);
  return lines;
}

function applyClientProfilePatch(client, body = {}, { allowIdentity = true, onlyNonEmpty = false } = {}) {
  const setText = (field, max = 240) => {
    if (body[field] === undefined) return;
    const value = safeString(body[field], max);
    if (onlyNonEmpty && !value) return;
    client[field] = value;
  };
  if (allowIdentity && body.name !== undefined) setText('name', 120);
  if (allowIdentity && body.whatsapp !== undefined) {
    const phone = normalizePhone(body.whatsapp);
    if (!onlyNonEmpty || phone) client.whatsapp = phone;
  }
  if (body.email !== undefined) setText('email', 160);
  if (body.instagram !== undefined) setText('instagram', 120);
  if (body.birthday !== undefined) {
    const date = cleanDateString(body.birthday);
    if (!onlyNonEmpty || date) client.birthday = date;
  }
  setText('styleChoice', 160);
  setText('colorChoice', 160);
  setText('drinkChoice', 120);
  setText('timePreference', 120);
  setText('allergies', 240);
  setText('notes', 1200);
  client.updatedAt = new Date().toISOString();
  return client;
}

// Lazy require to avoid a circular dependency at module-load time:
// appointments.js needs getClient/clientPreferences from this file, and
// this file needs publicAppointment from appointments.js for the client's
// visit history. By the time any request actually runs, both modules have
// finished loading, so this is safe.
function clientWithStats(db, client) {
  const { publicAppointment } = require('./appointments');
  const allAppointments = db.appointments
    .filter(a => a.clientId === client.id)
    .sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`));
  const activeAppointments = allAppointments.filter(a => a.status !== 'cancelled');
  const now = Date.now();
  const upcoming = activeAppointments
    .filter(a => !['completed', 'cancelled'].includes(a.status) && appointmentDateTime(a).getTime() >= now)
    .sort((a, b) => appointmentDateTime(a) - appointmentDateTime(b));
  const past = activeAppointments
    .filter(a => a.status === 'completed' || appointmentDateTime(a).getTime() < now)
    .sort((a, b) => appointmentDateTime(b) - appointmentDateTime(a));
  const serviceMap = new Map();
  let totalSpent = 0;
  for (const appt of activeAppointments) {
    const service = getService(db, appt.serviceId) || {};
    if (!service.id) continue;
    const current = serviceMap.get(service.id) || { serviceId: service.id, serviceName: service.name || 'Servicio', count: 0, lastDate: '' };
    current.count += 1;
    current.lastDate = [current.lastDate, appt.date].filter(Boolean).sort().reverse()[0] || appt.date;
    serviceMap.set(service.id, current);
    if (appt.status === 'completed') totalSpent += appointmentPrice(db, appt);
  }
  const pastServices = [...serviceMap.values()].sort((a, b) => b.count - a.count || String(b.lastDate).localeCompare(String(a.lastDate)));
  const lastVisit = past[0]?.date || allAppointments[0]?.date || null;
  return {
    ...client,
    preferences: clientPreferences(client),
    visits: activeAppointments.length,
    completedVisits: activeAppointments.filter(a => a.status === 'completed').length,
    cancelledVisits: allAppointments.filter(a => a.status === 'cancelled').length,
    lastVisit,
    nextAppointment: upcoming[0] ? publicAppointment(db, upcoming[0]) : null,
    lastAppointment: past[0] ? publicAppointment(db, past[0]) : null,
    appointmentHistory: allAppointments.map(a => publicAppointment(db, a)),
    pastServices,
    favoriteService: pastServices[0]?.serviceName || '',
    totalSpent
  };
}

// Admin routes: view/edit a single client's profile.
async function handleAdminRoutes({ req, res, pathname, db, salonId }) {
  const clientMatch = pathname.match(/^\/api\/admin\/clients\/([^/]+)$/);
  if (clientMatch) {
    const client = db.clients.find(c => c.id === clientMatch[1]);
    if (!client) { json(res, 404, { error: 'Clienta no encontrada.' }); return true; }
    if (req.method === 'GET') {
      json(res, 200, { client: clientWithStats(db, client) });
      return true;
    }
    if (req.method === 'PATCH') {
      const body = await readBody(req);
      const newPhone = body.whatsapp !== undefined ? normalizePhone(body.whatsapp) : client.whatsapp;
      if (newPhone && db.clients.some(c => c.id !== client.id && normalizePhone(c.whatsapp) === newPhone)) {
        json(res, 409, { error: 'Ya existe otra clienta con ese WhatsApp.' });
        return true;
      }
      applyClientProfilePatch(client, body, { allowIdentity: true, onlyNonEmpty: false });
      if (!client.name || client.name.length < 2) { json(res, 400, { error: 'El nombre de la clienta es obligatorio.' }); return true; }
      if (!client.whatsapp || client.whatsapp.length < 8) { json(res, 400, { error: 'WhatsApp inválido.' }); return true; }
      await writeDb(db, salonId);
      json(res, 200, { client: clientWithStats(db, client) });
      return true;
    }
  }
  return false;
}

module.exports = {
  getClient,
  clientPreferences,
  preferenceLines,
  applyClientProfilePatch,
  clientWithStats,
  handleAdminRoutes
};
