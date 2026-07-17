const crypto = require('crypto');
const { writeDb } = require('../db');
const { json, readBody, safeString, normalizePhone, generateId } = require('../helpers');
const { hashPassword, verifyPassword, createSessionToken, verifySessionToken } = require('../auth');
const { USE_SUPABASE } = require('../config');
const { publicAppointment } = require('./appointments');

const IS_PRODUCTION = process.env.NODE_ENV === 'production' || Boolean(process.env.RAILWAY_ENVIRONMENT);
const CLIENT_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function clientSessionCookie(token, maxAgeSeconds) {
  const parts = [
    `br_client_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`
  ];
  if (IS_PRODUCTION) parts.push('Secure');
  return parts.join('; ');
}

function parseCookies(req) {
  const cookie = req.headers.cookie || '';
  return Object.fromEntries(
    cookie.split(';').map(v => v.trim()).filter(Boolean)
      .map(v => { const i = v.indexOf('='); return [decodeURIComponent(v.slice(0, i)), decodeURIComponent(v.slice(i + 1))]; })
  );
}

function currentClientSession(req) {
  const token = parseCookies(req).br_client_session;
  if (!token) return null;
  const payload = verifySessionToken(token);
  if (!payload) return null;
  if (payload.role !== 'client') return null;
  return payload;
}

// Rate limiting for client login
const loginAttempts = new Map();
const MAX_ATTEMPTS = 10;
const LOCKOUT_MS = 10 * 60 * 1000;
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) {
    if (now - entry.first > LOCKOUT_MS) loginAttempts.delete(ip);
  }
}, 30 * 60 * 1000);
sweeper.unref?.();

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

async function handlePublicRoutes({ req, res, pathname, db, salonId }) {
  // POST /api/client/register
  if (req.method === 'POST' && pathname === '/api/client/register') {
    const body = await readBody(req);
    const name = safeString(body.name, 120);
    const whatsapp = normalizePhone(body.whatsapp);
    const password = String(body.password || '');

    if (!name) return json(res, 400, { error: 'El nombre es obligatorio.' }), true;
    if (whatsapp.length < 8) return json(res, 400, { error: 'WhatsApp inválido.' }), true;
    if (password.length < 6) return json(res, 400, { error: 'La contraseña debe tener al menos 6 caracteres.' }), true;

    // Check if account already exists
    const existing = db.clientAccounts.find(a => normalizePhone(a.whatsapp) === whatsapp);
    if (existing) {
      return json(res, 409, { error: 'Ya existe una cuenta con ese WhatsApp. Intenta iniciar sesión.' }), true;
    }

    // Find or create the client record
    let client = db.clients.find(c => normalizePhone(c.whatsapp) === whatsapp);
    if (!client) {
      db.counters.client += 1;
      client = {
        id: generateId(USE_SUPABASE, 'cli', db.counters.client),
        name, whatsapp, email: safeString(body.email, 200),
        instagram: '', birthday: '', styleChoice: '', colorChoice: '',
        drinkChoice: '', timePreference: '', notes: '', allergies: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      db.clients.push(client);
    }

    // Create account
    db.counters.clientAccount += 1;
    const account = {
      id: generateId(USE_SUPABASE, 'ca', db.counters.clientAccount),
      clientId: client.id,
      whatsapp,
      passwordHash: hashPassword(password),
      displayName: name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.clientAccounts.push(account);
    await writeDb(db, salonId);

    const token = createSessionToken({
      role: 'client',
      accountId: account.id,
      clientId: client.id,
      whatsapp
    }, CLIENT_SESSION_TTL_MS);

    json(res, 201, {
      ok: true,
      displayName: account.displayName,
      whatsapp: account.whatsapp
    }, {
      'Set-Cookie': clientSessionCookie(token, Math.floor(CLIENT_SESSION_TTL_MS / 1000))
    });
    return true;
  }

  // POST /api/client/login
  if (req.method === 'POST' && pathname === '/api/client/login') {
    const ip = clientIp(req);
    const entry = loginAttempts.get(ip);
    if (entry && entry.count >= MAX_ATTEMPTS && Date.now() - entry.first < LOCKOUT_MS) {
      return json(res, 429, { error: 'Demasiados intentos. Espera 10 minutos.' }), true;
    }

    const body = await readBody(req);
    const whatsapp = normalizePhone(body.whatsapp);
    const password = String(body.password || '');

    if (whatsapp.length < 8) return json(res, 400, { error: 'WhatsApp inválido.' }), true;

    const account = db.clientAccounts.find(a => normalizePhone(a.whatsapp) === whatsapp);
    if (!account || !verifyPassword(password, account.passwordHash)) {
      const e = loginAttempts.get(ip);
      if (!e || Date.now() - e.first > LOCKOUT_MS) loginAttempts.set(ip, { count: 1, first: Date.now() });
      else e.count += 1;
      return json(res, 401, { error: 'WhatsApp o contraseña incorrectos.' }), true;
    }

    loginAttempts.delete(ip);
    const token = createSessionToken({
      role: 'client',
      accountId: account.id,
      clientId: account.clientId,
      whatsapp: account.whatsapp
    }, CLIENT_SESSION_TTL_MS);

    json(res, 200, {
      ok: true,
      displayName: account.displayName,
      whatsapp: account.whatsapp
    }, {
      'Set-Cookie': clientSessionCookie(token, Math.floor(CLIENT_SESSION_TTL_MS / 1000))
    });
    return true;
  }

  // GET /api/client/me
  if (req.method === 'GET' && pathname === '/api/client/me') {
    const session = currentClientSession(req);
    if (!session) return json(res, 200, { loggedIn: false }), true;
    const account = db.clientAccounts.find(a => a.id === session.accountId);
    if (!account) return json(res, 200, { loggedIn: false }), true;
    json(res, 200, {
      loggedIn: true,
      displayName: account.displayName,
      whatsapp: account.whatsapp,
      clientId: account.clientId
    });
    return true;
  }

  // POST /api/client/logout
  if (req.method === 'POST' && pathname === '/api/client/logout') {
    json(res, 200, { ok: true }, {
      'Set-Cookie': clientSessionCookie('', 0)
    });
    return true;
  }

  // GET /api/client/appointments — returns the logged-in client's appointments
  if (req.method === 'GET' && pathname === '/api/client/appointments') {
    const session = currentClientSession(req);
    if (!session) return json(res, 401, { error: 'Inicia sesión para ver tus citas.' }), true;

    const appointments = db.appointments
      .filter(a => a.clientId === session.clientId)
      .map(a => publicAppointment(db, a))
      .sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`));

    json(res, 200, { appointments });
    return true;
  }

  return false;
}

module.exports = { handlePublicRoutes, currentClientSession };
