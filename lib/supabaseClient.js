const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// IMPORTANT: this must be the service_role key, never the anon key.
// The service_role key bypasses Row Level Security by design, which is what
// lets this trusted backend read/write across tenants while RLS blocks any
// other caller. Never send this key to a browser or commit it to git.
//
// If these aren't set, this module exports null and the rest of the app
// runs in local single-salon JSON-file mode (see server.js) — this keeps
// `npm install && npm start` working with zero setup for local dev/demo use.
let supabase = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
} else if (process.env.NODE_ENV === 'production') {
  require('./logger').error(
    'FATAL: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in production. ' +
    "Set both in your host's environment variables (see .env.example) before starting."
  );
  process.exit(1);
}

module.exports = supabase;
