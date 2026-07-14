/*
  Black Rococo server — thin bootstrap only.

  This file wires together: static file serving and dispatch to feature
  modules under lib/domains/. It should rarely need edits on its own — if
  you're fixing or adding a feature, the file you want is almost certainly
  one of:

    lib/domains/services.js        Admin -> SERVICIOS (services CRUD, featured toggle)
    lib/domains/promotions.js      Admin -> PROMOCIONES (discount engine + CRUD)
    lib/domains/courses.js         Admin -> ACADEMIA (courses + registrations)
    lib/domains/media.js           Admin -> GALERIA (photo/video library)
    lib/domains/clients.js         Admin -> CLIENTAS (CRM profile + stats)
    lib/domains/bookings.js        Booking flow, availability, appointment status
    lib/domains/notifications.js   Notification creation, webhook dispatch, reminders
    lib/domains/posts.js           Admin -> PUBLICAR (legacy quick social post log)
    lib/domains/admin-auth.js      Login/logout/session verification
    lib/domains/admin-dashboard.js The main admin dashboard aggregation route
    lib/domains/admin-uploads.js   File upload handling
    lib/domains/google-calendar.js Automatic Google Calendar sync (OAuth connect + event create/delete)
    lib/domains/whatsapp.js        WhatsApp/Calendar link + message wording
    lib/domains/appointments.js    Shapes a raw appointment into its public view
    lib/domains/availability.js    Slot overlap/availability calculation

  This app serves exactly ONE salon (Black Rococo). Runs on a local JSON
  file by default (zero setup, offline-friendly demo mode). Set
  SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to persist to a real Postgres
  database instead — the salon is resolved once at boot (see below), not
  per-request. See docs/SAAS_DEPLOYMENT.md.
*/
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { getSalonBySlug } = require('./lib/tenant');
const { verifyStorageBucket } = require('./lib/uploads');
const { SITE_URL } = require('./lib/config');
const logger = require('./lib/logger');
const seo = require('./lib/seo');

// P0: the social-preview tags in index.html hardcode https://blackrococo.mx.
// og:image MUST be an absolute URL that actually resolves — WhatsApp, Facebook
// and Instagram fetch it directly and do NOT execute JavaScript, so if that
// domain isn't the one serving the app, every shared link renders with a blank
// preview. Rewriting the canonical origin at serve time means the tags are
// always correct for whatever domain is really live (set SITE_URL in Railway;
// if it's unset we fall back to the request's own Host, which is still right).
const CANONICAL_PLACEHOLDER = /https:\/\/blackrococo\.mx/g;

function withCanonicalOrigin(html, req) {
  let origin = SITE_URL;
  if (!origin) {
    const host = req.headers.host;
    if (!host) return html; // nothing better to offer; leave as-is
    const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
      || (req.socket.encrypted ? 'https' : 'http');
    origin = `${proto}://${host}`;
  }
  return html.replace(CANONICAL_PLACEHOLDER, origin);
}
const { readDb } = require('./lib/db');
const { json, text } = require('./lib/helpers');
const {
  PUBLIC_DIR, PORT, ADMIN_EMAIL, ADMIN_PASSWORD, USE_SUPABASE, SALON_SLUG, CLIENT_REMINDER_HOURS
} = require('./lib/config');

const publicConfig = require('./lib/domains/public-config');
const adminAuth = require('./lib/domains/admin-auth');
const bookings = require('./lib/domains/bookings');
const servicesDomain = require('./lib/domains/services');
const promotions = require('./lib/domains/promotions');
const clientsDomain = require('./lib/domains/clients');
const mediaDomain = require('./lib/domains/media');
const staffDomain = require('./lib/domains/staff');
const clientPhotosDomain = require('./lib/domains/client-photos');
const coursesDomain = require('./lib/domains/courses');
const postsDomain = require('./lib/domains/posts');
const notificationsDomain = require('./lib/domains/notifications');
const adminDashboard = require('./lib/domains/admin-dashboard');
const adminUploads = require('./lib/domains/admin-uploads');
const googleCalendarDomain = require('./lib/domains/google-calendar');
const adminSettings = require('./lib/domains/admin-settings');

