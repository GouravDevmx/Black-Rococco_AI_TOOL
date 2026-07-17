// Small, generic utilities with no business meaning of their own — string/
// phone/date sanitizing, HTTP response helpers, cookie parsing. If a bug
// report is about validation quirks (e.g. "phone numbers aren't saving
// right") or response formatting, it's probably in here.

function json(res, status, payload, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(JSON.stringify(payload));
}

function text(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    // Collect raw bytes; decoding chunk-by-chunk with implicit toString()
    // corrupts multi-byte UTF-8 characters that get split across chunk
    // boundaries. Concat once at the end and decode as UTF-8.
    const chunks = [];
    let size = 0;
    const MAX = 1_000_000;
    req.on('data', chunk => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > MAX) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      if (!size) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks, size).toString('utf8')));
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const cookie = req.headers.cookie || '';
  return Object.fromEntries(
    cookie.split(';')
      .map(v => v.trim())
      .filter(Boolean)
      .map(v => {
        const i = v.indexOf('=');
        return [decodeURIComponent(v.slice(0, i)), decodeURIComponent(v.slice(i + 1))];
      })
  );
}

function safeString(value, max = 240) {
  return String(value || '').trim().slice(0, max);
}

function normalizePhone(value) {
  return String(value || '').replace(/[^0-9+]/g, '').slice(0, 24);
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function minutesOfDay(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

function cleanDateString(value) {
  const str = safeString(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(str) ? str : '';
}

function cleanDateStringLoose(value) {
  const str = String(value || '').trim().slice(0, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(str) ? str : '';
}

// New records created through the app need real UUIDs when persisted to
// Supabase (every table's `id` column is `uuid`), but the friendly prefixed
// counter-based ids (e.g. "cli_1001") are kept for local JSON-file mode,
// since that's what local/demo mode has always used.
function generateId(useSupabase, prefix, counterValue) {
  return useSupabase ? require('crypto').randomUUID() : `${prefix}_${counterValue}`;
}

module.exports = {
  json,
  text,
  readBody,
  parseCookies,
  safeString,
  normalizePhone,
  todayYmd,
  minutesOfDay,
  cleanDateString,
  cleanDateStringLoose,
  generateId
};
