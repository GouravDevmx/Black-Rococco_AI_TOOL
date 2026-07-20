// verify.js — WhatsApp OTP verification for bookings & course registrations.
//
// Why: without any identity check, anyone can flood the agenda with fake
// reservations under invented names. This gate requires the person to prove
// they control the WhatsApp number they're booking with.
//
// Design decisions:
//  - OTPs live IN MEMORY (Map), never in the database. They're 10-minute
//    secrets; persisting them adds schema surface for zero benefit. A server
//    restart invalidates pending codes — the user just requests a new one.
//  - Delivery follows the codebase's existing automation pattern: an env-var
//    webhook (OTP_WEBHOOK_URL) that n8n/Make/Zapier turns into a real
//    WhatsApp message. Payload: { type:'otp_verification', whatsapp, code }.
//  - The whole gate is OFF unless REQUIRE_BOOKING_VERIFICATION=true, so
//    deploying this code changes nothing until the delivery webhook is ready.
//  - Logged-in clients skip verification: their account already proves
//    identity (they registered with password + WhatsApp).
//  - Successful verification sets a signed, HttpOnly cookie valid 30 min,
//    scoped to the exact number verified.

const crypto = require('crypto');
const { createSessionToken, verifySessionToken } = require('../auth');
const { json, readBody, safeString } = require('../helpers');

const REQUIRE_BOOKING_VERIFICATION = /^(1|true|yes)$/i.test(process.env.REQUIRE_BOOKING_VERIFICATION || '');
const OTP_WEBHOOK_URL = process.env.OTP_WEBHOOK_URL || '';
const IS_PROD = process.env.NODE_ENV === 'production';

const OTP_TTL_MS = 10 * 60 * 1000;        // code valid 10 min
const VERIFIED_TTL_MS = 30 * 60 * 1000;   // verified cookie valid 30 min
const RESEND_COOLDOWN_MS = 60 * 1000;     // 1 request/min per number
const MAX_SENDS_PER_DAY = 5;
const MAX_ATTEMPTS = 5;

const otps = new Map(); // digits -> { codeHash, expiresAt, attempts, lastSentAt, sends: [ts...] }

function normalizeDigits(value) {
  let d = String(value || '').replace(/\D/g, '');
  // Accept 10-digit MX numbers or already-prefixed international ones.
  if (d.length === 12 && d.startsWith('52')) d = d.slice(2);
  if (d.length === 13 && d.startsWith('521')) d = d.slice(3);
  return d.length === 10 ? d : '';
}

function hashCode(code, digits) {
  return crypto.createHash('sha256').update(`${digits}:${code}`).digest('hex');
}

function postWebhook(payload) {
  if (!OTP_WEBHOOK_URL) return;
  try {
    const url = new URL(OTP_WEBHOOK_URL);
    const mod = url.protocol === 'https:' ? require('https') : require('http');
    const body = JSON.stringify(payload);
    const req = mod.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 5000
    });
    req.on('error', () => {});
    req.on('timeout', () => req.destroy());
    req.write(body);
    req.end();
  } catch (_) { /* delivery failure surfaces as "no llegó el código" — user retries */ }
}

function readVerifyCookie(req) {
  const cookie = req.headers.cookie || '';
  const pair = cookie.split(';').map(v => v.trim()).find(v => v.startsWith('br_verify='));
  if (!pair) return null;
  const token = decodeURIComponent(pair.slice('br_verify='.length));
  const payload = verifySessionToken(token);
  return payload && payload.wa ? payload : null;
}

/* Guard used by bookings.js / courses.js.
   Returns true when the request may proceed for this whatsapp number. */
function isVerifiedForWhatsapp(req, whatsapp) {
  if (!REQUIRE_BOOKING_VERIFICATION) return true;
  const digits = normalizeDigits(whatsapp);
  if (!digits) return false;
  const payload = readVerifyCookie(req);
  return Boolean(payload && payload.wa === digits);
}

async function handlePublicRoutes({ req, res, pathname }) {
  // POST /api/verify/request — send a code to this WhatsApp
  if (req.method === 'POST' && pathname === '/api/verify/request') {
    const body = await readBody(req);
    const digits = normalizeDigits(safeString(body.whatsapp, 30));
    if (!digits) return json(res, 400, { error: 'Escribe un WhatsApp válido de 10 dígitos.' }), true;

    const now = Date.now();
    const entry = otps.get(digits) || { attempts: 0, sends: [] };
    entry.sends = entry.sends.filter(ts => now - ts < 24 * 60 * 60 * 1000);
    if (entry.lastSentAt && now - entry.lastSentAt < RESEND_COOLDOWN_MS) {
      return json(res, 429, { error: 'Espera un minuto antes de pedir otro código.' }), true;
    }
    if (entry.sends.length >= MAX_SENDS_PER_DAY) {
      return json(res, 429, { error: 'Límite de códigos alcanzado por hoy. Escríbenos por WhatsApp.' }), true;
    }

    const code = String(crypto.randomInt(100000, 1000000));
    entry.codeHash = hashCode(code, digits);
    entry.expiresAt = now + OTP_TTL_MS;
    entry.attempts = 0;
    entry.lastSentAt = now;
    entry.sends.push(now);
    otps.set(digits, entry);

    postWebhook({ type: 'otp_verification', whatsapp: digits, code, expiresMinutes: 10 });

    const payload = { ok: true, sent: Boolean(OTP_WEBHOOK_URL) };
    // Dev convenience only: surface the code when no delivery channel exists
    // outside production, so the flow is testable end-to-end locally.
    if (!OTP_WEBHOOK_URL && !IS_PROD) payload.devCode = code;
    if (!OTP_WEBHOOK_URL && IS_PROD) payload.warning = 'OTP_WEBHOOK_URL no configurado; el código no puede entregarse.';
    return json(res, 200, payload), true;
  }

  // POST /api/verify/confirm — exchange code for a verified cookie
  if (req.method === 'POST' && pathname === '/api/verify/confirm') {
    const body = await readBody(req);
    const digits = normalizeDigits(safeString(body.whatsapp, 30));
    const code = safeString(body.code, 10).replace(/\D/g, '');
    if (!digits || code.length !== 6) return json(res, 400, { error: 'Código inválido.' }), true;

    const entry = otps.get(digits);
    if (!entry || !entry.codeHash || Date.now() > entry.expiresAt) {
      return json(res, 400, { error: 'El código expiró. Pide uno nuevo.' }), true;
    }
    entry.attempts += 1;
    if (entry.attempts > MAX_ATTEMPTS) {
      otps.delete(digits);
      return json(res, 429, { error: 'Demasiados intentos. Pide un código nuevo.' }), true;
    }
    if (hashCode(code, digits) !== entry.codeHash) {
      return json(res, 400, { error: 'Código incorrecto. Verifica e intenta de nuevo.' }), true;
    }

    otps.delete(digits);
    const token = createSessionToken({ wa: digits, kind: 'verify' });
    res.setHeader('Set-Cookie',
      `br_verify=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(VERIFIED_TTL_MS / 1000)}${IS_PROD ? '; Secure' : ''}`);
    return json(res, 200, { ok: true, verified: true }), true;
  }

  return false;
}

module.exports = { handlePublicRoutes, isVerifiedForWhatsapp, REQUIRE_BOOKING_VERIFICATION, normalizeDigits };
