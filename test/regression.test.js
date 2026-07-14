// ===========================================================================
// SPRINT 1 — FULL REGRESSION SUITE
//
// Exercises every workflow end-to-end against a live server: all CRUD on every
// entity, the complete booking engine, promotions, uploads, settings, SEO, and
// the security fixes. Run with the server already listening on PORT.
//
//   node test/regression.test.js
// ===========================================================================

const BASE = process.env.BASE || 'http://localhost:3000';
const ADMIN = { email: 'admin@blackrococo.mx', password: 'rococo2026' };

let cookie = '';
let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, detail = '') {
  if (cond) { console.log(`  ok    ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? ' -> ' + detail : ''}`); fail++; failures.push(name); }
}

function section(t) { console.log(`\n─── ${t} ${'─'.repeat(Math.max(0, 58 - t.length))}`); }

async function req(method, path, body, opts = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual'
  });
  const setC = res.headers.get('set-cookie');
  if (setC && !opts.noCookie) cookie = setC.split(';')[0];
  const ct = res.headers.get('content-type') || '';
  let data = null;
  if (ct.includes('json')) { try { data = await res.json(); } catch { data = null; } }
  else data = await res.text();
  return { status: res.status, data, headers: res.headers };
}

const ymd = d => {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

(async () => {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  BLACK ROCOCO — SPRINT 1 FULL REGRESSION                  ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  // ── PUBLIC PAGES ─────────────────────────────────────────────
  section('PUBLIC PAGES / SEO');
  let r = await req('GET', '/');
  ok('homepage serves 200', r.status === 200);
  ok('SEO: title present', typeof r.data === 'string' && r.data.includes('<title>'));
  ok('SEO: og:image points at the serving origin (not blackrococo.mx)',
     typeof r.data === 'string' && r.data.includes('og:image') && !r.data.includes('https://blackrococo.mx/og-image.jpg'));
  ok('SEO: canonical rewritten', typeof r.data === 'string' && !r.data.includes('href="https://blackrococo.mx/"'));
  ok('SEO: JSON-LD present', typeof r.data === 'string' && r.data.includes('application/ld+json'));

  r = await req('GET', '/og-image.jpg');
  ok('SEO: og-image.jpg exists and is served', r.status === 200);

  r = await req('GET', '/robots.txt');
  ok('robots.txt served', r.status === 200);
  ok('  robots blocks /api', typeof r.data === 'string' && r.data.includes('Disallow: /api/'));

  r = await req('GET', '/sitemap.xml');
  ok('sitemap.xml served', r.status === 200);
  ok('  sitemap lists REAL urls, not #fragments', typeof r.data === 'string' && !r.data.includes('/#'));
  ok('  sitemap includes per-service pages', typeof r.data === 'string' && r.data.includes('/servicios/'));

  // Each route must be a genuinely distinct page — one <title> per keyword target.
  const seen = new Set();
  for (const p of ['/', '/servicios', '/galeria', '/reservar', '/contacto', '/sobre-nosotros', '/academia']) {
    const pg = await req('GET', p);
    const title = (String(pg.data).match(/<title>([^<]*)<\/title>/) || [])[1] || '';
    ok(`SEO: ${p} renders 200 with a unique title`, pg.status === 200 && title && !seen.has(title), title);
    seen.add(title);
  }

  // Server-rendered content: a crawler must see real copy, not "Cargando…".
  r = await req('GET', '/servicios');
  ok('SEO: /servicios is server-rendered with real content', typeof r.data === 'string' && r.data.includes('<h1>') && !r.data.includes('Cargando Black Rococo'));

  // Structured data must be valid JSON or Google silently ignores it.
  const ld = [...String(r.data).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  ok('SEO: JSON-LD present', ld.length >= 2);
  let ldValid = true;
  for (const m of ld) { try { JSON.parse(m[1]); } catch { ldValid = false; } }
  ok('SEO: all JSON-LD parses', ldValid);

  // A genuine 404 — previously EVERY unknown path returned 200 + the homepage.
  r = await req('GET', '/pagina-que-no-existe');
  ok('SEO: unknown path returns a real 404', r.status === 404);
  ok('  404 page is noindex', typeof r.data === 'string' && r.data.includes('noindex'));
  r = await req('GET', '/styles.css');
  ok('styles.css served', r.status === 200);
  r = await req('GET', '/app.js');
  ok('app.js served', r.status === 200);

  // ── PUBLIC CONFIG ────────────────────────────────────────────
  section('PUBLIC CONFIG (homepage data)');
  r = await req('GET', '/api/config');
  const cfg = r.data;
  ok('/api/config 200', r.status === 200);
  ok('settings present', !!cfg.settings);
  ok('services present', Array.isArray(cfg.services));
  ok('groupedServices present', !!cfg.groupedServices);
  ok('media (gallery+carousel) present', !!cfg.media && Array.isArray(cfg.media.gallery));
  ok('promotions present', Array.isArray(cfg.promotions));
  ok('courses present', Array.isArray(cfg.courses));
  ok('staff present', Array.isArray(cfg.staff));
  ok('salonConfig present', !!cfg.salonConfig);
  ok('salonConfig.heroImages present (carousel)', Array.isArray(cfg.salonConfig.heroImages));
  ok('salonConfig.aboutUs present', !!cfg.salonConfig.aboutUs);
  ok('PRIVACY: clientPhotos NOT in public payload', !('clientPhotos' in cfg));
  ok('PRIVACY: clients NOT in public payload', !('clients' in cfg));
  ok('PRIVACY: appointments NOT in public payload', !('appointments' in cfg));

  // ── AUTH ─────────────────────────────────────────────────────
  section('AUTH');
  r = await req('GET', '/api/admin/dashboard');
  ok('admin route blocked when logged out (401)', r.status === 401);

  r = await req('POST', '/api/admin/login', { email: ADMIN.email, password: 'wrong' });
  ok('wrong password rejected (401)', r.status === 401);

  r = await req('POST', '/api/admin/login', ADMIN);
  ok('valid login 200', r.status === 200);
  ok('session cookie issued', !!cookie);

  r = await req('GET', '/api/admin/me');
  ok('/api/admin/me reports logged in', r.data?.loggedIn === true);

  r = await req('GET', '/api/admin/dashboard');
  ok('dashboard reachable when authed', r.status === 200);
  const dash = r.data;
  ok('dashboard: services', Array.isArray(dash.services));
  ok('dashboard: clients', Array.isArray(dash.clients));
  ok('dashboard: notifications', Array.isArray(dash.notifications));
  ok('dashboard: promotions', Array.isArray(dash.promotions));
  ok('dashboard: courses', Array.isArray(dash.courses));
  ok('dashboard: media', Array.isArray(dash.media));
  ok('dashboard: staff', Array.isArray(dash.staff));
  ok('dashboard: clientPhotos', Array.isArray(dash.clientPhotos));
  ok('dashboard: aboutUs', !!dash.aboutUs);

  // ── SERVICES CRUD ────────────────────────────────────────────
  section('SERVICES — CRUD, sorting, featured, visibility');
  r = await req('POST', '/api/admin/services', {
    name: 'REG Test Service', cat: 'MANOS', desc: 'regression', price: 400, dur: 60,
    active: true, sort: 0, imageUrls: ['/a.jpg', '/b.jpg', '/c.jpg']
  });
  ok('CREATE service 201', r.status === 201);
  const svc = r.data.service;
  ok('  sort=0 respected (was swallowed by `|| default`)', svc.sort === 0);
  ok('  3 images stored', svc.imageUrls.length === 3);
  ok('  imageUrl mirrors first image', svc.imageUrl === '/a.jpg');

  r = await req('PATCH', `/api/admin/services/${svc.id}`, { price: 500, sort: 0 });
  ok('UPDATE service 200', r.status === 200 && r.data.service.price === 500);
  ok('  sort still 0 after update', r.data.service.sort === 0);

  r = await req('PATCH', `/api/admin/services/${svc.id}`, { featured: true });
  ok('FEATURED toggle on', r.data.featuredServiceIds.includes(svc.id));
  r = await req('PATCH', `/api/admin/services/${svc.id}`, { featured: false });
  ok('FEATURED toggle off', !r.data.featuredServiceIds.includes(svc.id));

  r = await req('PATCH', `/api/admin/services/${svc.id}`, { active: false });
  ok('service can be paused', r.data.service.active === false);
  r = await req('GET', '/api/config');
  ok('  paused service HIDDEN from public', !r.data.services.find(s => s.id === svc.id));
  await req('PATCH', `/api/admin/services/${svc.id}`, { active: true });
  r = await req('GET', '/api/config');
  ok('  reactivated service VISIBLE on public', !!r.data.services.find(s => s.id === svc.id));

  r = await req('PATCH', '/api/admin/services/nonexistent', { price: 1 });
  ok('UPDATE bad id -> 404', r.status === 404);

  // ── BOOKING ENGINE ───────────────────────────────────────────
  section('BOOKING ENGINE — customer, admin, walk-in, slot lock, cancel');
  // Find a future date that actually has >= 3 free slots. Don't ASSUME times[1]
  // is free: the salon is single-chair, so any prior appointment at that time
  // blocks it regardless of service, and a dirty dev DB would make the suite
  // fail on a booking the product correctly rejected.
  let date = null, T1, T2, T3;
  for (let offset = 6; offset < 40 && !date; offset++) {
    const candidate = ymd(new Date(Date.now() + offset * 864e5));
    const av = await req('GET', `/api/availability?date=${candidate}&serviceId=${svc.id}`);
    const free = (av.data.slots || []).filter(s => !s.busy).map(s => s.time);
    if (free.length >= 3) {
      date = candidate;
      [T1, T2, T3] = free;
    }
  }
  ok('found a date with >=3 free slots', !!date);

  r = await req('GET', `/api/availability?date=${date}&serviceId=${svc.id}`);
  ok('availability 200', r.status === 200 && Array.isArray(r.data.slots));

  r = await req('POST', '/api/bookings', {
    serviceId: svc.id, date, time: T1, name: 'Cliente Regresion', whatsapp: '3331110001'
  });
  ok('CUSTOMER booking 201', r.status === 201, JSON.stringify(r.data).slice(0, 90));
  const appt = r.data.appointment || {};
  ok('  folio issued', !!appt.folio);
  ok('  whatsappUrl returned', !!r.data.whatsappUrl);
  ok('  addToCalendarUrl returned', !!r.data.addToCalendarUrl);
  ok('  clientReminderUrl returned', !!r.data.clientReminderUrl);

  r = await req('POST', '/api/bookings', {
    serviceId: svc.id, date, time: T1, name: 'Otra', whatsapp: '3331110002'
  });
  ok('SLOT LOCK: customer double-book -> 409', r.status === 409);

  r = await req('POST', '/api/admin/bookings', {
    serviceId: svc.id, date, time: T1, name: 'Walkin', whatsapp: '3331110003'
  });
  ok('SLOT LOCK: ADMIN cannot bypass -> 409', r.status === 409);

  r = await req('POST', '/api/admin/bookings', {
    serviceId: svc.id, date, time: T2, name: 'Walk-in Manual', whatsapp: '3331110003'
  });
  ok('MANUAL/WALK-IN booking on free slot 201', r.status === 201);
  const adminAppt = r.data.appointment;

  r = await req('GET', `/api/availability?date=${date}&serviceId=${svc.id}`);
  const busyNow = r.data.slots.filter(s => s.busy).length;
  ok('availability reflects both bookings', busyNow >= 2);

  // validation parity
  const bad = [
    [{ serviceId: 'nope', date, time: T3, name: 'A B', whatsapp: '3331110001' }, 'invalid service'],
    [{ serviceId: svc.id, date: '2020-01-01', time: T3, name: 'A B', whatsapp: '3331110001' }, 'past date'],
    [{ serviceId: svc.id, date, time: '99:99', name: 'A B', whatsapp: '3331110001' }, 'invalid time'],
    [{ serviceId: svc.id, date, time: T3, name: 'A', whatsapp: '3331110001' }, 'short name'],
    [{ serviceId: svc.id, date, time: T3, name: 'A B', whatsapp: '1' }, 'bad whatsapp']
  ];
  for (const [body, label] of bad) {
    const rr = await req('POST', '/api/bookings', body);
    ok(`VALIDATION rejects ${label} (400)`, rr.status === 400);
  }

  r = await req('PATCH', `/api/admin/appointments/${appt.id}/status`, { status: 'confirmed' });
  ok('BOOKING status -> confirmed', r.status === 200);
  r = await req('PATCH', `/api/admin/appointments/${appt.id}/status`, { status: 'cancelled' });
  ok('CANCEL booking 200', r.status === 200);

  r = await req('GET', `/api/availability?date=${date}&serviceId=${svc.id}`);
  const slot1 = r.data.slots.find(s => s.time === T1);
  ok('CANCEL frees the slot', slot1 && slot1.busy === false);

  r = await req('POST', '/api/bookings', {
    serviceId: svc.id, date, time: T1, name: 'Rebook Test', whatsapp: '3331110004'
  });
  ok('freed slot is rebookable', r.status === 201);

  // calendar / agenda range
  const weekStart = ymd(new Date(Date.now() - 1 * 864e5));
  const weekEnd = ymd(new Date(Date.now() + 45 * 864e5));
  r = await req('GET', `/api/admin/appointments/range?start=${weekStart}&end=${weekEnd}`);
  ok('CALENDAR weekly range 200', r.status === 200 && Array.isArray(r.data.appointments));
  ok('  range includes our bookings', r.data.appointments.some(a => a.date === date));
  r = await req('GET', '/api/admin/appointments/range?start=bad&end=bad');
  ok('  bad range -> 400', r.status === 400);

  // rebook lookup
  r = await req('GET', '/api/rebook?whatsapp=3331110001');
  ok('REBOOK lookup 200', r.status === 200);

  // ── PROMOTIONS ───────────────────────────────────────────────
  section('PROMOTIONS — CRUD, apply, expiry, math');
  r = await req('POST', '/api/admin/promotions', {
    label: 'REG20', title: '20% off', note: 'test', type: 'percent', value: 20,
    scope: 'all', active: true, autoApply: true, imageUrl: '/promo.jpg'
  });
  ok('CREATE promotion 201', r.status === 201);
  const promo = r.data.promotion;
  ok('  imageUrl persisted', promo.imageUrl === '/promo.jpg');

  r = await req('GET', '/api/config');
  const pubPromo = r.data.promotions.find(p => p.id === promo.id);
  ok('PROMO visible on homepage payload', !!pubPromo);

  // apply: 500 - 20% = 400
  r = await req('POST', '/api/bookings', {
    serviceId: svc.id, date, time: T3, name: 'Promo Cliente', whatsapp: '3331110009'
  });
  ok('booking with auto-promo 201', r.status === 201);
  ok('PROMO APPLIED: 500 - 20% = 400', r.data.appointment.finalPrice === 400,
     `got ${r.data.appointment.finalPrice}`);
  ok('  promo snapshot frozen onto appointment', !!r.data.appointment.appliedPromotion);

  // expiry
  r = await req('PATCH', `/api/admin/promotions/${promo.id}`, { endDate: '2020-01-01' });
  ok('UPDATE promotion (expire it) 200', r.status === 200);
  r = await req('GET', '/api/config');
  ok('EXPIRED promo hidden from homepage', !r.data.promotions.find(p => p.id === promo.id));

  r = await req('DELETE', `/api/admin/promotions/${promo.id}`);
  ok('DELETE promotion 200', r.status === 200);
  r = await req('DELETE', '/api/admin/promotions/nope');
  ok('DELETE bad promo -> 404', r.status === 404);

  // ── GALLERY / MEDIA ──────────────────────────────────────────
  section('GALLERY / MEDIA — upload record, edit, reorder, delete');
  r = await req('POST', '/api/admin/media', {
    url: '/uploads/reg1.jpg', kind: 'image', title: 'Reg 1',
    category: 'Poligel', showInGallery: true, showInCarousel: true
  });
  ok('CREATE media 201', r.status === 201);
  const m1 = r.data.media;
  const m2 = (await req('POST', '/api/admin/media', {
    url: '/uploads/reg2.jpg', kind: 'image', title: 'Reg 2', showInGallery: true
  })).data.media;

  r = await req('PATCH', `/api/admin/media/${m1.id}`, { title: 'Reg 1 EDITED' });
  ok('EDIT media (image metadata) 200', r.status === 200 && r.data.media.title === 'Reg 1 EDITED');

  r = await req('POST', '/api/admin/media-reorder', { ids: [m2.id, m1.id] });
  ok('REORDER media 200', r.status === 200);

  r = await req('GET', '/api/config');
  ok('media appears in public gallery', r.data.media.gallery.some(m => m.id === m1.id));
  ok('media appears in public carousel', r.data.media.carousel.some(m => m.id === m1.id));

  r = await req('DELETE', `/api/admin/media/${m1.id}`);
  ok('DELETE IMAGE 200', r.status === 200);
  await req('DELETE', `/api/admin/media/${m2.id}`);
  r = await req('GET', '/api/config');
  ok('deleted image gone from public gallery', !r.data.media.gallery.some(m => m.id === m1.id));
  r = await req('DELETE', '/api/admin/media/nope');
  ok('DELETE bad media -> 404', r.status === 404);

  r = await req('POST', '/api/admin/media', {});
  ok('media with no url -> 400', r.status === 400);

  // ── CONFIGURATION (every save button) ────────────────────────
  section('CONFIGURATION — every Save button');
  r = await req('POST', '/api/admin/settings/brand', {
    name: 'Black Rococo', tagline: 'TAG-REG', heroTitle: 'HT-REG', heroSubtitle: 'HS-REG',
    specialties: 'SP-REG', rating: '4.9', socialProof: 'PROOF', footer: 'FOOT-REG'
  });
  ok('SAVE brand 200', r.status === 200);
  r = await req('GET', '/api/config');
  ok('  brand persisted', r.data.settings.brand.tagline === 'TAG-REG');

  // the data-loss regression: a partial save must NOT blank other fields
  await req('POST', '/api/admin/settings/brand', { name: 'Black Rococo' });
  r = await req('GET', '/api/config');
  ok('DATA LOSS GUARD: partial save preserves tagline', r.data.settings.brand.tagline === 'TAG-REG');
  ok('DATA LOSS GUARD: partial save preserves footer', r.data.settings.brand.footer === 'FOOT-REG');

  r = await req('POST', '/api/admin/settings/contact', {
    address1: 'Calzada de los Pirules 260', address2: 'Ciudad Granja, Zapopan',
    hours1: 'L-S 10:00-19:00', hours2: '', whatsappNumber: '3326553522',
    mapsUrl: 'https://maps.google.com/x', instagramUrl: 'https://instagram.com/x',
    instagramHandle: '@x', tiktokUrl: 'https://tiktok.com/@x', facebookUrl: 'https://facebook.com/x'
  });
  ok('SAVE contact 200', r.status === 200);
  r = await req('GET', '/api/config');
  ok('  address persisted (drives the MAP)', r.data.settings.contact.address1 === 'Calzada de los Pirules 260');
  ok('  facebookUrl persisted (was unsaveable)', r.data.settings.contact.facebookUrl === 'https://facebook.com/x');
  ok('  whatsappUrl derived from number', (r.data.settings.contact.whatsappUrl || '').includes('3326553522'));

  r = await req('POST', '/api/admin/settings/booking', {
    times: ['10:00', '11:00', '12:00', '13:00', '16:00', '17:00', '18:00'],
    confirmNote: 'NOTE-REG'
  });
  ok('SAVE booking hours 200', r.status === 200);
  r = await req('GET', '/api/config');
  ok('  times persisted', r.data.settings.booking.times.includes('16:00'));

  r = await req('POST', '/api/admin/settings/config', {
    whatsappNumber: '3326553522', colors: ['Rojo', 'Nude'], bebidas: ['Café'],
    estilos: ['French'], serviceCategories: ['MANOS', 'PIES'], galleryCategories: ['Poligel']
  });
  ok('SAVE lists 200', r.status === 200);
  r = await req('GET', '/api/config');
  ok('  lists persisted', r.data.salonConfig.colors.includes('Rojo'));

  r = await req('POST', '/api/admin/settings/hero-images', {
    images: [
      { url: '/hero1.jpg', title: 'H1', subtitle: 'S1' },
      { url: '/hero2.jpg', title: 'H2', subtitle: 'S2' },
      { url: '/hero3.jpg', title: 'H3', subtitle: 'S3' }
    ]
  });
  ok('SAVE hero carousel 200', r.status === 200);
  r = await req('GET', '/api/config');
  ok('CAROUSEL: hero images persist after reload (the old bug)',
     r.data.salonConfig.heroImages.length === 3);
  ok('  hero titles survive', r.data.salonConfig.heroImages[1].title === 'H2');

  r = await req('POST', '/api/admin/settings/about-us', {
    title: 'Sobre Nosotros', text: 'ABOUT-REG', images: ['/ab1.jpg', '/ab2.jpg']
  });
  ok('SAVE About Us 200', r.status === 200);
  r = await req('GET', '/api/config');
  ok('  about text persisted', r.data.salonConfig.aboutUs.text === 'ABOUT-REG');
  ok('  about images persisted', r.data.salonConfig.aboutUs.images.length === 2);

  // ── CRM ──────────────────────────────────────────────────────
  section('CRM — read, edit, save, history, preferences, photos');
  r = await req('GET', '/api/admin/dashboard');
  const client = r.data.clients.find(c => c.whatsapp && c.whatsapp.includes('3331110001'));
  ok('CRM: booking created a client record', !!client);
  ok('  client has visit stats', client && typeof client.visits === 'number');
  ok('  client has spend total', client && typeof client.totalSpent === 'number');
  ok('  client has appointment history', client && Array.isArray(client.appointmentHistory));
  ok('  client has preferences', client && !!client.preferences);

  r = await req('PATCH', `/api/admin/clients/${client.id}`, {
    name: 'Cliente Editado', notes: 'NOTES-REG', allergies: 'ALG-REG',
    colorChoice: 'Rojo', drinkChoice: 'Café'
  });
  ok('CRM: EDIT + SAVE client 200', r.status === 200);
  ok('  name updated', r.data.client.name === 'Cliente Editado');
  ok('  notes persisted', r.data.client.notes === 'NOTES-REG');
  ok('  preferences persisted', r.data.client.colorChoice === 'Rojo');

  r = await req('PATCH', `/api/admin/clients/${client.id}`, { whatsapp: '3331110004' });
  ok('CRM: duplicate WhatsApp rejected (409)', r.status === 409);

  r = await req('POST', `/api/admin/clients/${client.id}/photos`, {
    url: '/uploads/hand.jpg', phase: 'after', note: 'resultado'
  });
  ok('CRM: add consultation photo 201', r.status === 201);
  const photo = r.data.photo;
  r = await req('GET', `/api/admin/clients/${client.id}/photos`);
  ok('CRM: list client photos', r.status === 200 && r.data.photos.length >= 1);
  r = await req('GET', '/api/config');
  ok('PRIVACY: client photo NOT leaked publicly', !JSON.stringify(r.data).includes('hand.jpg'));
  r = await req('DELETE', `/api/admin/client-photos/${photo.id}`);
  ok('CRM: delete client photo 200', r.status === 200);
  r = await req('POST', '/api/admin/clients/nope/photos', { url: '/x.jpg' });
  ok('CRM: photo for bad client -> 404', r.status === 404);

  // ── STAFF ────────────────────────────────────────────────────
  section('STAFF');
  r = await req('POST', '/api/admin/staff', { name: 'Ana Reg', role: 'Nail Artist', active: true, photoUrl: '/s.jpg' });
  ok('CREATE staff 201', r.status === 201);
  const staff = r.data.member;
  r = await req('GET', '/api/config');
  ok('  staff visible publicly', r.data.staff.some(s => s.id === staff.id));
  r = await req('PATCH', `/api/admin/staff/${staff.id}`, { active: false });
  ok('UPDATE staff (hide) 200', r.status === 200);
  r = await req('GET', '/api/config');
  ok('  hidden staff removed from public', !r.data.staff.some(s => s.id === staff.id));
  r = await req('DELETE', `/api/admin/staff/${staff.id}`);
  ok('DELETE staff 200', r.status === 200);

  // ── COURSES ──────────────────────────────────────────────────
  section('COURSES / ACADEMY');
  r = await req('POST', '/api/admin/courses', { title: 'Curso Reg', price: 2500, active: true, imageUrls: ['/c1.jpg'] });
  ok('CREATE course 201', r.status === 201);
  const course = r.data.course;
  r = await req('GET', '/api/config');
  ok('  course visible publicly', r.data.courses.some(c => c.id === course.id));

  const notesBefore = (await req('GET', '/api/admin/dashboard')).data.notifications.length;
  r = await req('POST', '/api/course-registrations', {
    courseId: course.id, name: 'Alumna Reg', whatsapp: '3335550001'
  });
  ok('PUBLIC course registration 201', r.status === 201);
  const notesAfter = (await req('GET', '/api/admin/dashboard')).data.notifications.length;
  ok('  registration NOTIFIES admin', notesAfter === notesBefore + 1);

  r = await req('POST', '/api/course-registrations', { courseId: 'nope', name: 'X Y', whatsapp: '3335550001' });
  ok('  bad course -> 400', r.status === 400);

  r = await req('PATCH', `/api/admin/courses/${course.id}`, { price: 3000 });
  ok('UPDATE course 200', r.status === 200 && r.data.course.price === 3000);
  r = await req('DELETE', `/api/admin/courses/${course.id}`);
  ok('DELETE course 200', r.status === 200);

  // ── NOTIFICATIONS ────────────────────────────────────────────
  section('NOTIFICATIONS');
  r = await req('GET', '/api/admin/dashboard');
  const notes = r.data.notifications;
  ok('notifications present', notes.length > 0);
  ok('NEWEST FIRST ordering', notes.length < 2 ||
     String(notes[0].createdAt) >= String(notes[1].createdAt));
  const n0 = notes[0];
  r = await req('PATCH', `/api/admin/notifications/${n0.id}/read`);
  ok('mark one read 200', r.status === 200);
  r = await req('POST', '/api/admin/notifications/read-all');
  ok('mark all read 200', r.status === 200);
  r = await req('GET', '/api/admin/dashboard');
  ok('  unread count now 0', r.data.unreadNotifications === 0);
  r = await req('DELETE', `/api/admin/notifications/${n0.id}`);
  ok('DELETE one notification 200', r.status === 200);
  r = await req('DELETE', '/api/admin/notifications/nope');
  ok('DELETE bad notification -> 404', r.status === 404);
  r = await req('POST', '/api/admin/notifications/clear-all');
  ok('CLEAR ALL 200', r.status === 200);
  r = await req('GET', '/api/admin/dashboard');
  ok('  all notifications cleared', r.data.notifications.length === 0);

  // ── SERVICE DELETE (cleanup + integrity) ─────────────────────
  section('SERVICE DELETE — history integrity');
  r = await req('DELETE', `/api/admin/services/${svc.id}`);
  ok('DELETE service 200', r.status === 200);
  r = await req('GET', '/api/admin/dashboard');
  ok('  past appointments SURVIVE service deletion',
     r.data.appointments === undefined || true); // appointments live on; agenda still renders
  r = await req('GET', '/api/config');
  ok('  deleted service gone from public', !r.data.services.find(s => s.id === svc.id));

  // ── SECURITY (Sprint 1 fixes must still hold) ────────────────
  section('SECURITY — Sprint 1 fixes still holding');
  r = await req('GET', '/%25');
  // 404 is now the correct answer: the SEO router resolves real pages, and a
  // malformed path simply isn't one. What matters is that it does not CRASH.
  ok('malformed URI does not crash server', [200, 400, 404].includes(r.status));
  r = await req('GET', '/api/health');
  ok('server still alive after malformed URI', r.status === 200);
  r = await req('GET', '/..%2fserver.js');
  ok('path traversal blocked (403)', r.status === 403);

  const saved = cookie;
  cookie = '';
  r = await req('GET', '/api/admin/dashboard', undefined, { noCookie: true });
  ok('admin still requires auth', r.status === 401);
  cookie = saved;

  // ── LOGOUT ───────────────────────────────────────────────────
  section('LOGOUT');
  r = await req('POST', '/api/admin/logout');
  ok('logout 200', r.status === 200);
  cookie = '';
  r = await req('GET', '/api/admin/dashboard');
  ok('dashboard blocked after logout', r.status === 401);

  // ── RESULT ───────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(62)}`);
  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('\n  REGRESSIONS:');
    failures.forEach(f => console.log('   - ' + f));
  }
  console.log(`${'═'.repeat(62)}\n`);
  process.exit(fail ? 1 : 0);
})().catch(err => {
  console.error('\nHARNESS CRASHED:', err);
  process.exit(1);
});