// Resolved once at boot (see startServer below), not per-request. null in
// local JSON-file mode.
let SALON_ID = null;
let SALON = null;

async function handleApi(req, res, pathname, url) {
  try {
    if (req.method === 'GET' && pathname === '/api/health') {
      return json(res, 200, { ok: true, service: 'black-rococo', time: new Date().toISOString() });
    }

    if (req.method === 'GET' && pathname === '/api/admin/google-calendar/callback') {
      return googleCalendarDomain.handleCallbackRoute(req, res, url, SALON_ID);
    }

    const salonId = SALON_ID;
    const salon = SALON;

    // --- Public routes (no admin session required) ---
    const publicCtx = { req, res, pathname, url, salonId, salon };

    // STORY 2.5 — scoped reads on the PUBLIC hot path.
    //
    // These three routes are ~99% of all traffic. Each now loads ONLY the
    // collections it uses instead of all eleven. Anything omitted here throws
    // on access (see guardUnloaded in lib/store.js), so a wrong list fails
    // loudly in the regression suite rather than silently returning [] — which,
    // for `appointments`, would advertise every booked slot as free.
    if (req.method === 'GET' && pathname === '/api/availability') {
      // Needs the service (for duration) and existing appointments (for overlap).
      const db = await readDb(salonId, ['services', 'appointments']);
      if (await bookings.handlePublicRoutes({ ...publicCtx, db })) return;
    }
    if (req.method === 'GET' && pathname === '/api/rebook') {
      const db = await readDb(salonId, ['clients', 'appointments', 'services']);
      if (await bookings.handlePublicRoutes({ ...publicCtx, db })) return;
    }
    if (req.method === 'POST' && pathname === '/api/bookings') {
      // The booking workflow touches the most: service, slot, client, promo,
      // and it writes a notification.
      const db = await readDb(salonId, [
        'services', 'appointments', 'clients', 'promotions', 'notifications'
      ]);
      if (await bookings.handlePublicRoutes({ ...publicCtx, db })) return;
    }
    if (req.method === 'GET' && pathname === '/api/config') {
      // The homepage. Never touches appointments, clients, notifications or
      // client photos — which at scale is the bulk of the database.
      const db = await readDb(salonId, [
        'services', 'media', 'promotions', 'courses', 'staff', 'posts'
      ]);
      if (await publicConfig.handlePublicRoutes({ ...publicCtx, db })) return;
    }
    if (req.method === 'POST' && pathname === '/api/course-registrations') {
      const db = await readDb(salonId, ['courses', 'courseRegistrations', 'notifications']);
      if (await coursesDomain.handlePublicRoutes({ ...publicCtx, db })) return;
    }
    if (await adminAuth.handlePublicRoutes(publicCtx)) return;

    // --- Admin routes (session required) ---
    if (pathname.startsWith('/api/admin/')) {
      if (!adminAuth.requireAdmin(req, res)) return;
      // Admin routes deliberately load everything. They run through a handler
      // CHAIN (each domain gets a chance to match), so the needed collections
      // aren't known until a handler claims the request. Scoping would mean
      // resolving the route twice. It is also a single user at low volume — the
      // dashboard genuinely needs every collection anyway — so the read
      // amplification that matters (the public hot path, above) is already gone.
      const db = await readDb(salonId);
      const adminCtx = { req, res, pathname, url, db, salonId, salon };

      if (await adminUploads.handleAdminRoutes(adminCtx)) return;
      if (await adminDashboard.handleAdminRoutes(adminCtx)) return;
      if (await notificationsDomain.handleAdminRoutes(adminCtx)) return;
      if (await bookings.handleAdminRoutes(adminCtx)) return;
      // Must run BEFORE clientsDomain: that module matches
      // /api/admin/clients/:id, which would otherwise swallow the nested
      // /api/admin/clients/:id/photos routes.
      if (await clientPhotosDomain.handleAdminRoutes(adminCtx)) return;
      if (await clientsDomain.handleAdminRoutes(adminCtx)) return;
      if (await staffDomain.handleAdminRoutes(adminCtx)) return;
      if (await servicesDomain.handleAdminRoutes(adminCtx)) return;
      if (await promotions.handleAdminRoutes(adminCtx)) return;
      if (await coursesDomain.handleAdminRoutes(adminCtx)) return;
      if (await mediaDomain.handleAdminRoutes(adminCtx)) return;
      if (await postsDomain.handleAdminRoutes(adminCtx)) return;
      if (await googleCalendarDomain.handleAdminRoutes(adminCtx)) return;
      if (await adminSettings.handleAdminRoutes(adminCtx)) return;
    }

    return json(res, 404, { error: 'API route not found' });
  } catch (err) {
    // The full error (stack, Supabase text) goes to the SERVER log only. The
    // client gets a generic message plus a correlation id — enough to report the
    // problem, nothing that reveals the schema, the query, or internal paths.
    const errorId = crypto.randomBytes(4).toString('hex');
    logger.error(`${req.method} ${pathname} failed [${errorId}]`, err);
    return json(res, 500, {
      error: 'Ocurrió un error inesperado. Intenta de nuevo en unos momentos.',
      errorId
    });
  }
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon'
  }[ext] || 'application/octet-stream';
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? 'index.html' : pathname.slice(1);

  // decodeURIComponent throws URIError on malformed input (e.g. a bare `%`).
  // Unguarded, that crashed the whole server — see the http.createServer
  // comment above. A bad path is a 400, not a fatal error.
  try {
    rel = decodeURIComponent(rel);
  } catch {
    return text(res, 400, 'Bad request');
  }

  // Reject NUL bytes outright: path APIs treat them as string terminators, so
  // "safe.png\0../../etc/passwd" can smuggle a traversal past naive checks.
  if (rel.includes('\0')) return text(res, 400, 'Bad request');

  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));

  // P0: the guard used to be `filePath.startsWith(PUBLIC_DIR)`, a raw prefix
  // test with no path-boundary check. "/app/public" also prefixes
  // "/app/public-secret", so `../public-secret/x` normalized to a SIBLING
  // directory and sailed straight through. Compare against PUBLIC_DIR + sep.
  const root = PUBLIC_DIR.endsWith(path.sep) ? PUBLIC_DIR : PUBLIC_DIR + path.sep;
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(root)) {
    return text(res, 403, 'Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback: any unknown path serves index.html.
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (fallbackErr, fallback) => {
        if (fallbackErr) return text(res, 404, 'Not found');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(withCanonicalOrigin(fallback.toString('utf8'), req));
      });
      return;
    }

    const isHtml = filePath.endsWith('.html');
    const body = isHtml ? withCanonicalOrigin(data.toString('utf8'), req) : data;

    res.writeHead(200, {
      'Content-Type': contentType(filePath),
      'Cache-Control': isHtml ? 'no-store' : 'public, max-age=3600'
    });
    res.end(body);
  });
}

