const crypto = require('crypto');
const { json, readBody, safeString, parseCookies } = require('../helpers');
const { ADMIN_EMAIL, ADMIN_PASSWORD, SESSION_TTL_MS } = require('../config');
// Unified stateless session tokens (HMAC-signed, survive restarts,
// work behind a load balancer). Replaces the previous in-memory
// `sessions` Map that was reset on every deploy.
const { createSessionToken, verifySessionToken } = require('../auth');

// P0: the session cookie was issued WITHOUT the `Secure` flag. On an HTTPS
// deployment (Railway) that means the browser will also send the admin session
// token over plaintext http:// — any downgrade or mixed-content request leaks
// full admin access. Secure is set whenever we're not on localhost.
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || Boolean(process.env.RAILWAY_ENVIRONMENT);

function sessionCookie(token, maxAgeSeconds) {
  const parts = [
    `br_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',            // not readable from JS -> XSS can't steal it
    'SameSite=Lax',        // not sent on cross-site POSTs -> basic CSRF defence
    `Max-Age=${maxAgeSeconds}`
  ];
  if (IS_PRODUCTION) parts.push('Secure'); // HTTPS only
  return parts.join('; ');
}

// Constant-time comparison. A plain `!==` on the password leaks its length and
// prefix through response timing, which is exactly what an offline-free,
// online-brute-force target should not do.
function safeEquals(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // Still burn a comparison so the early-exit doesn't itself leak length.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// Failed-login throttle. Without this, the single admin password can be brute
// forced at network speed. Keyed by IP; window resets on success.
const loginAttempts = new Map();
const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 15 * 60 * 1000;

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function isLockedOut(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.first > LOCKOUT_MS) {
    loginAttempts.delete(ip);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailure(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry || Date.now() - entry.first > LOCKOUT_MS) {
    loginAttempts.set(ip, { count: 1, first: Date.now() });
    return;
  }
  entry.count += 1;
}

// Single admin, env-var credentials, stateless HMAC-signed session token —
// survives restarts and horizontal scaling. Only the lockout map remains
// in-memory (per-instance throttling is acceptable for this deployment).
const SWEEP_MS = 30 * 60 * 1000;
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) {
    if (now - entry.first > LOCKOUT_MS) loginAttempts.delete(ip);
  }
}, SWEEP_MS);
sweeper.unref?.();

function currentSession(req) {
  const token = parseCookies(req).br_session;
  if (!token) return null;
  const payload = verifySessionToken(token);
  if (!payload) return null;
  // Only admin-scoped tokens are accepted here.
  if (payload.role !== 'admin') return null;
  return { email: payload.email, expiresAt: payload.exp };
}

// Gate for every /api/admin/* route.
function requireAdmin(req, res) {
  const session = currentSession(req);
  if (!session) {
    json(res, 401, { error: 'Admin login required' });
    return null;
  }
  return session;
}

// Public routes: login/logout/me. Not behind requireAdmin (obviously —
// login is how you get a session in the first place).
async function handlePublicRoutes({ req, res, pathname }) {
  if (req.method === 'POST' && pathname === '/api/admin/login') {
    const ip = clientIp(req);
    if (isLockedOut(ip)) {
      json(res, 429, { error: 'Demasiados intentos fallidos. Espera 15 minutos e intenta de nuevo.' });
      return true;
    }

    const body = await readBody(req);
    const email = safeString(body.email, 160).toLowerCase();
    const password = String(body.password || '');

    // Both compared in constant time, and both evaluated regardless, so neither
    // the response timing nor the code path reveals which one was wrong.
    const emailOk = safeEquals(email, ADMIN_EMAIL.toLowerCase());
    const passwordOk = safeEquals(password, ADMIN_PASSWORD);

    if (!emailOk || !passwordOk) {
      recordFailure(ip);
      json(res, 401, { error: 'Correo o contraseña incorrectos.' });
      return true;
    }

    loginAttempts.delete(ip); // successful login clears the throttle
    const token = createSessionToken({ role: 'admin', email });
    json(res, 200, { ok: true, email }, {
      'Set-Cookie': sessionCookie(token, Math.floor(SESSION_TTL_MS / 1000))
    });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/admin/logout') {
    // Stateless tokens can't be revoked server-side without a denylist;
    // clearing the cookie is sufficient for the single-admin model here.
    json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/admin/me') {
    const session = currentSession(req);
    json(res, 200, { loggedIn: Boolean(session), email: session?.email || null });
    return true;
  }

  return false;
}

module.exports = { requireAdmin, currentSession, handlePublicRoutes };
