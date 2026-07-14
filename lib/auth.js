const crypto = require('crypto');

let SESSION_SECRET = process.env.SESSION_SECRET || '';
if (!SESSION_SECRET || SESSION_SECRET.length < 16) {
  if (process.env.NODE_ENV === 'production') {
    // eslint-disable-next-line no-console
    require('./logger').error(
    'FATAL: missing or too-short SESSION_SECRET. Set a long random value in your host\'s environment variables. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  );
    process.exit(1);
  }
  // Local/dev fallback: generate a random secret for this process only.
  // Sessions won't survive a restart, which is fine for local development.
  SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  // eslint-disable-next-line no-console
  require('./logger').warn('SESSION_SECRET not set — generated a temporary one for this run. Sessions will not survive a restart. Set SESSION_SECRET in production.');
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 8; // 8 hours

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hashHex] = stored.split(':');
  const hash = crypto.scryptSync(String(password), salt, 64);
  const storedBuf = Buffer.from(hashHex, 'hex');
  if (storedBuf.length !== hash.length) return false;
  return crypto.timingSafeEqual(hash, storedBuf);
}

function sign(payloadB64) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payloadB64).digest('base64url');
}

// Stateless session: no server-side session store, so it survives restarts
// and works fine if you ever run more than one instance behind a load balancer.
// Accepts any payload shape — callers decide what fields matter to them
// (e.g. { email } for a login session, { purpose } for a one-off OAuth
// state nonce). Only `exp` is added/managed here.
function createSessionToken(payload) {
  const full = { ...payload, exp: Date.now() + SESSION_TTL_MS };
  const payloadB64 = Buffer.from(JSON.stringify(full)).toString('base64url');
  const signature = sign(payloadB64);
  return `${payloadB64}.${signature}`;
}

function verifySessionToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payloadB64, signature] = token.split('.');
  const expected = sign(payloadB64);
  const sigBuf = Buffer.from(signature || '');
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload.exp || payload.exp < Date.now()) return null;
  return payload; // { salonId, adminId, email, exp }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header.split(';').filter(Boolean).map(pair => {
      const idx = pair.indexOf('=');
      const k = decodeURIComponent(pair.slice(0, idx).trim());
      const v = decodeURIComponent(pair.slice(idx + 1).trim());
      return [k, v];
    })
  );
}

const COOKIE_NAME = 'br_session';

function sessionCookieHeader(token) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

function clearCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function getSessionFromRequest(req) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  return verifySessionToken(token);
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSessionToken,
  verifySessionToken,
  getSessionFromRequest,
  sessionCookieHeader,
  clearCookieHeader
};