const server = http.createServer((req, res) => {
  // P0: this callback used to be completely unguarded. `new URL()` throws on a
  // malformed Host header, and serveStatic's decodeURIComponent() throws
  // URIError on a malformed path — so a single `GET /%` raised an
  // uncaughtException and KILLED THE PROCESS. Any visitor could take the salon
  // offline with one request, repeatedly. Nothing may escape this try/catch.
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    return text(res, 400, 'Bad request');
  }

  const pathname = url.pathname;
  try {
    if (pathname.startsWith('/api/')) {
      // handleApi is async: a rejected promise here would become an
      // unhandledRejection, which Node also treats as fatal. Catch it.
      return handleApi(req, res, pathname, url).catch(err => {
        const errorId = crypto.randomBytes(4).toString('hex');
        logger.error(`unhandled API rejection ${req.method} ${pathname} [${errorId}]`, err);
        if (!res.headersSent) json(res, 500, { error: 'Ocurrió un error inesperado.', errorId });
      });
    }
    // SEO: real, server-rendered pages at real URLs (see lib/seo.js).
    // Anything that isn't a static asset goes through here, so an unknown path
    // gets a genuine 404 instead of the old behaviour — which returned 200 +
    // the homepage for EVERY path, creating infinite duplicate URLs.
    // sitemap.xml and robots.txt are GENERATED (they list a URL per active
    // service), so they must be intercepted before serveStatic finds the stale
    // files on disk — which listed #fragments Google never treats as pages.
    if (!path.extname(pathname) || pathname === '/sitemap.xml' || pathname === '/robots.txt') {
      return serveSeoPage(req, res, pathname).catch(err => {
        logger.error(`SEO render failed ${pathname}`, err);
        if (!res.headersSent) serveStatic(req, res, pathname);
      });
    }

    return serveStatic(req, res, pathname);
  } catch (err) {
    logger.error(`request handler threw ${req.method} ${pathname}`, err);
    if (!res.headersSent) text(res, 500, 'Internal error');
  }
});

