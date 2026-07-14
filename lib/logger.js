// ---------------------------------------------------------------------------
// LOGGING  (STORY 1.6)
//
// One place that decides what gets written to the log, so that:
//
//   1. SECRETS NEVER REACH THE LOG. The startup banner used to print
//      `Admin login: <email> / <password>` in plaintext — meaning the admin
//      password was sitting in Railway's deploy log, visible to anyone with
//      dashboard access, and retained in log history indefinitely. Every value
//      that flows through here is scrubbed by redact() as a safety net, so a
//      future careless log line cannot leak a key either.
//
//   2. Production and development differ appropriately. Dev prints friendly
//      hints; production prints structured, timestamped lines and never echoes
//      config values back.
//
//   3. Clients never see internals. Stack traces and Supabase error text are
//      logged server-side but are NOT returned in HTTP responses — the caller
//      gets a generic message plus an error id they can quote to support.
// ---------------------------------------------------------------------------

const IS_PRODUCTION = process.env.NODE_ENV === 'production' || Boolean(process.env.RAILWAY_ENVIRONMENT);

// Anything whose KEY looks secret gets its VALUE replaced, and anything that
// looks like a token/JWT/URL-credential gets masked wherever it appears.
const SECRET_KEY_PATTERN = /(pass(word)?|secret|token|key|authorization|cookie|credential|bearer)/i;

const VALUE_PATTERNS = [
  // JWTs (Supabase service-role keys are JWTs)
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]'],
  // credentials embedded in a URL: scheme://user:pass@host
  [/(\w+:\/\/[^:\s/]+):([^@\s]+)@/g, '$1:[REDACTED]@'],
  // long opaque hex/base64 blobs (session tokens, service keys)
  [/\b[A-Fa-f0-9]{40,}\b/g, '[REDACTED_TOKEN]']
];

function redactString(str) {
  let out = String(str);
  for (const [pattern, replacement] of VALUE_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

function redact(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[deep]';

  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;

  if (value instanceof Error) {
    return IS_PRODUCTION
      ? redactString(value.message)
      : redactString(value.stack || value.message);
  }

  if (Array.isArray(value)) return value.map(v => redact(v, depth + 1));

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEY_PATTERN.test(k) ? '[REDACTED]' : redact(v, depth + 1);
  }
  return out;
}

function emit(stream, level, message, meta) {
  const parts = [`[${new Date().toISOString()}] ${level} ${redactString(message)}`];
  if (meta !== undefined) {
    try {
      parts.push(typeof meta === 'string' ? redactString(meta) : JSON.stringify(redact(meta)));
    } catch {
      parts.push('[unserializable meta]');
    }
  }
  stream(parts.join(' '));
}

const logger = {
  isProduction: IS_PRODUCTION,

  info(message, meta) {
    emit(console.log, 'INFO ', message, meta);
  },

  warn(message, meta) {
    emit(console.warn, 'WARN ', message, meta);
  },

  error(message, meta) {
    emit(console.error, 'ERROR', message, meta);
  },

  // Development-only chatter (seed hints, local credentials, verbose notes).
  // Silent in production, so none of it can end up in a deploy log.
  debug(message, meta) {
    if (IS_PRODUCTION) return;
    emit(console.log, 'DEBUG', message, meta);
  },

  redact
};

module.exports = logger;