// ---------------------------------------------------------------------------
// Server-rendered SEO pages.
//
// The SPA is untouched: app.js still boots and replaces #app, so the interface
// a human sees is identical. What changes is what a CRAWLER receives — real
// content, a unique title, and route-specific structured data, instead of
// "Cargando Black Rococo…".
// ---------------------------------------------------------------------------
const SEO_COLLECTIONS = ['services', 'courses', 'media', 'staff', 'promotions'];

function canonicalOrigin(req) {
  if (SITE_URL) return SITE_URL;
  const host = req.headers.host || 'localhost';
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
    || (req.socket.encrypted ? 'https' : 'http');
  return `${proto}://${host}`;
}

async function serveSeoPage(req, res, pathname) {
  const origin = canonicalOrigin(req);
  const db = await readDb(SALON_ID, SEO_COLLECTIONS);

  // robots.txt and sitemap.xml are generated, not static: the sitemap lists a
  // URL for every ACTIVE service, so adding a service to the admin panel makes
  // it discoverable to Google automatically. The old sitemap was a static file
  // listing #fragments, which Google does not treat as separate pages at all.
  if (pathname === '/sitemap.xml') {
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    return res.end(seo.buildSitemap(db, origin));
  }
  if (pathname === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    return res.end(seo.buildRobots(origin));
  }

  const page = seo.resolvePage(pathname, db);

  const template = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

  if (!page) {
    // A REAL 404. Previously every unknown path returned 200 with the homepage —
    // a soft 404, which Google treats as a quality problem and which spawned
    // unlimited duplicate URLs.
    const html = template
      .replace(/<!--SEO_HEAD-->/, `
  <title>Página no encontrada | Black Rococo</title>
  <meta name="robots" content="noindex, follow">
  <link rel="canonical" href="${origin}/">`)
      .replace(/<!--SEO_BODY-->/, `<article>
        <h1>Página no encontrada</h1>
        <p>La página que buscas no existe o cambió de dirección.</p>
        <p><a href="/">Ir al inicio</a> · <a href="/servicios">Ver servicios</a> · <a href="/reservar">Reservar cita</a></p>
      </article>`);
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(html);
  }

  const html = template
    .replace(/<!--SEO_HEAD-->/, seo.buildHead(page, db, origin))
    .replace(/<!--SEO_BODY-->/, seo.renderBody(page, db, origin));

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

// STORY 1.5 — deployment preflight.
//
// Every one of these used to fail LATE and obscurely: a missing SESSION_SECRET
// silently logged every admin out on each redeploy; a wrong SALON_SLUG killed
// startup with a confusing error; a default admin password shipped to
// production unnoticed. Check them all up front and say exactly what is wrong.
function preflight() {
  const errors = [];
  const warnings = [];

  if (USE_SUPABASE) {
    if (!process.env.SESSION_SECRET) {
      errors.push('SESSION_SECRET is not set. Without it a new secret is generated on every boot, so every redeploy logs the admin out. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    }
    if (!process.env.SALON_SLUG) {
      warnings.push(`SALON_SLUG is not set; falling back to "${SALON_SLUG}". This must match the slug column of your row in the salons table.`);
    }
    if (!SITE_URL) {
      warnings.push('SITE_URL is not set. Social link previews (og:image) will fall back to the request Host, which is usually correct but not guaranteed behind a proxy.');
    }
  }

  if (!ADMIN_PASSWORD || /change-this|rococo2026/i.test(ADMIN_PASSWORD)) {
    const msg = 'ADMIN_PASSWORD is still the default/example value. Change it before exposing this deployment.';
    if (logger.isProduction) errors.push(msg);
    else warnings.push(msg);
  }

  for (const w of warnings) logger.warn(`PREFLIGHT: ${w}`);

  if (errors.length) {
    for (const e of errors) logger.error(`PREFLIGHT: ${e}`);
    logger.error('Refusing to start with an unsafe configuration. See .env.example.');
    process.exit(1);
  }
}

async function startServer() {
  preflight();

  if (USE_SUPABASE) {
    const salon = await getSalonBySlug(SALON_SLUG);
    if (!salon) {
      logger.error(`FATAL: no salon found with slug "${SALON_SLUG}" in Supabase.`);
      logger.error('Run sql/schema.sql, then every file in sql/migrations/, and set SALON_SLUG to match. Then restart.');
      process.exit(1);
    }
    SALON = salon;
    SALON_ID = salon.id;
    logger.info(`Connected to Supabase salon "${salon.name}"`, { slug: SALON_SLUG });

    // Fail-fast on storage misconfiguration. Every image upload in the app
    // (hero, services, gallery, courses, posts) writes to this one bucket, so
    // if it's missing or private, uploads break everywhere at once — and the
    // symptom looks like a broken button, not a config problem. Say so at boot.
    try {
      const storage = await verifyStorageBucket();
      if (storage.ok) {
        logger.info(`Storage bucket "${storage.bucket}" OK (public).`);
      } else {
        logger.warn('STORAGE NOT READY — image uploads will fail.', {
          reason: storage.reason,
          bucketsFound: storage.buckets,
          fix: 'Create a PUBLIC bucket with that name in Supabase -> Storage, or set SUPABASE_STORAGE_BUCKET to the correct name.'
        });
      }
    } catch (err) {
      logger.warn('Could not verify the storage bucket', err);
    }
  }

  const runReminders = () => notificationsDomain
    .processClientReminders(SALON_ID)
    .catch(err => logger.error('processClientReminders failed', err));
  setTimeout(runReminders, 5000);
  setInterval(runReminders, 10 * 60 * 1000);

  // Last line of defence. A single unhandled throw anywhere must not be able to
  // take the salon's booking site offline. Log loudly and keep serving: a
  // half-broken request is strictly better than a dead process.
  process.on('uncaughtException', err => {
    logger.error('UNCAUGHT EXCEPTION (server kept alive)', err);
  });
  process.on('unhandledRejection', err => {
    logger.error('UNHANDLED REJECTION (server kept alive)', err);
  });

  server.listen(PORT, '0.0.0.0', () => {
    logger.info(`Black Rococo listening on port ${PORT}`, {
      mode: USE_SUPABASE ? 'supabase' : 'local-json',
      env: logger.isProduction ? 'production' : 'development'
    });
    // STORY 1.6: this used to print `Admin login: <email> / <password>` in
    // plaintext — putting the admin password straight into Railway's deploy log,
    // where it is visible to anyone with dashboard access and retained forever.
    // The credential hint is now development-only and never prints the password.
    logger.debug(`Admin email: ${ADMIN_EMAIL} (password from ADMIN_PASSWORD env var)`);
    logger.info(`Reminder checks: ${CLIENT_REMINDER_HOURS.join(', ')}h before appointment`);
  });
}

startServer().catch(err => {
  logger.error('FATAL: failed to start server', err);
  process.exit(1);
});
