const app = document.getElementById('app');

const state = {
  mode: 'client',
  tab: 'inicio',
  config: null,
  salonConfig: { colors: [], bebidas: [], estilos: [], serviceCategories: [], galleryCategories: [], heroImages: [], aboutUs: { title: '', text: '', images: [] } },
  staff: [],
  services: [],
  groupedServices: {},
  promotions: [],
  courses: [],
  media: { gallery: [], carousel: [], categories: [] },
  serviceModalId: null,
  lightbox: null,
  galleryFilter: '',
  gallerySearch: '',
  galleryVisibleCount: 9,
  galleryFilteredCache: [],
  homeCarouselCache: [],
  heroSlide: 0,
  booking: {
    step: 1,
    serviceId: null,
    date: null,
    time: null,
    name: '',
    whatsapp: '',
    styleChoice: '',
    colorChoice: '',
    drinkChoice: '',
    timePreference: '',
    allergies: '',
    notes: '',
    promoCode: '',
    loadingSlots: false,
    slots: [],
    error: '',
    success: null,
    rebook: {
      whatsapp: '',
      checking: false,
      checked: false,
      found: false,
      name: '',
      service: null,
      preferences: null,
      error: ''
    }
  },
  admin: {
    loggedIn: false,
    email: '',
    password: '',
    tab: 'agenda',
    selectedClientId: null,
    editingPromoId: null,
    editingCourseId: null,
    editingServiceId: null,
    editingMediaId: null,
    mediaDraft: null,
    mediaUploading: false,
    courseImageDraft: [],
    courseImageUploading: false,
    googleCalendar: null,
    configDraft: null,
    configSaving: false,
    configSuccess: '',
    heroUploadingIndex: null,
    editingStaffId: null,
    staffPhotoDraft: '',
    staffUploading: false,
    clientPhotoUploading: false,
    aboutUsDraft: null,
    aboutUsUploading: false,
    homepageDraft: null,
    promoImageDraft: '',
    clientSearch: '',
    agendaView: 'daily',
    weeklyAppointments: [],
    manualBooking: null,
    multiUploadFiles: [],
    multiUploadProgress: 0,
    multiUploading: false,
    data: null,
    error: ''
  },
  academia: {
    selectedCourseId: null,
    name: '',
    whatsapp: '',
    email: '',
    notes: '',
    imageIndex: {},
    error: '',
    success: null
  }
};

const money = value => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(value || 0);
const esc = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
// SINGLE-SALON PRODUCT.
// There used to be a `?salon=<slug>` param here that was forwarded as an
// `X-Salon-Slug` header on every request. The server ignores it entirely — it
// resolves the one salon once at boot (server.js: `const salonId = SALON_ID`) —
// so the header was dead weight, and a client-supplied tenant hint on a
// single-tenant product is a footgun waiting to be re-wired. Removed.

const api = (url, options = {}) => fetch(url, {
  headers: {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  },
  credentials: 'same-origin',
  ...options,
  body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
}).then(async res => {
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || 'Ocurrió un error.');
  return payload;
});

// Real URLs -> app tabs.
//
// The server now renders a genuine page at each of these paths (see lib/seo.js)
// so that Google gets unique, indexable content instead of one JS-injected page.
// When the SPA boots it must land on the matching tab, or someone arriving from
// a search result for /servicios would be dropped on the homepage.
const PATH_TO_TAB = {
  '/': 'inicio',
  '/servicios': 'servicios',
  '/reservar': 'reservar',
  '/galeria': 'galeria',
  '/academia': 'academia',
  '/sobre-nosotros': 'inicio',
  '/contacto': 'inicio'
};

function setRouteFromUrl() {
  // #admin is kept as-is: the admin panel is deliberately not a crawlable URL.
  const hash = location.hash.replace('#', '');
  if (hash === 'admin') { state.mode = 'admin'; return; }
  if (['inicio', 'servicios', 'reservar', 'galeria', 'academia'].includes(hash)) {
    state.mode = 'client';
    state.tab = hash;
    return;
  }

  const path = location.pathname.replace(/\/+$/, '') || '/';
  if (PATH_TO_TAB[path]) {
    state.mode = 'client';
    state.tab = PATH_TO_TAB[path];
    return;
  }
  // /servicios/<slug> — a service detail page. Open the services tab; the
  // service modal is opened once the config has loaded and we can match the slug.
  if (/^\/servicios\/[a-z0-9-]+$/.test(path)) {
    state.mode = 'client';
    state.tab = 'servicios';
    state.pendingServiceSlug = path.split('/').pop();
  }
}

// Kept as an alias so existing call sites keep working.
const setHashMode = setRouteFromUrl;

// Matches a URL slug back to a service, so /servicios/manicura-rusa opens that
// service. Mirrors slugify() in lib/seo.js — they must agree or the deep link
// silently lands on the plain services list.
function slugifyClient(text) {
  return String(text || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function openPendingServiceFromUrl() {
  if (!state.pendingServiceSlug) return;
  const match = (state.config?.services || [])
    .find(s => slugifyClient(s.name) === state.pendingServiceSlug);
  state.pendingServiceSlug = null;
  if (match) state.serviceModalId = match.id;
}

function splitBrand(name) {
  const parts = String(name || 'BLACK ROCOCO').split(' ');
  if (parts.length <= 1) return [name, ''];
  return [parts[0], parts.slice(1).join(' ')];
}


// ===========================================================================
// AUTO-CAROUSEL ENGINE
//
// One engine drives every image carousel in the app (hero, service cards,
// service detail modal, featured services). Three rules:
//
//   1. NEVER call render(). Advancing a slide toggles an `active` class on
//      elements already in the DOM, so the browser crossfades two decoded
//      layers. render() does `app.innerHTML = ...`, which tears down and
//      rebuilds the whole page — that is what used to make everything blink
//      and re-fetch the Google Maps iframe every few seconds.
//   2. Every slide is in the DOM from the start. That is what makes images 2
//      and 3 of a service reachable on a phone: no hover required.
//   3. One shared ticker, not one timer per carousel. Cheaper, and every
//      carousel on screen stays in step.
// ===========================================================================

const CAROUSEL_INTERVAL_MS = 3000;

function carouselSlides(el) {
  return [...el.querySelectorAll('.ac-slide')];
}

function carouselGo(el, index) {
  const slides = carouselSlides(el);
  if (slides.length < 2) return;
  const dots = [...el.querySelectorAll('.ac-dot')];
  const next = ((index % slides.length) + slides.length) % slides.length; // safe wrap

  slides.forEach((s, i) => s.classList.toggle('active', i === next));
  dots.forEach((d, i) => d.classList.toggle('active', i === next));

  const counter = el.querySelector('.ac-counter');
  if (counter) counter.textContent = `${next + 1} / ${slides.length}`;

  el.dataset.acIndex = String(next);

  // Hero slides carry their own caption; swap it in place.
  if (el.hasAttribute('data-ac-caption')) {
    const slide = slides[next];
    const titleEl = document.querySelector('[data-hero-title]');
    const subEl = document.querySelector('[data-hero-subtitle]');
    if (titleEl) titleEl.textContent = slide.dataset.acTitle || state.config?.brand?.heroTitle || '';
    if (subEl) subEl.textContent = slide.dataset.acSubtitle || state.config?.brand?.heroSubtitle || '';
    state.heroSlide = next;
  }
}

function carouselAdvance(el, dir = 1) {
  carouselGo(el, Number(el.dataset.acIndex || 0) + dir);
}

// Only cycle what the user can actually see. An off-screen carousel would burn
// CPU and, worse, silently advance past its images before being scrolled to.
function carouselVisible(el) {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < window.innerHeight && r.width > 0;
}

let carouselTicker = null;

function startCarouselTicker() {
  clearInterval(carouselTicker);
  carouselTicker = setInterval(() => {
    if (document.hidden) return; // background tab: don't burn cycles
    document.querySelectorAll('.auto-carousel[data-ac-autoplay]').forEach(el => {
      if (el._acPaused) return;
      if (!carouselVisible(el)) return;
      carouselAdvance(el, 1);
    });
  }, CAROUSEL_INTERVAL_MS);
}

// Coming back to a backgrounded tab shouldn't fast-forward several slides.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) startCarouselTicker();
});

// Pause while the pointer is over a carousel, so it can't advance out from
// under someone deliberately looking at a photo.
document.addEventListener('mouseenter', e => {
  const el = e.target.closest?.('.auto-carousel');
  if (el) el._acPaused = true;
}, true);
document.addEventListener('mouseleave', e => {
  const el = e.target.closest?.('.auto-carousel');
  if (el) el._acPaused = false;
}, true);

// Swipe — the primary way people will actually browse service photos on a phone.
let acTouchX = null;
let acTouchEl = null;
document.addEventListener('touchstart', e => {
  const el = e.target.closest?.('.auto-carousel');
  if (!el) return;
  acTouchEl = el;
  acTouchX = e.touches[0].clientX;
  el._acPaused = true;
}, { passive: true });

document.addEventListener('touchend', e => {
  if (!acTouchEl || acTouchX === null) return;
  const dx = e.changedTouches[0].clientX - acTouchX;
  if (Math.abs(dx) > 40) carouselAdvance(acTouchEl, dx < 0 ? 1 : -1);
  acTouchEl._acPaused = false;
  acTouchEl = null;
  acTouchX = null;
}, { passive: true });

/**
 * Builds a carousel. Every image is emitted up-front — that is the whole point:
 * it is what makes photos 2 and 3 reachable without hover.
 *
 * opts: alt, dots, arrows, counter, autoplay, className, captions, eager
 */
function autoCarousel(images, opts = {}) {
  const list = (images || []).filter(Boolean);
  if (!list.length) return '';

  const {
    alt = '', arrows = false, counter = false,
    autoplay = true, className = '', captions = null, eager = false
  } = opts;
  const multi = list.length > 1;
  const dots = opts.dots !== false && multi;

  return `<div class="auto-carousel ${className}"${autoplay && multi ? ' data-ac-autoplay' : ''}${captions ? ' data-ac-caption' : ''} data-ac-index="0">
    <div class="ac-viewport">
      ${list.map((url, i) => {
        const cap = (captions && captions[i]) || {};
        return `<img class="ac-slide ${i === 0 ? 'active' : ''}" src="${esc(url)}" alt="${esc(alt)}" loading="${eager && i === 0 ? 'eager' : 'lazy'}"${cap.title ? ` data-ac-title="${esc(cap.title)}"` : ''}${cap.subtitle ? ` data-ac-subtitle="${esc(cap.subtitle)}"` : ''}>`;
      }).join('')}
    </div>
    ${arrows && multi ? `<button class="ac-arrow ac-prev" data-ac-prev aria-label="Anterior">‹</button><button class="ac-arrow ac-next" data-ac-next aria-label="Siguiente">›</button>` : ''}
    ${counter && multi ? `<div class="ac-counter">1 / ${list.length}</div>` : ''}
    ${dots ? `<div class="ac-dots">${list.map((_, i) => `<button class="ac-dot ${i === 0 ? 'active' : ''}" data-ac-go="${i}" aria-label="Foto ${i + 1}"></button>`).join('')}</div>` : ''}
  </div>`;
}


// ---------------------------------------------------------------------------
// SCROLL REVEAL
//
// .fade-up starts at opacity:0. This observer is what makes it visible — so if
// it fails to run, the page is BLANK. Two safeguards:
//   1. If IntersectionObserver is unsupported, every element is revealed at once.
//   2. Elements already on screen at render time are revealed immediately,
//      rather than waiting for a scroll that may never come on a short page.
// ---------------------------------------------------------------------------
let revealObserver = null;

function initReveal() {
  const els = document.querySelectorAll('.fade-up:not(.vis)');
  if (!els.length) return;

  // No observer support, or the user asked for reduced motion: show everything.
  if (!('IntersectionObserver' in window) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    els.forEach(el => el.classList.add('vis'));
    return;
  }

  if (!revealObserver) {
    revealObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target;
        // The stagger is done with CSS transition-delay, NOT setTimeout.
        //
        // With a timer, a re-render between "intersect" and "fire" would drop
        // the .vis class on a node that had already been replaced — leaving the
        // NEW node stuck at opacity:0, i.e. permanently invisible. That is a
        // blank-section bug, and it is exactly what happened in testing.
        // transition-delay has no such race: the class is applied immediately
        // and the browser handles the timing.
        const delay = Number(el.dataset.delay || 0);
        if (delay) el.style.transitionDelay = `${delay}ms`;
        el.classList.add('vis');
        revealObserver.unobserve(el);
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  }

  els.forEach(el => revealObserver.observe(el));
}

// The top nav condenses once the hero is behind you.
function initNavScroll() {
  const nav = document.querySelector('[data-lux-nav]');
  if (!nav) return;
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 50);
  onScroll();
  window.removeEventListener('scroll', window.__luxNavScroll || (() => {}));
  window.__luxNavScroll = onScroll;
  window.addEventListener('scroll', onScroll, { passive: true });
}

function socialIconSvg(platform) {
  const icons = {
    instagram: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/></svg>',
    whatsapp: '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>',
    tiktok: '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 0010.86 4.46V13.2a8.16 8.16 0 005.58 2.17V12a4.85 4.85 0 01-3.59-1.64V6.69h3.59z"/></svg>',
    facebook: '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>'
  };
  return icons[platform] || '';
}

function serviceById(id) {
  return state.services.find(s => s.id === id);
}

function clientById(id) {
  return (state.admin.data?.clients || []).find(c => c.id === id);
}

function formatDate(value) {
  if (!value) return 'Sin fecha';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('es-MX', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTimeAgo(date) {
  const now = Date.now();
  const diff = now - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Ahora';
  if (mins < 60) return `Hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Hace ${days}d`;
  return `Hace ${Math.floor(days / 7)} sem`;
}

function profileSummary(c = {}) {
  const parts = [];
  if (c.styleChoice) parts.push(`Estilo: ${c.styleChoice}`);
  if (c.colorChoice) parts.push(`Color: ${c.colorChoice}`);
  if (c.drinkChoice) parts.push(`Bebida: ${c.drinkChoice}`);
  if (c.timePreference) parts.push(`Horario: ${c.timePreference}`);
  return parts.length ? parts.join(' · ') : 'Sin preferencias registradas';
}

function whatsappChatUrl(message) {
  if (!message) message = state.salonConfig?.homepage?.whatsappMessage || 'Hola, quiero información para agendar una cita ✨';
  const base = state.config?.contact?.whatsappUrl || 'https://api.whatsapp.com/send/?phone=5213326553522';
  const phone = (base.match(/phone=([^&]+)/) || [])[1] || '5213326553522';
  return `https://api.whatsapp.com/send/?phone=${phone}&text=${encodeURIComponent(message)}`;
}

function whatsappTo(phone, message) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) digits = `521${digits}`;
  return `https://api.whatsapp.com/send/?phone=${digits}&text=${encodeURIComponent(message)}`;
}

function todayLocal() {
  return ymdLocal(new Date());
}

// P0: formats a Date as YYYY-MM-DD in the LOCAL calendar.
//
// The weekly agenda used raw `d.toISOString().slice(0, 10)`, which converts to
// UTC first. Guadalajara is UTC-6, so from 18:00 local onward the UTC date is
// already tomorrow — the whole week grid, and the date range requested from the
// API, silently shifted forward by one day every evening. The owner checking
// tomorrow's schedule after closing saw the wrong week.
//
// Reading the local Y/M/D components directly has no timezone conversion at all,
// so it cannot drift.
function ymdLocal(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// P0: Monday-start week containing `date`.
//
// The old expression was `date.getDate() - date.getDay() + 1`. On a SUNDAY
// getDay() is 0, so that resolved to TOMORROW — the grid jumped to next week and
// today wasn't even in it. Mapping Mon..Sun to 0..6 fixes the wrap.
function startOfWeekLocal(date) {
  const d = new Date(date);
  const mondayOffset = (d.getDay() + 6) % 7; // Mon=0, Tue=1, ... Sun=6
  d.setDate(d.getDate() - mondayOffset);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dateOptions() {
  const days = [];
  const dayNames = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const ymd = ymdLocal(d);
    days.push({ ymd, day: dayNames[d.getDay()], num: d.getDate() });
  }
  return days;
}

const TAB_TO_PATH = {
  inicio: '/', servicios: '/servicios', reservar: '/reservar',
  galeria: '/galeria', academia: '/academia'
};

function goClient(tab) {
  state.mode = 'client';
  state.tab = tab;
  // Put the REAL, indexable URL in the address bar. This used to write `#tab`,
  // and a hash fragment is not a distinct page to Google — it cannot be
  // indexed, ranked or shared as one. Each tab now maps to a path the server
  // genuinely renders (see lib/seo.js), so a copied link is a real page.
  const path = TAB_TO_PATH[tab] || '/';
  if (location.pathname !== path) history.pushState(null, '', path);
  else history.replaceState(null, '', path);
  render();
}

function goAdmin() {
  state.mode = 'admin';
  history.replaceState(null, '', '#admin');
  checkAdmin().then(render);
}

function startBooking(serviceId = null) {
  state.mode = 'client';
  state.tab = 'reservar';
  state.booking.step = serviceId ? 2 : 1;
  state.booking.serviceId = serviceId;
  state.booking.date = state.booking.date || todayLocal();
  state.booking.time = null;
  state.booking.error = '';
  state.booking.success = null;
  history.replaceState(null, '', '/reservar');
  if (serviceId) loadAvailability();
  render();
}

async function loadInitial() {
  setRouteFromUrl();
  const data = await api('/api/config');
  state.config = data.settings;
  state.salonConfig = data.salonConfig || { colors: [], bebidas: [], estilos: [], serviceCategories: [], galleryCategories: [], heroImages: [] };
  state.staff = data.staff || [];
  state.services = data.services;
  state.groupedServices = data.groupedServices;
  state.promotions = data.promotions || [];
  state.courses = data.courses || [];
  state.media = data.media || { gallery: [], carousel: [], categories: [] };
  state.booking.date = todayLocal();
  if (state.mode === 'admin') {
    await checkAdmin();
    if (new URLSearchParams(location.search).has('gcal')) {
      state.admin.tab = 'integraciones';
      if (state.admin.loggedIn) loadGoogleCalendarStatus();
    }
  }
  render();
  // A visitor landing on /servicios/manicura-rusa from Google should see that
  // service, not the generic list.
  openPendingServiceFromUrl();
}

async function checkAdmin() {
  try {
    const me = await api('/api/admin/me');
    state.admin.loggedIn = Boolean(me.loggedIn);
    if (me.loggedIn) await loadAdminDashboard();
  } catch (_) {
    state.admin.loggedIn = false;
  }
}

async function loadAvailability() {
  const { serviceId, date } = state.booking;
  if (!serviceId || !date) return;
  state.booking.loadingSlots = true;
  state.booking.error = '';
  render();
  try {
    const data = await api(`/api/availability?serviceId=${encodeURIComponent(serviceId)}&date=${encodeURIComponent(date)}`);
    state.booking.slots = data.slots;
  } catch (err) {
    state.booking.error = err.message;
  } finally {
    state.booking.loadingSlots = false;
    render();
  }
}

async function lookupRebook() {
  const rb = state.booking.rebook;
  if (!rb.whatsapp || rb.whatsapp.length < 8) {
    rb.error = 'Escribe un WhatsApp válido.';
    return render();
  }
  rb.checking = true;
  rb.error = '';
  render();
  try {
    const data = await api(`/api/rebook?whatsapp=${encodeURIComponent(rb.whatsapp)}`);
    rb.checked = true;
    rb.found = Boolean(data.found);
    rb.name = data.name || '';
    rb.service = data.service || null;
    rb.preferences = data.preferences || null;
  } catch (err) {
    rb.error = err.message;
  }
  rb.checking = false;
  render();
}

async function applyRebook() {
  const rb = state.booking.rebook;
  if (!rb.found || !rb.service || !rb.service.active) return;
  state.booking.serviceId = rb.service.id;
  state.booking.whatsapp = rb.whatsapp;
  state.booking.name = rb.name || '';
  if (rb.preferences) {
    state.booking.styleChoice = rb.preferences.styleChoice || '';
    state.booking.colorChoice = rb.preferences.colorChoice || '';
    state.booking.drinkChoice = rb.preferences.drinkChoice || '';
    state.booking.timePreference = rb.preferences.timePreference || '';
    state.booking.allergies = rb.preferences.allergies || '';
    state.booking.notes = rb.preferences.notes || '';
  }
  state.booking.step = 2;
  state.booking.time = null;
  await loadAvailability();
  render();
}

async function createBooking() {
  state.booking.error = '';
  render();
  const { serviceId, date, time, name, whatsapp, styleChoice, colorChoice, drinkChoice, timePreference, allergies, notes, promoCode } = state.booking;
  try {
    const data = await api('/api/bookings', {
      method: 'POST',
      body: { serviceId, date, time, name, whatsapp, styleChoice, colorChoice, drinkChoice, timePreference, allergies, notes, promoCode }
    });
    state.booking.success = data;
    state.booking.step = 4;
    if (state.admin.loggedIn) await loadAdminDashboard();
  } catch (err) {
    state.booking.error = err.message;
  }
  render();
}

async function adminLogin() {
  state.admin.error = '';
  render();
  try {
    await api('/api/admin/login', {
      method: 'POST',
      body: { email: state.admin.email, password: state.admin.password }
    });
    state.admin.loggedIn = true;
    await loadAdminDashboard();
  } catch (err) {
    state.admin.error = err.message;
  }
  render();
}

async function adminLogout() {
  try {
    await api('/api/admin/logout', { method: 'POST' });
  } catch (_) {
    // Best-effort: log the admin out locally regardless of whether the
    // server call succeeded, so a network hiccup never traps someone
    // in a stuck "logged in" state they can't get out of.
  }
  state.admin.loggedIn = false;
  state.admin.data = null;
  render();
}

async function loadAdminDashboard() {
  state.admin.data = await api('/api/admin/dashboard');
}

async function cycleStatus(id, current) {
  const order = ['new', 'confirmed', 'in_progress', 'completed'];
  const next = order[(order.indexOf(current) + 1) % order.length] || 'new';
  try {
    await api(`/api/admin/appointments/${id}/status`, { method: 'PATCH', body: { status: next } });
    await loadAdminDashboard();
  } catch (err) {
    state.admin.error = err.message;
  }
  render();
}

async function markNotificationRead(id) {
  try {
    await api(`/api/admin/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
    await loadAdminDashboard();
  } catch (err) {
    state.admin.error = err.message;
  }
  render();
}

async function markAllNotificationsRead() {
  try {
    await api('/api/admin/notifications/read-all', { method: 'POST' });
    await loadAdminDashboard();
  } catch (err) {
    state.admin.error = err.message;
  }
  render();
}

async function clearAllNotifications() {
  if (!confirm('¿Eliminar todas las notificaciones?')) return;
  try {
    await api('/api/admin/notifications/clear-all', { method: 'POST' });
    await loadAdminDashboard();
  } catch (err) {
    state.admin.error = err.message;
  }
  render();
}

async function deleteNotification(id) {
  try {
    await api(`/api/admin/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadAdminDashboard();
  } catch (err) {
    state.admin.error = err.message;
  }
  render();
}

async function loadWeeklyAppointments() {
  const today = new Date();
  const startOfWeek = startOfWeekLocal(today);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  const start = ymdLocal(startOfWeek);
  const end = ymdLocal(endOfWeek);
  try {
    const data = await api(`/api/admin/appointments/range?start=${start}&end=${end}`);
    state.admin.weeklyAppointments = data.appointments || [];
  } catch (err) {
    state.admin.error = err.message;
  }
  render();
}

function openManualBooking() {
  state.admin.manualBooking = {
    open: true,
    name: '',
    whatsapp: '',
    serviceId: '',
    date: todayLocal(),
    time: '',
    notes: '',
    error: '',
    success: '',
    saving: false
  };
  render();
}

async function submitManualBooking() {
  const mb = state.admin.manualBooking;
  if (!mb) return;
  mb.error = '';
  mb.success = '';
  mb.saving = true;
  render();
  try {
    const data = await api('/api/admin/bookings', {
      method: 'POST',
      body: {
        serviceId: mb.serviceId,
        date: mb.date,
        time: mb.time,
        name: mb.name,
        whatsapp: mb.whatsapp,
        notes: mb.notes
      }
    });
    mb.success = `${data.appointment.folio} — ${data.appointment.serviceName} ${data.appointment.date} ${data.appointment.time}`;
    mb.saving = false;
    await loadAdminDashboard();
    if (state.admin.agendaView === 'weekly') loadWeeklyAppointments();
  } catch (err) {
    mb.error = err.message;
    mb.saving = false;
  }
  render();
}

async function handleMultiUploadFiles(input) {
  const files = [...(input.files || [])];
  if (!files.length) return;
  // Validate everything first so a single bad file is reported immediately
  // rather than after several megabytes have already gone over the wire.
  const rejected = files
    .map(f => ({ name: f.name, error: validateMediaFile(f, { allowVideo: true }) }))
    .filter(r => r.error);
  const accepted = files.filter(f => !validateMediaFile(f, { allowVideo: true }));
  if (rejected.length) {
    state.admin.error = rejected.map(r => `${r.name}: ${r.error}`).join(' · ');
  } else {
    state.admin.error = '';
  }
  if (!accepted.length) {
    input.value = '';
    return render();
  }
  state.admin.multiUploading = true;
  state.admin.multiUploadProgress = 0;
  state.admin.multiUploadFiles = accepted.map(f => ({ name: f.name, file: f, status: 'pending', url: '' }));
  render();
  let completed = 0;
  const total = state.admin.multiUploadFiles.length;
  for (const item of state.admin.multiUploadFiles) {
    try {
      item.status = 'uploading';
      render();
      const uploaded = await uploadAdminMediaFile(item.file);
      item.url = uploaded.url;
      item.kind = uploaded.kind;
      item.status = 'done';
    } catch (err) {
      item.status = 'error';
      item.error = err.message;
    }
    completed++;
    state.admin.multiUploadProgress = Math.round((completed / total) * 100);
    render();
  }
  state.admin.multiUploading = false;
  input.value = '';
  render();
}

async function saveMultiUploadToGallery(category) {
  const items = state.admin.multiUploadFiles.filter(f => f.status === 'done' && f.url);
  if (!items.length) return;
  try {
    for (const item of items) {
      await api('/api/admin/media', {
        method: 'POST',
        body: {
          url: item.url,
          kind: item.kind || 'image',
          title: '',
          description: '',
          category: category || '',
          order: 0,
          showInCarousel: false,
          showInGallery: true
        }
      });
    }
    state.admin.multiUploadFiles = [];
    state.admin.multiUploadProgress = 0;
    await refreshPublicConfig();
    await loadAdminDashboard();
  } catch (err) {
    state.admin.error = err.message;
  }
  render();
}

async function updateClientProfile(form) {
  const clientId = form.dataset.clientProfileForm;
  const body = Object.fromEntries(new FormData(form).entries());
  state.admin.error = '';
  try {
    await api(`/api/admin/clients/${encodeURIComponent(clientId)}`, { method: 'PATCH', body });
    await loadAdminDashboard();
    state.admin.selectedClientId = clientId;
  } catch (err) {
    state.admin.error = err.message;
  }
  render();
}

async function updateService(id, patch) {
  try {
    await api(`/api/admin/services/${id}`, { method: 'PATCH', body: patch });
    await refreshPublicConfig();
    await loadAdminDashboard();
  } catch (err) {
    state.admin.error = err.message;
  }
  render();
}

// --- Shared media validation & error handling (used by EVERY upload surface) ---
// These mirror lib/uploads.js exactly. Validating client-side first means a
// 20 MB file fails instantly with a clear message instead of being uploaded in
// full and only then rejected by the server.
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm'];
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

function validateMediaFile(file, { allowVideo = false } = {}) {
  if (!file) return 'Selecciona un archivo.';
  const isImage = ALLOWED_IMAGE_TYPES.includes(file.type);
  const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type);

  if (!isImage && !(allowVideo && isVideo)) {
    return allowVideo
      ? 'Formato no permitido. Usa JPG, PNG, WEBP, GIF, MP4 o WEBM.'
      : 'Formato no permitido. Usa JPG, PNG, WEBP o GIF.';
  }
  const max = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (file.size > max) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return isVideo
      ? `El video pesa ${mb} MB. Máximo 25 MB.`
      : `La imagen pesa ${mb} MB. Máximo 6 MB.`;
  }
  return null; // valid
}

// Swaps a broken/expired image URL for a visible placeholder instead of the
// browser's silent broken-image glyph. Wired up globally in the capture phase
// below, so it covers every <img> the app renders, on every surface.
function handleBrokenImage(img) {
  if (img.dataset.brokenHandled) return;
  img.dataset.brokenHandled = '1';
  img.classList.add('img-broken');
  img.removeAttribute('src');
  img.alt = 'Imagen no disponible';
}

// `error` events from <img> do not bubble, so a normal listener never sees
// them — the capture phase is the only way to catch them app-wide.
document.addEventListener('error', event => {
  const el = event.target;
  if (el && el.tagName === 'IMG') handleBrokenImage(el);
}, true);

async function uploadAdminImage(file) {
  const fd = new FormData();
  fd.append('image', file);
  const res = await fetch('/api/admin/uploads', {
    method: 'POST',
    credentials: 'same-origin',
    // No explicit headers: the browser must set multipart/form-data itself,
    // including the boundary. Setting Content-Type by hand here would break it.
    body: fd
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || 'No se pudo subir la imagen.');
  return payload.imageUrl;
}

async function uploadAdminMediaFile(file) {
  const fd = new FormData();
  fd.append('image', file);
  const res = await fetch('/api/admin/uploads', {
    method: 'POST',
    credentials: 'same-origin',
    // No explicit headers: the browser must set multipart/form-data itself,
    // including the boundary. Setting Content-Type by hand here would break it.
    body: fd
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || 'No se pudo subir el archivo.');
  return { url: payload.url || payload.imageUrl, kind: payload.kind || 'image' };
}

async function createPost(form) {
  const caption = form.querySelector('[name="caption"]').value;
  const file = form.querySelector('[name="imageFile"]')?.files?.[0];
  const targets = [...form.querySelectorAll('[name="target"]:checked')].map(el => el.value);
  try {
    let imageUrl = '';
    if (file) imageUrl = await uploadAdminImage(file);
    await api('/api/admin/posts', { method: 'POST', body: { caption, imageUrl, targets } });
    form.reset();
    await refreshPublicConfig();
    await loadAdminDashboard();
    render();
  } catch (err) {
    state.admin.error = err.message;
    render();
  }
}

async function refreshPublicConfig() {
  const cfg = await api('/api/config');
  state.config = cfg.settings;
  state.salonConfig = cfg.salonConfig || state.salonConfig;
  state.services = cfg.services;
  state.groupedServices = cfg.groupedServices;
  state.promotions = cfg.promotions || [];
  state.courses = cfg.courses || [];
  state.media = cfg.media || { gallery: [], carousel: [], categories: [] };
}

function selectCourse(id) {
  state.academia.selectedCourseId = id;
  state.academia.error = '';
  render();
}

async function submitCourseRegistration() {
  const ac = state.academia;
  ac.error = '';
  render();
  try {
    const data = await api('/api/course-registrations', {
      method: 'POST',
      body: { courseId: ac.selectedCourseId, name: ac.name, whatsapp: ac.whatsapp, email: ac.email, notes: ac.notes }
    });
    ac.success = data;
    if (state.admin.loggedIn) await loadAdminDashboard();
  } catch (err) {
    ac.error = err.message;
  }
  render();
}

async function createOrUpdatePromotion(form) {
  state.admin.promoImageDraft = '';
  const editingId = form.dataset.promoForm;
  const fd = new FormData(form);
  const body = {
    label: fd.get('label') || '',
    code: fd.get('code') || '',
    title: fd.get('title') || '',
    note: fd.get('note') || '',
    type: fd.get('type') || 'percent',
    value: Number(fd.get('value') || 0),
    scope: fd.get('scope') || 'all',
    categoryValue: fd.get('categoryValue') || '',
    serviceIds: fd.getAll('serviceIds'),
    startDate: fd.get('startDate') || '',
    endDate: fd.get('endDate') || '',
    usageLimit: Number(fd.get('usageLimit') || 0),
    autoApply: fd.get('autoApply') === 'on',
    imageUrl: fd.get('imageUrl') || '',
    active: fd.get('active') === 'on'
  };
  try {
    if (editingId) {
      await api(`/api/admin/promotions/${encodeURIComponent(editingId)}`, { method: 'PATCH', body });
    } else {
      await api('/api/admin/promotions', { method: 'POST', body });
    }
    state.admin.editingPromoId = null;
    await refreshPublicConfig();
    await loadAdminDashboard();
  } catch (err) {
    state.admin.error = err.message;
  }
  render();
}

async function togglePromotion(id, current) {
  try {
    await api(`/api/admin/promotions/${encodeURIComponent(id)}`, { method: 'PATCH', body: { active: current !== '1' } });
    await refreshPublicConfig();
    await loadAdminDashboard();
  } catch (err) {
    state.admin.error = err.message;
  }
  render();
}

async function deletePromotion(id) {
  if (!confirm('¿Eliminar esta promoción?')) return;
  try {
    await api(`/api/admin/promotions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await refreshPublicConfig();
    await loadAdminDashboard();
  } catch (err) {
    state.admin.error = err.message;
  }
  render();
}

async function handleCourseImageFilesSelected(input) {
  const files = [...(input.files || [])];
  if (!files.length) return;
  const rejected = files.map(f => ({ name: f.name, error: validateMediaFile(f) })).filter(r => r.error);
  const accepted = files.filter(f => !validateMediaFile(f));
  state.admin.error = rejected.length
    ? rejected.map(r => `${r.name}: ${r.error}`).join(' · ')
    : '';
  if (!accepted.length) {
    input.value = '';
    return render();
  }
  state.admin.courseImageUploading = true;
  render();
  try {
    for (const file of accepted) {
      const url = await uploadAdminImage(file);
      state.admin.courseImageDraft.push(url);
    }
  } catch (err) {
    state.admin.error = err.message;
  }
  state.admin.courseImageUploading = false;
  input.value = '';
  render();
}

function removeCourseDraftImage(index) {
  state.admin.courseImageDraft.splice(Number(index), 1);
  render();
}

async function createOrUpdateCourse(form) {
  const editingId = form.dataset.courseForm;
  const fd = new FormData(form);
  const body = {
    title: fd.get('title') || '',
    description: fd.get('description') || '',
    price: Number(fd.get('price') || 0),
    duration: fd.get('duration') || '',
    level: fd.get('level') || '',
    imageUrls: [...state.admin.courseImageDraft],
    capacity: Number(fd.get('capacity') || 0),
    startDate: fd.get('startDate') || '',
    active: fd.get('active') === 'on'
  };
  try {
    if (editingId) {
      await api(`/api/admin/courses/${encodeURIComponent(editingId)}`, { method: 'PATCH', body });
    } else {
      await api('/api/admin/courses', { method: 'POST', body });
    }
    state.admin.editingCourseId = null;
    state.admin.courseImageDraft = [];
    await refreshPublicConfig();
    await loadAdminDashboard();
  } catch (err) {
    state.admin.error = err.message;
  }
  render();
}

async function toggleCourse(id, current) {
  try {
    await api(`/api/admin/courses/${encodeURIComponent(id)}`, { method: 'PATCH', body: { active: current !== '1' } });
    await refreshPublicConfig();
    await loadAdminDashboard();
  } catch (err) {
    state.admin.error = err.message;
  }
  render();
}

async function deleteCourse(id) {
  if (!confirm('¿Eliminar este curso? También se perderán sus inscripciones.')) return;
  try {
    await api(`/api/admin/courses/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await refreshPublicConfig();
    await loadAdminDashboard();
  } catch (err) {
    state.admin.error = err.message;
  }
  render();
}

async function createOrUpdateService(form) {
  const editingId = form.dataset.serviceForm;
  const fd = new FormData(form);
  try {
    const imageUrls = [];
    for (let i = 0; i < 3; i++) {
      const file = form.querySelector(`[name="imageFile${i}"]`)?.files?.[0];
      const existing = fd.get(`existingImageUrl${i}`) || '';
      if (file) {
        const invalid = validateMediaFile(file);
        if (invalid) throw new Error(`Foto ${i + 1}: ${invalid}`);
        imageUrls.push(await uploadAdminImage(file));
      } else if (existing) {
        imageUrls.push(existing);
      }
    }
    const body = {
      name: fd.get('name') || '',
      cat: fd.get('cat') || '',
      dur: Number(fd.get('dur') || 60),
      desc: fd.get('desc') || '',
      price: Number(fd.get('price') || 0),
      sort: Number(fd.get('sort') || 0),
      imageUrls,
      imageUrl: imageUrls[0] || '',
      active: fd.get('active') === 'on',
      featured: fd.get('featured') === 'on'
    };
    if (editingId) {
      await api(`/api/admin/services/${encodeURIComponent(editingId)}`, { method: 'PATCH', body });
    } else {
      await api('/api/admin/services', { method: 'POST', body });
    }
    state.admin.editingServiceId = null;
    await refreshPublicConfig();
    await loadAdminDashboard();
  } catch (err) {
    state.admin.error = err.message;
  }
  render();
}

async function toggleFeaturedService(id, current) {
  try {
    await api(`/api/admin/services/${encodeURIComponent(id)}`, { method: 'PATCH', body: { featured: current !== '1' } });
    await refreshPublicConfig();
    await loadAdminDashboard();
  } catch (err) {
    state.admin.error = err.message;
  }
  render();
}

async function deleteServiceEntry(id) {
  if (!confirm('¿Eliminar este servicio? Ya no aparecerá en el sitio.')) return;
  try {
    await api(`/api/admin/services/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await refreshPublicConfig();
    await loadAdminDashboard();
  } catch (err) {
    state.admin.error = err.message;
  }
  render();
}

async function handleMediaFileSelected(input) {
  const file = input.files?.[0];
  if (!file) return;
  const invalid = validateMediaFile(file, { allowVideo: true });
  if (invalid) {
    state.admin.error = invalid;
    input.value = '';
    return render();
  }
  state.admin.error = '';
  state.admin.mediaUploading = true;
  render();
  try {
    const uploaded = await uploadAdminMediaFile(file);
    state.admin.mediaDraft = uploaded;
  } catch (err) {
    state.admin.error = err.message;
  }
  state.admin.mediaUploading = false;
  input.value = '';
  render();
}

function clearMediaDraft() {
  state.admin.mediaDraft = null;
  render();
}

async function createOrUpdateMedia(form) {
  const editingId = form.dataset.mediaForm;
  const draft = state.admin.mediaDraft;
  if (!draft?.url) {
    state.admin.error = 'Sube una foto o video primero.';
    return render();
  }
  const fd = new FormData(form);
  const body = {
    url: draft.url,
    kind: draft.kind || 'image',
    title: fd.get('title') || '',
    description: fd.get('description') || '',
    category: fd.get('category') || '',
    order: Number(fd.get('order') || 0),
    showInCarousel: fd.get('showInCarousel') === 'on',
    showInGallery: fd.get('showInGallery') === 'on'
  };
  try {
    if (editingId) {
      await api(`/api/admin/media/${encodeURIComponent(editingId)}`, { method: 'PATCH', body });
    } else {
      await api('/api/admin/media', { method: 'POST', body });
    }
    state.admin.editingMediaId = null;
    state.admin.mediaDraft = null;
    await refreshPublicConfig();
    await loadAdminDashboard();
  } catch (err) {
    state.admin.error = err.message;
  }
  render();
}

async function toggleMediaFlag(id, field, value) {
  try {
    await api(`/api/admin/media/${encodeURIComponent(id)}`, { method: 'PATCH', body: { [field]: value } });
    await refreshPublicConfig();
    await loadAdminDashboard();
  } catch (err) {
    state.admin.error = err.message;
  }
  render();
}

async function deleteMediaEntry(id) {
  if (!confirm('¿Eliminar este elemento de la galería?')) return;
  try {
    await api(`/api/admin/media/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await refreshPublicConfig();
    await loadAdminDashboard();
  } catch (err) {
    state.admin.error = err.message;
  }
  render();
}

async function updateCourseRegistrationStatus(id, status) {
  try {
    await api(`/api/admin/course-registrations/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status } });
    await loadAdminDashboard();
  } catch (err) {
    state.admin.error = err.message;
  }
  render();
}


function brandHeader() {
  const [one, two] = splitBrand(state.config.brand.name);
  return `<header class="brand-header">
    <div class="gold-rule"></div>
    <div class="logo">${esc(one)}<br>${esc(two)}</div>
    <div class="tagline">${esc(state.config.brand.tagline)}</div>
    <div class="gold-rule"></div>
    <div class="social-proof"><strong>★ ${esc(state.config.brand.rating)}</strong> · ${esc(state.config.brand.socialProof)}</div>
  </header>`;
}

function promoBanner() {
  const promos = state.promotions || [];
  if (promos.length) {
    const p = promos[0];
    return `<div class="section"><div class="card promo-card"><div class="eyebrow">${esc(p.label || 'PROMOCIÓN')}</div><div class="title" style="font-size:22px;margin:6px 0">${esc(p.title)}</div><div class="subtitle">${esc(p.note)}</div><button class="btn btn-primary" style="margin-top:14px" data-tab="reservar">APARTAR MI LUGAR</button></div></div>`;
  }
  const legacy = state.config?.promo;
  if (legacy?.enabled) {
    return `<div class="section"><div class="card promo-card"><div class="eyebrow">${esc(legacy.label)}</div><div class="title" style="font-size:22px;margin:6px 0">${esc(legacy.title)}</div><div class="subtitle">${esc(legacy.note)}</div><button class="btn btn-primary" style="margin-top:14px" data-tab="reservar">APARTAR MI LUGAR</button></div></div>`;
  }
  return '';
}

function featuredServiceCarouselCard(s) {
  const imgs = (s.imageUrls && s.imageUrls.length) ? s.imageUrls : (s.imageUrl ? [s.imageUrl] : []);
  return `<button class="carousel-service-card" data-book="${esc(s.id)}">
    ${imgs.length
      ? autoCarousel(imgs, { alt: s.name, className: 'ac-fill', dots: imgs.length > 1 })
      : `<div class="carousel-service-fallback"></div>`}
    <div class="carousel-service-caption">
      <div class="cap-title">${esc(s.name)}</div>
      <div class="cap-desc">${esc(s.desc)}</div>
      <div class="cap-price">${priceDisplay(s)}</div>
    </div>
  </button>`;
}

function featuredServicesCarousel() {
  const items = (state.config.featuredServiceIds || [])
    .map(id => serviceById(id))
    .filter(Boolean);
  if (!items.length) return `<div class="empty">Aún no hay servicios destacados.</div>`;
  const cards = items.map(featuredServiceCarouselCard).join('');
  const looped = items.length > 1;
  return `<div class="auto-carousel-track" data-auto-carousel>${cards}${looped ? cards : ''}</div>`;
}

function mediaThumbCard(m, index, listName) {
  const isVideo = m.kind === 'video';
  return `<div class="image-card" data-open-lightbox="${index}" data-lightbox-list="${listName}">
    ${isVideo
      ? `<video src="${esc(m.url)}" muted loop playsinline poster="${esc(m.posterUrl || '')}"></video>`
      : `<img alt="${esc(m.title || 'Resultado Black Rococo')}" src="${esc(m.url)}" loading="lazy">`}
    ${(m.title || m.description) ? `<div class="masonry-caption"><div class="cap-title">${esc(m.title)}</div>${m.description ? `<div class="cap-desc">${esc(m.description)}</div>` : ''}</div>` : ''}
  </div>`;
}

function openLightbox(items, index) {
  if (!items || !items.length) return;
  state.lightbox = { items, index: ((index % items.length) + items.length) % items.length };
  render();
}

function closeLightbox() {
  state.lightbox = null;
  render();
}

function lightboxNext() {
  if (!state.lightbox) return;
  const n = state.lightbox.items.length;
  state.lightbox.index = (state.lightbox.index + 1) % n;
  render();
}

function lightboxPrev() {
  if (!state.lightbox) return;
  const n = state.lightbox.items.length;
  state.lightbox.index = (state.lightbox.index - 1 + n) % n;
  render();
}

function lightboxOverlay() {
  const lb = state.lightbox;
  if (!lb) return '';
  const item = lb.items[lb.index];
  if (!item) return '';
  const isVideo = item.kind === 'video';
  return `<div class="lightbox-overlay" data-close-lightbox data-lightbox-container>
    <button class="lightbox-close" data-close-lightbox aria-label="Cerrar">✕</button>
    ${lb.items.length > 1 ? `
      <button class="lightbox-arrow left" data-lightbox-prev aria-label="Anterior">‹</button>
      <button class="lightbox-arrow right" data-lightbox-next aria-label="Siguiente">›</button>
      <div class="lightbox-counter">${lb.index + 1} / ${lb.items.length}</div>
    ` : ''}
    <div class="lightbox-media">
      ${isVideo ? `<video src="${esc(item.url)}" controls autoplay playsinline></video>` : `<img src="${esc(item.url)}" alt="${esc(item.title || '')}">`}
    </div>
    ${(item.title || item.description) ? `<div class="lightbox-caption"><div class="cap-title" style="font-size:16px">${esc(item.title)}</div>${item.description ? `<div class="cap-desc" style="font-size:13px;margin-top:4px">${esc(item.description)}</div>` : ''}</div>` : ''}
  </div>`;
}

function promoAppliesToServiceClient(promo, service) {
  if (promo.scope === 'all') return true;
  if (promo.scope === 'category') return promo.categoryValue === service.cat;
  if (promo.scope === 'services') return (promo.serviceIds || []).includes(service.id);
  return false;
}

function discountedPriceFor(service) {
  const candidates = (state.promotions || []).filter(p => promoAppliesToServiceClient(p, service));
  if (!candidates.length) return null;
  const withAmount = candidates.map(p => ({
    promo: p,
    amount: p.type === 'fixed' ? Math.min(service.price, p.value) : Math.round(service.price * (p.value / 100))
  })).sort((a, b) => b.amount - a.amount);
  const best = withAmount[0];
  if (!best.amount) return null;
  return { finalPrice: Math.max(0, service.price - best.amount), amount: best.amount, promo: best.promo };
}

function priceDisplay(s) {
  const discount = discountedPriceFor(s);
  if (!discount) return `$ ${esc(s.price)}`;
  return `<span class="price-was">$ ${esc(s.price)}</span> $ ${esc(discount.finalPrice)}`;
}

function serviceDetailModal() {
  const s = serviceById(state.serviceModalId);
  if (!s) return '';
  const discount = discountedPriceFor(s);
  return `<div class="modal-overlay" data-close-service-modal>
    <div class="modal-card">
      <button class="modal-close" data-close-service-modal aria-label="Cerrar">✕</button>
      ${(() => {
        // Every uploaded image, with arrows + dots + a counter. This used to
        // render s.imageUrl alone, so photos 2 and 3 were unreachable.
        const modalImgs = (s.imageUrls && s.imageUrls.length) ? s.imageUrls : (s.imageUrl ? [s.imageUrl] : []);
        return modalImgs.length
          ? `<div class="modal-image">${autoCarousel(modalImgs, { alt: s.name, arrows: true, counter: true, className: 'ac-fill', eager: true })}</div>`
          : '';
      })()}
      <div class="modal-body">
        <div class="category-title">${esc(s.cat)}</div>
        <div class="service-name" style="font-size:22px;margin:6px 0">${esc(s.name)}</div>
        <div class="service-meta" style="margin-bottom:10px">${esc(s.dur)} min</div>
        <p class="subtitle">${esc(s.desc)}</p>
        <div class="price" style="font-size:26px;margin:16px 0 6px">${priceDisplay(s)}</div>
        ${discount ? `<div class="service-meta">${esc(discount.promo.label || 'Promoción aplicada')}</div>` : ''}
        <button class="btn btn-primary" style="margin-top:16px;width:100%" data-book-from-modal="${esc(s.id)}">RESERVAR ESTE SERVICIO</button>
      </div>
    </div>
  </div>`;
}

function serviceButton(s, detailed = false) {
  if (detailed) {
    const imgs = (s.imageUrls && s.imageUrls.length) ? s.imageUrls : (s.imageUrl ? [s.imageUrl] : []);
    return `<div class="card svc-card-redesign" data-view-service="${esc(s.id)}">
      ${imgs.length
        ? `<div class="svc-card-img">${autoCarousel(imgs, { alt: s.name, className: 'ac-fill' })}</div>`
        : `<div class="svc-card-img svc-card-img-placeholder"></div>`}
      <div class="svc-card-body">
        <div class="svc-card-name">${esc(s.name)}</div>
        <p class="svc-card-desc">${esc(s.desc)}</p>
        <div class="svc-card-meta">${esc(s.dur)} min</div>
        <div class="svc-card-price">${priceDisplay(s)}</div>
        <button class="btn btn-primary btn-small svc-card-cta" data-book="${esc(s.id)}">AGENDAR</button>
      </div>
    </div>`;
  }
  return `<button class="card service-card" data-book="${esc(s.id)}">
    <span>
      <span class="service-name">${esc(s.name)}</span>
      <span class="service-meta">${esc(s.dur)} min</span>
    </span>
    <span class="price">${priceDisplay(s)}</span>
  </button>`;
}

function homeScreen() {
  const c = state.config;
  const hp = state.salonConfig?.homepage || {};
  const heroConf = hp.hero || {};
  const spConf = hp.socialProof || {};
  const svcConf = hp.servicesSection || {};
  const whyConf = hp.whyUs || {};
  const expConf = hp.experience || {};
  const galConf = hp.gallerySection || {};
  const ctaConf = hp.contactCta || {};
  const ftConf = hp.footer || {};

  const carouselMedia = (state.media?.carousel || []).slice(0, 10);
  const galleryMedia = (state.media?.gallery || []).slice(0, 10);
  const heroImages = (state.salonConfig?.heroImages || []).filter(h => h.url);
  state.homeCarouselCache = carouselMedia;

  const about = state.salonConfig?.aboutUs || {};
  const aboutImages = (about.images || []).filter(Boolean);
  state.aboutImagesCache = aboutImages;
  const team = state.staff || [];
  const rating = c.brand.rating || '4.9';
  const brandName = c.brand.name || 'Black Rococo';

  const whatsappNum = (c.contact?.whatsappNumber || '').replace(/\D/g, '') || '5213326553522';
  const socialLinks = [
    { name: 'Instagram', url: c.contact.instagramUrl, icon: socialIconSvg('instagram') },
    { name: 'TikTok', url: c.contact.tiktokUrl, icon: socialIconSvg('tiktok') },
    { name: 'Facebook', url: c.contact.facebookUrl, icon: socialIconSvg('facebook') }
  ].filter(l => l.url);

  const mapsQuery = [c.contact.address1, c.contact.address2]
    .map(p => String(p || '').trim()).filter(Boolean).join(', ');
  const mapsEmbedSrc = mapsQuery
    ? `https://www.google.com/maps?q=${encodeURIComponent(mapsQuery)}&hl=es&z=16&output=embed`
    : '';

  const featured = (c.featuredServiceIds || [])
    .map(id => (state.services || []).find(s => s.id === id)).filter(Boolean);
  const signature = (featured.length ? featured : (state.services || [])).slice(0, 3);

  const igTiles = (galleryMedia.length ? galleryMedia : carouselMedia).slice(0, 10);

  // Trust pills — configurable from admin or fallback defaults
  const trustPills = (hp.trustPills && hp.trustPills.length)
    ? hp.trustPills
    : [
        { icon: '★', text: `${rating} en Google` },
        { icon: '◇', text: 'Materiales premium' },
        { icon: '✧', text: 'Técnicas certificadas' }
      ];

  // Stats — configurable from admin or fallback defaults
  const stats = (spConf.stats && spConf.stats.length)
    ? spConf.stats
    : [
        { figure: rating, label: 'Calificación Google' },
        { figure: '+500', label: 'Clientas atendidas' },
        { figure: '6', label: 'Años de práctica' },
        { figure: '3–4', label: 'Semanas de duración' }
      ];

  // Why Us items — configurable from admin
  const whyItems = (whyConf.items && whyConf.items.length)
    ? whyConf.items
    : [
        { title: 'Técnica rusa en seco', text: 'Sin agua y sin cortes. La cutícula se retira con torno, con una precisión que el acabado delata.' },
        { title: 'Esterilización verificable', text: 'Instrumental metálico esterilizado entre clientas. Limas y porosos, de un solo uso. Sin excepción.' },
        { title: 'Duración real de 3 a 4 semanas', text: 'No es una promesa de marketing: es la consecuencia de una preparación bien hecha.' },
        { title: 'Una clienta a la vez', text: 'Trabajamos con cita para dedicarte el servicio completo, sin prisa y sin sala de espera.' }
      ];

  // Experience steps — configurable from admin
  const steps = (expConf.steps && expConf.steps.length)
    ? expConf.steps
    : [
        { num: '01', name: 'Reservas', text: 'Eliges servicio, día y hora en línea. Menos de un minuto.' },
        { num: '02', name: 'Te recibimos', text: 'Una clienta a la vez, en un estudio privado y sin sala de espera.' },
        { num: '03', name: 'El trabajo', text: 'Preparación en seco, acabado impecable y materiales premium.' },
        { num: '04', name: 'Vuelves', text: 'Tres a cuatro semanas después. Te recordamos por WhatsApp.' }
      ];

  return `<section class="screen lux">

    <!-- ═══ HERO ═══ -->
    <header class="hero">
      <div class="hero-dots" aria-hidden="true"></div>
      <div class="hero-grid">
        <div class="hero-content fade-up">
          <div class="eyebrow">${esc(heroConf.eyebrow || c.brand.tagline || 'Estudio de uñas de lujo')}</div>
          <h1 class="h1">${esc(heroConf.headline || c.brand.heroTitle || 'Donde la elegancia se encuentra con el arte')}</h1>
          <p class="lead">${esc(heroConf.lead || c.brand.heroSubtitle || '')}</p>
          <div class="hero-actions">
            <button class="btn-primary" data-tab="reservar">${esc(heroConf.ctaPrimary || 'Reservar mi cita')}</button>
            <button class="btn-secondary" data-tab="galeria">${esc(heroConf.ctaSecondary || 'Ver nuestro trabajo')}</button>
          </div>
          <div class="trust-row">
            ${trustPills.map(p => `<span class="trust-pill"><span class="tp-mark">${esc(p.icon)}</span> ${esc(p.text)}</span>`).join('')}
          </div>
        </div>

        <div class="hero-art fade-up" data-delay="250">
          ${heroImages.length
            ? `<div class="hero-art-frame">${autoCarousel(heroImages.map(h => h.url), {
                 alt: esc(brandName),
                 className: 'ac-fill', arrows: heroImages.length > 1, dots: heroImages.length > 1, counter: heroImages.length > 1, eager: true,
                 captions: heroImages.map(h => ({ title: h.title, subtitle: h.subtitle }))
               })}</div>`
            : `<div class="hero-art-frame hero-art-empty">
                 ${nailArtSvg()}
                 <div class="hero-empty-hint">Sube fotos de tu trabajo desde el panel de administración</div>
               </div>`}
          <span class="corner corner-br" aria-hidden="true"></span>
          <span class="corner corner-tl" aria-hidden="true"></span>
        </div>
      </div>
    </header>

    <!-- ═══ FEATURED WORK STRIP ═══ -->
    ${(igTiles.length || signature.some(s => (s.imageUrls?.length || s.imageUrl))) ? `
    <section class="section section-flush featured-strip-section">
      <div class="section-inner">
        <div class="section-head center fade-up">
          <div class="eyebrow">${esc(galConf.eyebrow || 'Nuestro trabajo')}</div>
          ${goldDivider()}
        </div>
        <div class="featured-strip fade-up">
          ${igTiles.length ? igTiles.slice(0, 8).map((m, i) => `<button class="featured-strip-item" data-lightbox-open="${i}" aria-label="Ver foto">
            <img src="${esc(m.url)}" alt="${esc(m.title || m.category || brandName)}" loading="lazy">
          </button>`).join('')
          : signature.filter(s => s.imageUrls?.length || s.imageUrl).map(s => {
              const img = s.imageUrls?.[0] || s.imageUrl;
              return `<div class="featured-strip-item"><img src="${esc(img)}" alt="${esc(s.name)}" loading="lazy"></div>`;
            }).join('')}
        </div>
      </div>
    </section>` : ''}

    <!-- ═══ SOCIAL PROOF ═══ -->
    <section class="section section-ivory">
      <div class="section-inner center fade-up">
        <div class="eyebrow">${esc(spConf.eyebrow || 'La confianza se gana')}</div>
        ${goldDivider()}
        <div class="stats-grid">
          ${stats.map(s => `<div class="stat"><div class="stat-figure">${esc(s.figure)}</div><div class="stat-label">${esc(s.label)}</div></div>`).join('')}
        </div>
        ${testimonialCarousel()}
      </div>
    </section>

    <!-- ═══ SIGNATURE SERVICES ═══ -->
    <section class="section" id="servicios">
      <div class="section-inner">
        <div class="section-head center fade-up">
          <div class="eyebrow">${esc(svcConf.eyebrow || 'Servicios insignia')}</div>
          ${goldDivider()}
          <h2 class="h2">${esc(svcConf.title || 'Nuestros servicios principales')}</h2>
          <p class="lead center-lead">${esc(svcConf.subtitle || '')}</p>
        </div>
        <div class="service-grid">
          ${signature.map((sv, i) => luxServiceCard(sv, i)).join('')}
        </div>
        <div class="center fade-up" style="margin-top:48px">
          <button class="btn-secondary" data-tab="servicios">${esc(svcConf.ctaText || 'Ver la carta completa')}</button>
        </div>
      </div>
    </section>

    ${promoBanner()}

    <!-- ═══ WHY US ═══ -->
    <section class="section section-black" id="nosotros">
      <div class="section-inner">
        <div class="why-grid">
          <div class="fade-up">
            <div class="eyebrow eyebrow-gold">${esc(whyConf.eyebrow || 'Por qué ' + brandName)}</div>
            ${goldDivider()}
            <h2 class="h2 on-dark">${esc(whyConf.title || 'Lo que justifica el precio')}</h2>
            <p class="lead on-dark">${esc(whyConf.lead || about.text || '')}</p>
            <button class="btn-secondary dark" data-tab="reservar" style="margin-top:28px">${esc(whyConf.ctaText || 'Reservar mi cita')}</button>
          </div>
          <ul class="why-list fade-up" data-delay="150">
            ${whyItems.map(it => `<li><span class="why-mark" aria-hidden="true"></span><div><strong>${esc(it.title)}</strong><p>${esc(it.text)}</p></div></li>`).join('')}
          </ul>
        </div>
      </div>
    </section>

    <!-- ═══ GALLERY ═══ -->
    <section class="section" id="galeria">
      <div class="section-inner">
        <div class="section-head center fade-up">
          <div class="eyebrow">${esc(galConf.eyebrow || 'El trabajo')}</div>
          ${goldDivider()}
          <h2 class="h2">${esc(galConf.title || 'Resultados reales')}</h2>
        </div>
        ${igTiles.length ? `<div class="ig-grid fade-up">
          ${igTiles.map((m, i) => `<button class="ig-tile" data-lightbox-open="${i}" aria-label="Ver foto">
            <img src="${esc(m.url)}" alt="${esc(m.title || m.category || brandName)}" loading="lazy">
            <span class="ig-overlay" aria-hidden="true">${socialIconSvg('instagram')}</span>
          </button>`).join('')}
        </div>` : ''}
        <div class="center fade-up" style="margin-top:40px">
          <button class="btn-secondary" data-tab="galeria">${esc(galConf.ctaText || 'Ver la galería completa')}</button>
        </div>
      </div>
    </section>

    <!-- ═══ EXPERIENCE / STEPS ═══ -->
    <section class="section section-ivory">
      <div class="section-inner center fade-up">
        <div class="eyebrow">${esc(expConf.eyebrow || 'La experiencia')}</div>
        ${goldDivider()}
        <h2 class="h2">${esc(expConf.title || 'Cómo funciona')}</h2>
        <div class="steps-row">
          ${steps.map(st => `<div class="step"><div class="step-num">${esc(st.num)}</div><div class="step-name">${esc(st.name)}</div><p>${esc(st.text)}</p></div>`).join('')}
        </div>
      </div>
    </section>

    ${team.length ? `<!-- ═══ TEAM ═══ -->
    <section class="section">
      <div class="section-inner">
        <div class="section-head center fade-up">
          <div class="eyebrow">El equipo</div>
          ${goldDivider()}
          <h2 class="h2">Las manos detrás del trabajo</h2>
        </div>
        <div class="team-grid fade-up">
          ${team.map(m => `<figure class="team-card">
            ${m.photoUrl
              ? `<img class="team-photo" src="${esc(m.photoUrl)}" alt="${esc(m.name)}" loading="lazy">`
              : `<div class="team-photo team-photo-empty" aria-hidden="true">${esc((m.name || '?').charAt(0))}</div>`}
            <figcaption>
              <div class="team-name">${esc(m.name)}</div>
              ${m.role ? `<div class="team-role">${esc(m.role)}</div>` : ''}
              ${m.bio ? `<p class="team-bio">${esc(m.bio)}</p>` : ''}
            </figcaption>
          </figure>`).join('')}
        </div>
      </div>
    </section>` : ''}

    <!-- ═══ CONTACT / CLOSE ═══ -->
    <section class="section section-black" id="contacto">
      <div class="section-inner center fade-up">
        <div class="eyebrow eyebrow-gold">${esc(ctaConf.eyebrow || 'Reserva')}</div>
        ${goldDivider()}
        <h2 class="h2 on-dark">${esc(ctaConf.title || 'Reserva tu cita')}</h2>
        <p class="lead on-dark center-lead">${esc(ctaConf.subtitle || '')}</p>
        <div class="hero-actions center-actions">
          <button class="btn-primary gold" data-tab="reservar">${esc(ctaConf.ctaPrimary || 'Reservar mi cita')}</button>
          <a class="btn-secondary dark" href="${esc(whatsappChatUrl())}" target="_blank" rel="noopener">${esc(ctaConf.ctaSecondary || 'Escribir por WhatsApp')}</a>
        </div>
        <div class="contact-detail">
          <p>${esc(c.contact.address1 || '')}${c.contact.address2 ? `<br>${esc(c.contact.address2)}` : ''}</p>
          <p class="contact-hours">${esc(c.contact.hours1 || '')}</p>
        </div>
        ${mapsEmbedSrc ? `<div class="map-embed">
          <iframe src="${esc(mapsEmbedSrc)}" width="100%" height="320" style="border:0" allowfullscreen=""
            loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="${esc(brandName)} en Google Maps"></iframe>
        </div>` : ''}
      </div>
    </section>

    <!-- ═══ FOOTER ═══ -->
    <footer class="lux-footer">
      <div class="section-inner">
        <div class="footer-grid">
          <div>
            <div class="footer-mark">${esc(brandName)}</div>
            <p class="footer-note">${esc(ftConf.description || c.brand.tagline || '')}</p>
            ${socialLinks.length ? `<div class="footer-social">
              ${socialLinks.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener" aria-label="${esc(l.name)}">${l.icon}</a>`).join('')}
            </div>` : ''}
          </div>
          <div>
            <div class="footer-head">Explorar</div>
            <button class="footer-link" data-tab="servicios">Servicios</button>
            <button class="footer-link" data-tab="galeria">Galería</button>
            <button class="footer-link" data-tab="reservar">Reservar</button>
          </div>
          <div>
            <div class="footer-head">Visítanos</div>
            <p class="footer-note">${esc(c.contact.address1 || '')}<br>${esc(c.contact.address2 || '')}</p>
            <p class="footer-note">${esc(c.contact.hours1 || '')}</p>
          </div>
          <div>
            <div class="footer-head">Contacto</div>
            <a class="footer-link" href="${esc(whatsappChatUrl())}" target="_blank" rel="noopener">WhatsApp</a>
            ${c.contact.instagramUrl ? `<a class="footer-link" href="${esc(c.contact.instagramUrl)}" target="_blank" rel="noopener">Instagram</a>` : ''}
          </div>
        </div>
        <div class="footer-fine">${esc(c.brand.footer || '© ' + brandName)}</div>
      </div>
    </footer>

    ${bottomNav()}
  </section>`;
}

// A quiet gold rule. Used to open every section — the one repeated ornament.
function goldDivider(w = '80px') {
  return `<span class="gold-divider" style="width:${w}" aria-hidden="true"></span>`;
}

// Rotating client quotes. Real social proof, presented without a star-rating
// graphic — the words do more work than the stars.
function testimonialCarousel() {
  const hp = state.salonConfig?.homepage || {};
  const reviews = (hp.testimonials && hp.testimonials.length)
    ? hp.testimonials
    : [
        { text: 'La atención al detalle es excepcional. Cada visita va más allá de un simple servicio de uñas.', author: 'María G.', role: 'Clienta frecuente' },
        { text: 'Mis uñas para la boda quedaron perfectas. Entendieron mi visión desde la primera consulta.', author: 'Ana L.', role: 'Novia' },
        { text: 'Después de probar varios salones en Guadalajara, es el único donde siento que cuidan cada detalle.', author: 'Sofía R.', role: 'Reseña de Google' }
      ];
  return `<div class="review-carousel auto-carousel" data-ac-autoplay data-ac-index="0">
    <div class="ac-viewport review-viewport">
      ${reviews.map((r, i) => `<blockquote class="ac-slide review-card ${i === 0 ? 'active' : ''}">
        <p>“${esc(r.text)}”</p>
        <cite><strong>${esc(r.author)}</strong><span>${esc(r.role)}</span></cite>
      </blockquote>`).join('')}
    </div>
    <div class="ac-dots review-dots">
      ${reviews.map((_, i) => `<button class="ac-dot ${i === 0 ? 'active' : ''}" data-ac-go="${i}" aria-label="Reseña ${i + 1}"></button>`).join('')}
    </div>
  </div>`;
}

// Placeholder art for when no hero photo has been uploaded yet. An editorial
// stand-in, not a grey box — an empty state should still look intentional.
function nailArtSvg() {
  return `<svg class="nail-art" viewBox="0 0 400 520" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Ilustración de uñas">
    <defs>
      <linearGradient id="bgGrad" x1="0" y1="0" x2="400" y2="520">
        <stop offset="0%" stop-color="#F5F0E8"/><stop offset="100%" stop-color="#E8E0D4"/>
      </linearGradient>
      <linearGradient id="nailGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#E8D5C4"/><stop offset="100%" stop-color="#D4BBA8"/>
      </linearGradient>
    </defs>
    <rect width="400" height="520" fill="url(#bgGrad)"/>
    ${[0, 1, 2, 3].map(i => {
      const x = 96 + i * 56;
      const h = i === 1 ? 150 : i === 2 ? 140 : 120;
      const y = 210 - (i === 1 ? 22 : i === 2 ? 14 : 0);
      return `<rect x="${x}" y="${y}" width="42" height="${h}" rx="21" fill="url(#nailGrad)"/>
              <rect x="${x}" y="${y}" width="42" height="34" rx="17" fill="#C6A86B" opacity=".5"/>`;
    }).join('')}
    <circle cx="200" cy="120" r="52" fill="none" stroke="#C6A86B" stroke-width="1" opacity=".45"/>
    <circle cx="200" cy="120" r="72" fill="none" stroke="#C6A86B" stroke-width="1" opacity=".22"/>
  </svg>`;
}

function luxServiceCard(s, i = 0) {
  const imgs = (s.imageUrls && s.imageUrls.length) ? s.imageUrls : (s.imageUrl ? [s.imageUrl] : []);
  return `<article class="svc-card fade-up" data-delay="${i * 120}" data-view-service="${esc(s.id)}">
    <div class="svc-card-media">
      ${imgs.length
        ? autoCarousel(imgs, { alt: `${s.name} — Black Rococo, Zapopan`, className: 'ac-fill', dots: imgs.length > 1 })
        : '<div class="svc-card-blank"></div>'}
    </div>
    <h3 class="svc-card-title">${esc(s.name)}</h3>
    ${s.desc ? `<p class="svc-card-copy">${esc(s.desc)}</p>` : ''}
    <div class="svc-card-foot">
      <span class="svc-card-time">${esc(s.dur)} min</span>
      <span class="svc-card-price">${priceDisplay(s)}</span>
    </div>
    <button class="svc-card-cta" data-book="${esc(s.id)}">Reservar</button>
  </article>`;
}



function servicesScreen() {
  const groups = Object.entries(state.groupedServices || {});
  return `<section class="screen">
    ${brandHeader()}
    <div class="page-header"><div class="title">Servicios y precios</div><div class="subtitle">Selecciona cualquier servicio para reservar.</div></div>
    <div class="section-tight">
      ${groups.map(([cat, list]) => `<div class="category-title">${esc(cat)}</div><div class="card-list">${list.map(s => serviceButton(s, true)).join('')}</div>`).join('')}
    </div>
    ${bottomNav()}
  </section>`;
}

function bookingScreen() {
  const b = state.booking;
  if (b.success) return bookingSuccess();
  return `<section class="screen">
    ${brandHeader()}
    <div class="page-header"><div class="title">Reservar</div><div class="subtitle">Elige servicio, horario y confirma tus datos.</div></div>
    <div class="progress"><span class="${b.step >= 1 ? 'active' : ''}"></span><span class="${b.step >= 2 ? 'active' : ''}"></span><span class="${b.step >= 3 ? 'active' : ''}"></span></div>
    ${b.step === 1 ? bookingStepService() : ''}
    ${b.step === 2 ? bookingStepTime() : ''}
    ${b.step === 3 ? bookingStepConfirm() : ''}
    ${bottomNav()}
  </section>`;
}

function bookingStepService() {
  const groups = Object.entries(state.groupedServices || {});
  const rb = state.booking.rebook;
  return `<div class="booking-step">
    <div class="card" style="margin-bottom:16px">
      <div class="eyebrow">¿YA NOS VISITASTE?</div>
      <div class="subtitle" style="margin:6px 0 10px">Ingresa tu WhatsApp y reserva de nuevo en un paso.</div>
      <div class="form-grid two-col">
        <input value="${esc(rb.whatsapp)}" data-rebook-whatsapp inputmode="tel" placeholder="33 0000 0000">
        <button class="btn btn-outline btn-small" data-rebook-lookup ${rb.checking ? 'disabled' : ''}>${rb.checking ? 'BUSCANDO…' : 'BUSCAR'}</button>
      </div>
      ${rb.error ? `<div class="error-box">${esc(rb.error)}</div>` : ''}
      ${rb.checked && !rb.found ? `<div class="service-meta" style="margin-top:8px">No encontramos citas anteriores con ese WhatsApp.</div>` : ''}
      ${rb.found && rb.service?.active ? `
        <div class="card" style="margin-top:12px;background:var(--surface)">
          <div class="service-name">¡Hola de nuevo${rb.name ? ', ' + esc(rb.name) : ''}!</div>
          <div class="service-meta">Tu última cita fue: ${esc(rb.service.name)} · ${money(rb.service.price)}</div>
          <button class="btn btn-primary btn-small" style="margin-top:10px" data-rebook-apply>RESERVAR IGUAL OTRA VEZ</button>
        </div>` : ''}
      ${rb.found && rb.service && !rb.service.active ? `<div class="service-meta" style="margin-top:8px">Ese servicio ya no está disponible — elige uno nuevo abajo.</div>` : ''}
    </div>
    <div class="section-head"><div><div class="title">1. Servicio</div><div class="subtitle">¿Qué te quieres hacer?</div></div></div>
    ${groups.map(([cat, list]) => `<div class="category-title">${esc(cat)}</div><div class="card-list">${list.map(s => `<button class="card service-card selectable ${state.booking.serviceId === s.id ? 'active' : ''}" data-select-service="${esc(s.id)}"><span><span class="service-name">${esc(s.name)}</span><span class="service-meta">${esc(s.dur)} min · ${esc(s.desc)}</span></span><span class="price">$ ${esc(s.price)}</span></button>`).join('')}</div>`).join('')}
  </div>`;
}

function bookingStepTime() {
  const b = state.booking;
  const svc = serviceById(b.serviceId);
  const dates = dateOptions();
  const free = b.slots.filter(s => !s.busy).length;
  return `<div class="booking-step">
    <div class="section-head"><div><div class="title">2. Fecha y hora</div><div class="subtitle">${esc(svc?.name || '')} · ${svc ? money(svc.price) : ''}</div></div><button class="pill-button" data-step="1">CAMBIAR</button></div>
    <div class="date-row">${dates.map(d => `<button class="date-chip ${b.date === d.ymd ? 'active' : ''}" data-date="${d.ymd}"><b>${d.day}</b><span>${d.num}</span></button>`).join('')}</div>
    <div class="form-field compact-field"><label>Otra fecha</label><input type="date" min="${todayLocal()}" value="${esc(b.date)}" data-booking-date-input></div>
    <div class="fomo" style="justify-content:flex-start;padding:0 0 10px"><span class="dot"></span><span>${free ? `QUEDAN ${free} HORARIOS` : 'SIN HORARIOS DISPONIBLES'} · los horarios ocupados se bloquean automáticamente</span></div>
    ${b.loadingSlots ? `<div class="empty">Cargando horarios…</div>` : `<div class="time-grid">${b.slots.map(s => `<button class="time-btn ${b.time === s.time ? 'active' : ''} ${s.busy ? 'busy' : ''}" ${s.busy ? 'disabled aria-disabled="true"' : ''} data-time="${s.time}"><span>${s.time}</span>${s.busy ? '<small>Ocupado</small>' : '<small>Libre</small>'}</button>`).join('')}</div>`}
    ${b.error ? `<div class="error-box">${esc(b.error)}</div>` : ''}
    <button class="btn btn-primary" style="margin-top:16px" data-step="3" ${!b.time ? 'disabled' : ''}>CONTINUAR</button>
  </div>`;
}

function bookingStepConfirm() {
  const b = state.booking;
  const svc = serviceById(b.serviceId);
  const discount = svc ? discountedPriceFor(svc) : null;
  const cfg = state.salonConfig || {};
  const dl = (id, list) => list?.length ? `<datalist id="${id}">${list.map(v => `<option value="${esc(v)}">`).join('')}</datalist>` : '';
  return `<div class="booking-step">
    <div class="section-head"><div><div class="title">3. Confirmar</div><div class="subtitle">Revisa tus datos antes de apartar tu lugar.</div></div><button class="pill-button" data-step="2">CAMBIAR</button></div>
    <div class="card info-grid" style="margin-bottom:16px">
      <div class="info-line"><strong>Servicio</strong><span>${esc(svc?.name || '')}</span></div>
      <div class="info-line"><strong>Fecha</strong><span>${esc(b.date)}</span></div>
      <div class="info-line"><strong>Hora</strong><span>${esc(b.time)}</span></div>
      <div class="info-line"><strong>Total</strong><span>${svc ? priceDisplay(svc) : ''}</span></div>
      ${discount ? `<div class="info-line"><strong>Promoción</strong><span>${esc(discount.promo.label || 'Descuento aplicado')}</span></div>` : ''}
    </div>
    <div class="form-grid two-col">
      <div class="form-field"><label>Nombre</label><input value="${esc(b.name)}" data-field="name" placeholder="Tu nombre"></div>
      <div class="form-field"><label>WhatsApp</label><input value="${esc(b.whatsapp)}" data-field="whatsapp" inputmode="tel" placeholder="33 0000 0000"></div>
    </div>
    <div class="form-field"><label>¿Tienes un código de promoción?</label><input value="${esc(b.promoCode)}" data-field="promoCode" placeholder="Opcional, ej. VERANO15" style="text-transform:uppercase"></div>
    <div class="card preference-card">
      <div class="section-head compact-head"><div><div class="title">Perfil de clienta</div><div class="subtitle">Opcional: esto ayuda al salón a recordar tus gustos para próximas visitas.</div></div></div>
      ${dl('dl-estilos', cfg.estilos)}
      ${dl('dl-colors', cfg.colors)}
      ${dl('dl-bebidas', cfg.bebidas)}
      <div class="form-grid two-col">
        <div class="form-field"><label>Estilo preferido</label><input value="${esc(b.styleChoice)}" data-field="styleChoice" list="dl-estilos" placeholder="${esc((cfg.estilos||['Natural, french, editorial...']).join(', '))}"></div>
        <div class="form-field"><label>Color favorito</label><input value="${esc(b.colorChoice)}" data-field="colorChoice" list="dl-colors" placeholder="${esc((cfg.colors||['Nude, rojo, negro...']).join(', '))}"></div>
        <div class="form-field"><label>Bebida preferida</label><input value="${esc(b.drinkChoice)}" data-field="drinkChoice" list="dl-bebidas" placeholder="${esc((cfg.bebidas||['Café, té, agua...']).join(', '))}"></div>
        <div class="form-field"><label>Horario preferido</label><input value="${esc(b.timePreference)}" data-field="timePreference" placeholder="Mañana, tarde, sábado..."></div>
      </div>
      <div class="form-field"><label>Alergias o cuidados</label><input value="${esc(b.allergies)}" data-field="allergies" placeholder="Ej. piel sensible, alergia a algún producto"></div>
      <div class="form-field"><label>Nota para tu cita</label><textarea data-field="notes" rows="3" placeholder="Idea de diseño, ocasión especial, referencia, etc.">${esc(b.notes)}</textarea></div>
    </div>
    ${b.error ? `<div class="error-box">${esc(b.error)}</div>` : ''}
    <button class="btn btn-primary" data-confirm-booking>CONFIRMAR CITA</button>
  </div>`;
}

function bookingSuccess() {
  const data = state.booking.success;
  const a = data.appointment;
  return `<section class="screen">
    <div class="success">
      <div>
        <div class="check">✓</div>
        <div class="eyebrow">CITA APARTADA</div>
        <div class="folio">${esc(a.folio)}</div>
        <div class="subtitle">${esc(a.serviceName)}<br>${esc(a.date)} · ${esc(a.time)}</div>
        ${a.appliedPromotion ? `<div class="card promo-card" style="margin:14px 0"><div class="eyebrow">${esc(a.appliedPromotion.label || 'PROMOCIÓN APLICADA')}</div><div class="subtitle">Precio original ${money(a.originalServicePrice)} → pagas ${money(a.servicePrice)}</div></div>` : `<div class="subtitle" style="margin:10px 0">Total: ${money(a.servicePrice)}</div>`}
        <p class="subtitle" style="margin:18px 0">${esc(data.note)}</p>
        <div class="success-actions">
          <a class="btn btn-primary" target="_blank" rel="noopener" href="${esc(data.whatsappUrl)}">CONFIRMAR POR WHATSAPP</a>
          <a class="btn btn-outline" target="_blank" rel="noopener" href="${esc(data.addToCalendarUrl || a.googleCalendarUrl || '#')}">AGREGAR A MI CALENDARIO</a>
          <button class="btn btn-outline" data-reset-booking>NUEVA CITA</button>
        </div>
        <div class="reminder-note">Te enviaremos recordatorio si la automatización de WhatsApp está conectada. También puedes guardar la cita en tu calendario.</div>
      </div>
    </div>
    ${bottomNav()}
  </section>`;
}

function galleryScreen() {
  const all = state.media?.gallery || [];
  // Merge categories from uploaded media + those configured in admin
  const mediaCats = state.media?.categories || [];
  const configCats = state.salonConfig?.galleryCategories || [];
  const categories = [...new Set([...mediaCats, ...configCats])].filter(Boolean);
  const filter = state.galleryFilter || '';
  const search = (state.gallerySearch || '').toLowerCase();
  const filtered = all.filter(m =>
    (!filter || m.category === filter) &&
    (!search || (m.title||'').toLowerCase().includes(search))
  );
  state.galleryFilteredCache = filtered;
  const visibleCount = state.galleryVisibleCount || 9;
  const visible = filtered.slice(0, visibleCount);
  return `<section class="screen">
    ${brandHeader()}
    <div class="page-header"><div class="title">Galería</div><div class="subtitle">Resultados reales de nuestras clientas.</div></div>
    ${categories.length ? `<div class="pill-row" style="padding:0 16px 10px;flex-wrap:wrap">
      <button class="pill-button ${!filter ? 'active' : ''}" data-gallery-filter="">TODAS</button>
      ${categories.map(cat => `<button class="pill-button ${filter === cat ? 'active' : ''}" data-gallery-filter="${esc(cat)}">${esc(cat)}</button>`).join('')}
    </div>` : ''}
    <div class="masonry-grid">
      ${visible.length ? visible.map((m, i) => masonryItem(m, i)).join('') : `<div class="empty">Aún no hay fotos ${filter || search ? 'que coincidan con tu búsqueda' : 'en la galería'}.</div>`}
    </div>
    ${visible.length < filtered.length ? `<div class="section" style="text-align:center"><button class="btn btn-outline" data-load-more-gallery>CARGAR MÁS</button></div>` : ''}
    <div class="section"><a class="btn btn-outline" target="_blank" rel="noopener" href="${esc(state.config.contact.instagramUrl)}">VER ${esc(state.config.contact.instagramHandle)} EN INSTAGRAM</a></div>
    ${bottomNav()}
  </section>`;
}

function masonryItem(m, index) {
  const isVideo = m.kind === 'video';
  return `<div class="masonry-item" data-open-lightbox="${index}" data-lightbox-list="gallery">
    ${m.category ? `<span class="masonry-category-chip">${esc(m.category)}</span>` : ''}
    ${isVideo
      ? `<video src="${esc(m.url)}" muted loop playsinline poster="${esc(m.posterUrl || '')}"></video>`
      : `<img src="${esc(m.url)}" alt="${esc(m.title || 'Resultado Black Rococo')}" loading="lazy">`}
    ${(m.title || m.description) ? `<div class="masonry-caption"><div class="cap-title">${esc(m.title)}</div>${m.description ? `<div class="cap-desc">${esc(m.description)}</div>` : ''}</div>` : ''}
  </div>`;
}

function courseById(id) {
  return (state.courses || []).find(c => c.id === id);
}

function courseImageCarousel(course) {
  const images = Array.isArray(course.imageUrls) ? course.imageUrls.filter(Boolean) : [];
  if (!images.length) return '';
  const idx = ((state.academia.imageIndex[course.id] || 0) % images.length + images.length) % images.length;
  return `<div class="carousel-frame">
    <img src="${esc(images[idx])}" alt="${esc(course.title)}" loading="lazy">
    ${images.length > 1 ? `
      <button class="carousel-arrow left" data-carousel-prev="${esc(course.id)}" aria-label="Foto anterior">‹</button>
      <button class="carousel-arrow right" data-carousel-next="${esc(course.id)}" aria-label="Foto siguiente">›</button>
      <div class="carousel-dots">${images.map((_, i) => `<span class="dot ${i === idx ? 'active' : ''}"></span>`).join('')}</div>
    ` : ''}
  </div>`;
}

function academiaScreen() {
  const ac = state.academia;
  if (ac.success) return academiaSuccessScreen();
  const courses = state.courses || [];
  const selected = ac.selectedCourseId ? courseById(ac.selectedCourseId) : null;
  return `<section class="screen">
    ${brandHeader()}
    <div class="page-header"><div class="title">Black Rococo Academy</div><div class="subtitle">Cursos y talleres profesionales de manicure y nail art.</div></div>
    <div class="section-tight">
      ${courses.length ? `<div class="card-list">${courses.map(c => `<div class="card service-detail">
        ${courseImageCarousel(c)}
        <div class="top">
          <div>
            <div class="service-name">${esc(c.title)}</div>
            <p>${esc(c.description)}</p>
            <div class="service-meta">${esc(c.duration)}${c.level ? ` · ${esc(c.level)}` : ''}${c.startDate ? ` · Próxima fecha: ${esc(formatDate(c.startDate))}` : ''}${c.capacity ? ` · Cupo: ${esc(c.capacity)}` : ''}</div>
          </div>
          <div class="price">${money(c.price)}</div>
        </div>
        <button class="btn btn-outline btn-small" data-select-course="${esc(c.id)}">INSCRIBIRME</button>
      </div>`).join('')}</div>` : `<div class="empty">Muy pronto anunciaremos nuevos cursos. Síguenos en Instagram para no perderte la fecha.</div>`}
    </div>
    ${selected ? `<div class="card preference-card" style="margin:0 16px 20px">
      <div class="section-head compact-head"><div><div class="title">Inscripción: ${esc(selected.title)}</div><div class="subtitle">Te contactaremos por WhatsApp para confirmar tu lugar.</div></div><button class="pill-button" data-cancel-course-select>CANCELAR</button></div>
      <div class="form-grid two-col">
        <div class="form-field"><label>Nombre</label><input value="${esc(ac.name)}" data-academia-field="name" placeholder="Tu nombre"></div>
        <div class="form-field"><label>WhatsApp</label><input value="${esc(ac.whatsapp)}" data-academia-field="whatsapp" inputmode="tel" placeholder="33 0000 0000"></div>
      </div>
      <div class="form-field"><label>Email (opcional)</label><input value="${esc(ac.email)}" data-academia-field="email" placeholder="tu@correo.com"></div>
      <div class="form-field"><label>Comentarios (opcional)</label><textarea data-academia-field="notes" rows="3" placeholder="Experiencia previa, dudas, etc.">${esc(ac.notes)}</textarea></div>
      ${ac.error ? `<div class="error-box">${esc(ac.error)}</div>` : ''}
      <button class="btn btn-primary" data-confirm-course-registration>CONFIRMAR INSCRIPCIÓN</button>
    </div>` : ''}
    ${bottomNav()}
  </section>`;
}

function academiaSuccessScreen() {
  const data = state.academia.success;
  return `<section class="screen">
    <div class="success">
      <div>
        <div class="check">✓</div>
        <div class="eyebrow">INSCRIPCIÓN RECIBIDA</div>
        <div class="subtitle" style="margin:18px 0">${esc(data.note)}</div>
        <div class="success-actions">
          <a class="btn btn-primary" target="_blank" rel="noopener" href="${esc(data.whatsappUrl)}">CONFIRMAR POR WHATSAPP</a>
          <button class="btn btn-outline" data-reset-academia>VER MÁS CURSOS</button>
        </div>
      </div>
    </div>
    ${bottomNav()}
  </section>`;
}

function bottomNav() {
  const tabs = [
    ['inicio', 'INICIO'],
    ['servicios', 'SERVICIOS'],
    ['reservar', 'RESERVAR'],
    ['academia', 'ACADEMIA'],
    ['galeria', 'GALERÍA']
  ];
  // WhatsApp FAB — a circular action button, per the design system. The old
  // pill said "WhatsApp"; the icon says it faster and takes less of the screen.
  const waFab = `<a class="wa-fab" target="_blank" rel="noopener" href="${esc(whatsappChatUrl())}" aria-label="Chatear por WhatsApp">${socialIconSvg('whatsapp')}</a>`;

  return `${waFab}<nav class="bottom-nav" aria-label="Navegación principal">${tabs.map(([id, label]) => `<button class="bottom-tab ${state.tab === id ? 'active' : ''}" data-tab="${id}"><span>${label}</span><span class="nav-dot"></span></button>`).join('')}</nav>`;
}

function adminScreen() {
  if (!state.admin.loggedIn) return adminLoginScreen();
  const data = state.admin.data;
  return `<section class="admin-screen">
    <div class="admin-panel-head">
      <div><div class="title">Hola, Admin</div><div class="subtitle">Agenda del ${esc(data?.date || '')}</div></div>
      <div class="pill-row">
        <button class="pill-button" data-action="client">VER SITIO</button>
        <button class="pill-button" data-logout>SALIR</button>
      </div>
    </div>
    <div class="stats">
      <div class="card"><div class="eyebrow">CITAS HOY</div><div class="stat-number">${esc(data?.count || 0)}</div></div>
      <div class="card"><div class="eyebrow">INGRESO EST.</div><div class="stat-number">${money(data?.estimatedIncome || 0)}</div></div>
      <div class="card"><div class="eyebrow">NOTIFICACIONES</div><div class="stat-number">${esc(data?.unreadNotifications || 0)}</div></div>
    </div>
    <div class="pill-row admin-tabs">
      ${[['agenda','AGENDA'],['notificaciones',`NOTIFICACIONES${data?.unreadNotifications ? ` (${data.unreadNotifications})` : ''}`],['servicios','SERVICIOS'],['promociones','PROMOCIONES'],['clientas','CLIENTAS'],['equipo','EQUIPO'],['academia','ACADEMIA'],['galeria','GALERÍA'],['publicar','PUBLICAR'],['integraciones','INTEGRACIONES'],['configuracion','CONFIGURACIÓN']].map(([id,label]) => `<button class="pill-button ${state.admin.tab === id ? 'active' : ''}" data-admin-tab="${id}">${label}</button>`).join('')}
    </div>
    ${state.admin.error ? `<div class="error-box">${esc(state.admin.error)}</div>` : ''}
    ${state.admin.tab === 'agenda' ? adminAgenda(data) : ''}
    ${state.admin.tab === 'notificaciones' ? adminNotifications(data) : ''}
    ${state.admin.tab === 'servicios' ? adminServices(data) : ''}
    ${state.admin.tab === 'promociones' ? adminPromotions(data) : ''}
    ${state.admin.tab === 'clientas' ? adminClients(data) : ''}
    ${state.admin.tab === 'equipo' ? adminStaff(data) : ''}
    ${state.admin.tab === 'academia' ? adminAcademia(data) : ''}
    ${state.admin.tab === 'galeria' ? adminGallery(data) : ''}
    ${state.admin.tab === 'publicar' ? adminPublish(data) : ''}
    ${state.admin.tab === 'integraciones' ? adminIntegrations() : ''}
    ${state.admin.tab === 'configuracion' ? adminConfiguracion(data) : ''}
  </section>`;
}

function adminLoginScreen() {
  const [one, two] = splitBrand(state.config?.brand?.name || 'BLACK ROCOCO');
  return `<section class="admin-login">
    <div class="gold-rule"></div>
    <div class="logo" style="margin:10px 0 4px">${esc(one)}<br>${esc(two)}</div>
    <div class="tagline">PANEL ADMINISTRATIVO</div>
    <div class="card" style="width:100%;margin-top:28px;text-align:left">
      <div class="form-field"><label>Correo</label><input data-admin-field="email" value="${esc(state.admin.email)}" placeholder="admin@blackrococo.mx"></div>
      <div class="form-field"><label>Contraseña</label><input data-admin-field="password" value="${esc(state.admin.password)}" type="password" placeholder="rococo2026"></div>
      ${state.admin.error ? `<div class="error-box">${esc(state.admin.error)}</div>` : ''}
      <button class="btn btn-dark" data-admin-login>ENTRAR</button>
    </div>
    <button class="pill-button" style="margin-top:18px" data-action="client">VOLVER AL SITIO</button>
  </section>`;
}

function adminAgenda(data) {
  const list = data?.appointments || [];
  const times = state.config?.booking?.times || [];
  const view = state.admin.agendaView || 'daily';
  const mb = state.admin.manualBooking;

  // Manual booking form (Story 21)
  const services = data?.services?.filter(s => s.active) || [];
  const manualBookingForm = mb?.open ? `<div class="card manual-booking-card">
    <div class="section-head compact-head"><div><div class="title">Nueva Cita Manual</div><div class="subtitle">Walk-in, llamada o WhatsApp</div></div><button class="pill-button" data-close-manual-booking>CANCELAR</button></div>
    <div class="form-grid two-col">
      <div class="form-field"><label>Nombre de clienta</label><input value="${esc(mb.name||'')}" data-mb-field="name" placeholder="Nombre"></div>
      <div class="form-field"><label>WhatsApp</label><input value="${esc(mb.whatsapp||'')}" data-mb-field="whatsapp" inputmode="tel" placeholder="33 0000 0000"></div>
    </div>
    <div class="form-field"><label>Servicio</label><select data-mb-field="serviceId">
      <option value="">Seleccionar servicio...</option>
      ${services.map(s => `<option value="${esc(s.id)}" ${mb.serviceId === s.id ? 'selected' : ''}>${esc(s.name)} · ${money(s.price)} · ${s.dur} min</option>`).join('')}
    </select></div>
    <div class="form-grid two-col">
      <div class="form-field"><label>Fecha</label><input type="date" value="${esc(mb.date||todayLocal())}" data-mb-field="date" min="${todayLocal()}"></div>
      <div class="form-field"><label>Hora</label><select data-mb-field="time">
        <option value="">Seleccionar hora...</option>
        ${times.map(t => `<option value="${t}" ${mb.time === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select></div>
    </div>
    <div class="form-field"><label>Notas (opcional)</label><input value="${esc(mb.notes||'')}" data-mb-field="notes" placeholder="Nota interna..."></div>
    ${mb.error ? `<div class="error-box">${esc(mb.error)}</div>` : ''}
    ${mb.success ? `<div class="success-inline">✓ Cita creada: ${esc(mb.success)}</div>` : ''}
    <button class="btn btn-primary" data-confirm-manual-booking ${mb.saving ? 'disabled' : ''}>${mb.saving ? 'GUARDANDO...' : 'CREAR CITA'}</button>
  </div>` : '';

  if (view === 'weekly') return adminAgendaWeekly(data, list, times) + manualBookingForm;

  // Daily calendar grid view
  const timeSlots = times.length ? times : ['09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00'];
  const apptMap = {};
  list.forEach(a => { apptMap[a.time] = a; });

  return `<div class="agenda-controls">
    <div class="pill-row">
      <button class="pill-button ${view === 'daily' ? 'active' : ''}" data-agenda-view="daily">DÍA</button>
      <button class="pill-button ${view === 'weekly' ? 'active' : ''}" data-agenda-view="weekly">SEMANA</button>
    </div>
    <button class="btn btn-primary btn-small" data-open-manual-booking>+ NUEVA CITA</button>
  </div>
  <div class="calendar-grid">
    ${timeSlots.map(time => {
      const appt = apptMap[time];
      return `<div class="cal-slot ${appt ? 'cal-booked cal-status-' + esc(appt.status) : 'cal-free'}">
        <div class="cal-time">${time}</div>
        ${appt ? `<div class="cal-appt">
          <div class="cal-client">${esc(appt.clientName)}</div>
          <div class="cal-service">${esc(appt.serviceName)}</div>
          <div class="cal-meta">${money(appt.servicePrice)} · <button class="status-chip-sm ${esc(appt.status)}" data-cycle-status="${esc(appt.id)}" data-current-status="${esc(appt.status)}">${esc(appt.statusLabel)}</button></div>
        </div>` : `<div class="cal-empty">Disponible</div>`}
      </div>`;
    }).join('')}
  </div>
  ${manualBookingForm}`;
}

function adminAgendaWeekly(data, list, times) {
  const weekDays = [];
  const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const startOfWeek = startOfWeekLocal(new Date()); // Monday-start, Sunday-safe
  for (let i = 0; i < 7; i++) {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    const ymd = ymdLocal(d); // local, not UTC — see ymdLocal()
    weekDays.push({ ymd, name: dayNames[d.getDay()], num: d.getDate(), isToday: ymd === todayLocal() });
  }

  // Load weekly data from cache or show what we have
  const weekAppts = state.admin.weeklyAppointments || [];
  const allAppts = [...list, ...weekAppts.filter(wa => !list.find(l => l.id === wa.id))];
  const timeSlots = times.length ? times.slice(0, 12) : ['09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00'];

  return `<div class="agenda-controls">
    <div class="pill-row">
      <button class="pill-button ${(state.admin.agendaView||'daily') === 'daily' ? 'active' : ''}" data-agenda-view="daily">DÍA</button>
      <button class="pill-button ${(state.admin.agendaView||'daily') === 'weekly' ? 'active' : ''}" data-agenda-view="weekly">SEMANA</button>
    </div>
    <button class="btn btn-primary btn-small" data-open-manual-booking>+ NUEVA CITA</button>
  </div>
  <div class="weekly-grid-wrap">
    <div class="weekly-grid" style="grid-template-columns: 60px repeat(7, 1fr)">
      <div class="wg-header wg-corner"></div>
      ${weekDays.map(d => `<div class="wg-header ${d.isToday ? 'wg-today' : ''}">${d.name}<br><b>${d.num}</b></div>`).join('')}
      ${timeSlots.map(time => {
        return `<div class="wg-time">${time}</div>` + weekDays.map(d => {
          const appt = allAppts.find(a => a.date === d.ymd && a.time === time);
          return `<div class="wg-cell ${appt ? 'wg-booked wg-status-' + esc(appt.status) : ''} ${d.isToday ? 'wg-today-col' : ''}">
            ${appt ? `<div class="wg-appt-name">${esc(appt.clientName?.split(' ')[0] || '')}</div><div class="wg-appt-svc">${esc(appt.serviceName?.split(' ').slice(0,2).join(' ') || '')}</div>` : ''}
          </div>`;
        }).join('');
      }).join('')}
    </div>
  </div>`;}


function notificationStatusLabel(status) {
  const labels = {
    unread: 'NUEVA',
    queued: 'ENVIANDO',
    sent: 'ENVIADO',
    failed: 'FALLÓ',
    setup_required: 'FALTA CONFIGURAR'
  };
  return labels[status] || String(status || '').toUpperCase();
}

function adminNotifications(data) {
  const list = data?.notifications || [];
  const i = data?.integrations || {};
  return `<div class="card-list notifications-list">
    <div class="card integration-card">
      <div class="section-head compact-head">
        <div><div class="title">Centro de notificaciones</div><div class="subtitle">Citas, Google Calendar, WhatsApp y recordatorios.</div></div>
        <div class="pill-row">
          ${data?.unreadNotifications ? `<button class="pill-button" data-mark-all-notifications>MARCAR LEÍDAS</button>` : ''}
          ${list.length ? `<button class="pill-button" style="color:var(--red)" data-clear-all-notifications>LIMPIAR TODO</button>` : ''}
        </div>
      </div>
      <div class="integration-grid">
        <div><b>Google Calendar</b><span>${i.googleCalendarConfigured ? '✓ Conectado' : '⚠ Pendiente configurar'}</span></div>
        <div><b>WhatsApp Admin</b><span>${i.whatsappAdminConfigured ? '✓ Conectado' : '⚠ Pendiente configurar'}</span></div>
        <div><b>Recordatorios</b><span>${i.clientReminderConfigured ? `✓ Activo ${esc((i.reminderHours || []).join(', '))} h antes` : '⚠ Pendiente configurar'}</span></div>
      </div>
    </div>
    ${list.length ? list.map(n => {
      let actions = '';
      if (n.actionLabel === 'multi' && n.actionUrl) {
        try {
          const multi = JSON.parse(n.actionUrl);
          if (multi.whatsapp?.url) actions += `<a class="mini-action" target="_blank" rel="noopener" href="${esc(multi.whatsapp.url)}">${esc(multi.whatsapp.label)}</a>`;
          if (multi.calendar?.url) actions += `<a class="mini-action" target="_blank" rel="noopener" href="${esc(multi.calendar.url)}">${esc(multi.calendar.label)}</a>`;
          if (multi.agenda) actions += `<button class="mini-action" data-admin-tab="agenda">Ver agenda</button>`;
        } catch (_) {
          if (n.actionUrl) actions = `<a class="mini-action" target="_blank" rel="noopener" href="${esc(n.actionUrl)}">${esc(n.actionLabel || 'Abrir')}</a>`;
        }
      } else if (n.actionUrl) {
        actions = `<a class="mini-action" target="_blank" rel="noopener" href="${esc(n.actionUrl)}">${esc(n.actionLabel || 'Abrir')}</a>`;
      }
      const ts = new Date(n.createdAt);
      const timeAgo = formatTimeAgo(ts);
      return `<div class="notification-row ${n.unread ? 'unread' : ''}">
        <div class="notification-top">
          <div class="notif-title">${esc(n.title)}</div>
          <span class="notify-status ${esc(n.status)}">${esc(notificationStatusLabel(n.status))}</span>
        </div>
        <div class="notif-message">${esc(n.message)}</div>
        <div class="notif-time">${timeAgo} · ${ts.toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
        <div class="row-actions">
          ${actions}
          ${n.unread ? `<button class="mini-action" data-mark-notification="${esc(n.id)}">Marcar leída</button>` : ''}
          <button class="mini-action notif-delete" data-delete-notification="${esc(n.id)}">Eliminar</button>
        </div>
        ${n.error ? `<div class="error-box">${esc(n.error)}</div>` : ''}
      </div>`;
    }).join('') : `<div class="empty">No hay notificaciones todavía.</div>`}
  </div>`;
}


function adminServices(data) {
  const services = data?.services || [];
  const categories = [...new Set(services.map(s => s.cat))];
  const featuredIds = data?.featuredServiceIds || [];
  const editing = state.admin.editingServiceId ? services.find(s => s.id === state.admin.editingServiceId) : null;
  return `<div class="card-list">
    <form class="card" data-service-form="${editing ? esc(editing.id) : ''}">
      <div class="eyebrow">${editing ? 'EDITAR SERVICIO' : 'NUEVO SERVICIO'}</div>
      <div class="form-field"><label>Nombre</label><input name="name" value="${esc(editing?.name || '')}" placeholder="Ej. Baño de acrílico"></div>
      <div class="form-grid two-col">
        <div class="form-field"><label>Categoría</label><input name="cat" list="service-categories" value="${esc(editing?.cat || '')}" placeholder="MANOS, PIES, EXTRAS..."></div>
        <datalist id="service-categories">${[...new Set([...categories,...(state.salonConfig?.serviceCategories||[]).map(c=>c.toUpperCase())])].map(cat => `<option value="${esc(cat)}">`).join('')}</datalist>
        <div class="form-field"><label>Duración (min)</label><input type="number" min="5" name="dur" value="${esc(editing?.dur ?? 60)}"></div>
      </div>
      <div class="form-field"><label>Descripción</label><textarea name="desc" rows="2" placeholder="Descripción breve para clientas...">${esc(editing?.desc || '')}</textarea></div>
      <div class="form-grid two-col">
        <div class="form-field"><label>Precio</label><input type="number" min="0" name="price" value="${esc(editing?.price ?? 0)}"></div>
        <div class="form-field"><label>Orden (menor = primero)</label><input type="number" name="sort" value="${esc(editing?.sort ?? 0)}"></div>
      </div>
      <div class="form-field"><label>Fotos del servicio (hasta 3 — aparecen en carrusel)</label>
        ${[0,1,2].map(i => {
          const existingUrl = (editing?.imageUrls||[])[i] || (i===0 ? editing?.imageUrl||'' : '');
          return `<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
            ${existingUrl ? `<img src="${esc(existingUrl)}" style="width:48px;height:48px;object-fit:cover;border-radius:4px;flex-shrink:0">` : '<div style="width:48px;height:48px;background:var(--surface);border-radius:4px;flex-shrink:0"></div>'}
            <input name="imageFile${i}" type="file" accept="image/png,image/jpeg,image/webp,image/gif" style="flex:1">
            <input type="hidden" name="existingImageUrl${i}" value="${esc(existingUrl)}">
          </div>`;
        }).join('')}
      </div>
      <label class="pill-button" style="margin-bottom:8px"><input type="checkbox" name="active" ${(!editing || editing.active) ? 'checked' : ''}> Activo (visible en el sitio)</label>
      <label class="pill-button" style="margin-bottom:12px"><input type="checkbox" name="featured" ${editing && featuredIds.includes(editing.id) ? 'checked' : ''}> Destacado (aparece en el carrusel de inicio)</label>
      <div class="row-actions">
        <button class="btn btn-primary" type="submit">${editing ? 'GUARDAR CAMBIOS' : 'CREAR SERVICIO'}</button>
        ${editing ? `<button type="button" class="pill-button" data-cancel-service-edit>CANCELAR</button>` : ''}
      </div>
    </form>
    ${services.map(s => `<div class="admin-service-row">
      <div class="admin-service-main">
        <div><div class="service-name">${esc(s.name)}${featuredIds.includes(s.id) ? ' ★' : ''}</div><div class="service-meta">${esc(s.cat)} · ${esc(s.dur)} min · ${s.active ? 'Activo' : 'Pausado'}</div></div>
        <button class="toggle ${s.active ? 'active' : ''}" data-toggle-service="${esc(s.id)}" data-active="${s.active ? '1' : '0'}"><span></span></button>
      </div>
      <div class="admin-service-main">
        <div class="price">${money(s.price)}</div>
        <div class="price-stepper"><button class="icon-btn" data-price-step="${esc(s.id)}" data-delta="-10">−</button><button class="icon-btn" data-price-step="${esc(s.id)}" data-delta="10">+</button></div>
      </div>
      ${s.imageUrl ? `<div class="admin-thumb-row" style="margin-top:8px">${(s.imageUrls?.length ? s.imageUrls : [s.imageUrl]).filter(Boolean).map(url => `<img src="${esc(url)}" alt="Miniatura" class="admin-thumb">`).join('')}</div>` : ''}
      <div class="row-actions">
        ${(s.imageUrls?.length || s.imageUrl) ? `<button class="mini-action" data-view-service-images="${esc(s.id)}">Ver fotos</button>` : ''}
        <button class="mini-action" data-edit-service="${esc(s.id)}">Editar</button>
        <button class="mini-action" data-toggle-featured-service="${esc(s.id)}" data-featured="${featuredIds.includes(s.id) ? '1' : '0'}">${featuredIds.includes(s.id) ? 'Quitar de destacados' : 'Destacar'}</button>
        <button class="mini-action" data-delete-service="${esc(s.id)}">Eliminar</button>
      </div>
    </div>`).join('')}
  </div>`;
}

function adminPromotions(data) {
  const promos = data?.promotions || [];
  const services = data?.services || [];
  const categories = [...new Set(services.map(s => s.cat))];
  const editing = state.admin.editingPromoId ? promos.find(p => p.id === state.admin.editingPromoId) : null;
  return `<div class="card-list">
    <form class="card" data-promo-form="${editing ? esc(editing.id) : ''}">
      <div class="eyebrow">${editing ? 'EDITAR PROMOCIÓN' : 'NUEVA PROMOCIÓN'}</div>
      <div class="form-grid two-col">
        <div class="form-field"><label>Etiqueta</label><input name="label" value="${esc(editing?.label || '')}" placeholder="SOLO ESTA SEMANA"></div>
        <div class="form-field"><label>Código (opcional)</label><input name="code" value="${esc(editing?.code || '')}" placeholder="VERANO15"></div>
      </div>
      <div class="form-field"><label>Título</label><input name="title" value="${esc(editing?.title || '')}" placeholder="-15% en tu primera aplicación de poligel"></div>
      <div class="form-field"><label>Nota</label><input name="note" value="${esc(editing?.note || '')}" placeholder="Cupo limitado, menciona la promo al confirmar..."></div>
      <div class="form-field">
        <label>Imagen de la promoción (opcional)</label>
        <input type="file" accept="image/png,image/jpeg,image/webp" data-promo-image-input>
      </div>
      ${(state.admin.promoImageDraft || editing?.imageUrl) ? `<div class="staff-photo-preview">
        <img src="${esc(state.admin.promoImageDraft || editing.imageUrl)}" alt="">
        <button type="button" class="thumb-remove" data-remove-promo-image>×</button>
      </div>` : ''}
      <input type="hidden" name="imageUrl" value="${esc(state.admin.promoImageDraft || editing?.imageUrl || '')}">
      <div class="form-grid two-col">
        <div class="form-field"><label>Tipo</label><select name="type">
          <option value="percent" ${(!editing || editing.type === 'percent') ? 'selected' : ''}>Porcentaje %</option>
          <option value="fixed" ${editing?.type === 'fixed' ? 'selected' : ''}>Monto fijo $</option>
        </select></div>
        <div class="form-field"><label>Valor</label><input name="value" type="number" min="0" value="${esc(editing?.value ?? 15)}"></div>
      </div>
      <div class="form-grid two-col">
        <div class="form-field"><label>Aplica a</label><select name="scope">
          <option value="all" ${(!editing || editing.scope === 'all') ? 'selected' : ''}>Todos los servicios</option>
          <option value="category" ${editing?.scope === 'category' ? 'selected' : ''}>Una categoría</option>
          <option value="services" ${editing?.scope === 'services' ? 'selected' : ''}>Servicios específicos</option>
        </select></div>
        <div class="form-field"><label>Categoría (si aplica)</label><select name="categoryValue">
          <option value="">—</option>
          ${categories.map(cat => `<option value="${esc(cat)}" ${editing?.categoryValue === cat ? 'selected' : ''}>${esc(cat)}</option>`).join('')}
        </select></div>
      </div>
      <div class="form-field"><label>Servicios específicos (si aplica)</label>
        <div class="pill-row">
          ${services.map(s => `<label class="pill-button"><input type="checkbox" name="serviceIds" value="${esc(s.id)}" ${editing?.serviceIds?.includes(s.id) ? 'checked' : ''}> ${esc(s.name)}</label>`).join('')}
        </div>
      </div>
      <div class="form-grid two-col">
        <div class="form-field"><label>Fecha inicio (opcional)</label><input type="date" name="startDate" value="${esc(editing?.startDate || '')}"></div>
        <div class="form-field"><label>Fecha fin (opcional)</label><input type="date" name="endDate" value="${esc(editing?.endDate || '')}"></div>
      </div>
      <div class="form-field"><label>Límite de usos (0 = ilimitado)</label><input type="number" min="0" name="usageLimit" value="${esc(editing?.usageLimit ?? 0)}"></div>
      <div class="pill-row" style="margin:12px 0">
        <label class="pill-button"><input type="checkbox" name="autoApply" ${(!editing || editing.autoApply) ? 'checked' : ''}> Auto-aplicar (sin código)</label>
        <label class="pill-button"><input type="checkbox" name="active" ${(!editing || editing.active) ? 'checked' : ''}> Activa</label>
      </div>
      <div class="row-actions">
        <button class="btn btn-primary" type="submit">${editing ? 'GUARDAR CAMBIOS' : 'CREAR PROMOCIÓN'}</button>
        ${editing ? `<button type="button" class="pill-button" data-cancel-promo-edit>CANCELAR</button>` : ''}
      </div>
    </form>
    ${promos.length ? promos.map(p => `<div class="admin-service-row">
      <div class="admin-service-main">
        <div><div class="service-name">${esc(p.title)}${p.code ? ` · ${esc(p.code)}` : ''}</div><div class="service-meta">${p.type === 'fixed' ? money(p.value) : `${esc(p.value)}%`} · ${p.scope === 'all' ? 'Todos los servicios' : p.scope === 'category' ? `Categoría: ${esc(p.categoryValue)}` : 'Servicios específicos'} · usos: ${esc(p.usageCount)}${p.usageLimit ? `/${esc(p.usageLimit)}` : ''} · ${p.active ? 'Activa' : 'Pausada'}</div></div>
        <button class="toggle ${p.active ? 'active' : ''}" data-toggle-promo="${esc(p.id)}" data-active="${p.active ? '1' : '0'}"><span></span></button>
      </div>
      <div class="row-actions">
        <button class="mini-action" data-edit-promo="${esc(p.id)}">Editar</button>
        <button class="mini-action" data-delete-promo="${esc(p.id)}">Eliminar</button>
      </div>
    </div>`).join('') : `<div class="empty">No hay promociones todavía.</div>`}
  </div>`;
}

function adminAcademia(data) {
  const courses = data?.courses || [];
  const registrations = data?.courseRegistrations || [];
  const editing = state.admin.editingCourseId ? courses.find(c => c.id === state.admin.editingCourseId) : null;
  const draftImages = state.admin.courseImageDraft || [];
  return `<div class="card-list">
    <form class="card" data-course-form="${editing ? esc(editing.id) : ''}">
      <div class="eyebrow">${editing ? 'EDITAR CURSO' : 'NUEVO CURSO'}</div>
      <div class="form-field"><label>Título</label><input name="title" value="${esc(editing?.title || '')}" placeholder="Certificación en Poligel"></div>
      <div class="form-field"><label>Descripción</label><textarea name="description" rows="3" placeholder="Aprende técnicas profesionales...">${esc(editing?.description || '')}</textarea></div>
      <div class="form-grid two-col">
        <div class="form-field"><label>Precio</label><input type="number" min="0" name="price" value="${esc(editing?.price ?? 0)}"></div>
        <div class="form-field"><label>Duración</label><input name="duration" value="${esc(editing?.duration || '')}" placeholder="2 días (16 horas)"></div>
      </div>
      <div class="form-grid two-col">
        <div class="form-field"><label>Nivel</label><input name="level" value="${esc(editing?.level || '')}" placeholder="Principiante, avanzado..."></div>
        <div class="form-field"><label>Cupo</label><input type="number" min="0" name="capacity" value="${esc(editing?.capacity ?? 0)}"></div>
      </div>
      <div class="form-field"><label>Próxima fecha (opcional)</label><input type="date" name="startDate" value="${esc(editing?.startDate || '')}"></div>
      <div class="form-field">
        <label>Fotos del curso (puedes subir varias)</label>
        <input type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" data-course-image-input>
        ${state.admin.courseImageUploading ? `<div class="empty">Subiendo imágenes…</div>` : ''}
        ${draftImages.length ? `<div class="admin-thumb-row">${draftImages.map((url, i) => `<div class="admin-thumb-wrap"><img src="${esc(url)}" alt="Miniatura" class="admin-thumb"><button type="button" class="thumb-remove" data-remove-course-image="${i}" aria-label="Quitar foto">✕</button></div>`).join('')}</div>` : `<div class="service-meta" style="margin-top:6px">Sin fotos todavía.</div>`}
      </div>
      <label class="pill-button" style="margin-bottom:12px"><input type="checkbox" name="active" ${(!editing || editing.active) ? 'checked' : ''}> Activo (visible en el sitio)</label>
      <div class="row-actions">
        <button class="btn btn-primary" type="submit">${editing ? 'GUARDAR CAMBIOS' : 'CREAR CURSO'}</button>
        ${editing ? `<button type="button" class="pill-button" data-cancel-course-edit>CANCELAR</button>` : ''}
      </div>
    </form>
    ${courses.length ? courses.map(c => `<div class="admin-service-row">
      <div class="admin-service-main">
        <div><div class="service-name">${esc(c.title)}</div><div class="service-meta">${money(c.price)} · ${esc(c.duration)} · Cupo ${esc(c.capacity)} · ${c.active ? 'Activo' : 'Pausado'}</div></div>
        <button class="toggle ${c.active ? 'active' : ''}" data-toggle-course="${esc(c.id)}" data-active="${c.active ? '1' : '0'}"><span></span></button>
      </div>
      ${c.imageUrls && c.imageUrls.length ? `<div class="admin-thumb-row">${c.imageUrls.map(url => `<img src="${esc(url)}" alt="Miniatura" class="admin-thumb">`).join('')}</div>` : ''}
      <div class="row-actions">
        <button class="mini-action" data-edit-course="${esc(c.id)}">Editar</button>
        <button class="mini-action" data-delete-course="${esc(c.id)}">Eliminar</button>
      </div>
    </div>`).join('') : `<div class="empty">Aún no hay cursos.</div>`}
    <div class="card crm-intro">
      <div class="title">Inscripciones</div>
      <div class="subtitle">Nuevas alumnas registradas desde el sitio público.</div>
    </div>
    ${registrations.length ? registrations.map(r => `<div class="client-row client-card">
      <div class="client-card-head">
        <div><div class="service-name">${esc(r.name)}</div><div class="service-meta">${esc(r.courseTitle)} · WhatsApp: ${esc(r.whatsapp)}${r.email ? ` · ${esc(r.email)}` : ''}</div></div>
        <span class="status-chip ${esc(r.status)}">${esc(r.status === 'new' ? 'NUEVA' : r.status === 'confirmed' ? 'CONFIRMADA' : 'CANCELADA')}</span>
      </div>
      ${r.notes ? `<div class="service-meta">${esc(r.notes)}</div>` : ''}
      <div class="row-actions">
        <a class="mini-action" target="_blank" rel="noopener" href="${esc(whatsappTo(r.whatsapp, `Hola ${r.name} ✨ te escribimos de Black Rococo Academy sobre tu inscripción a "${r.courseTitle}".`))}">WhatsApp</a>
        ${r.status !== 'confirmed' ? `<button class="mini-action" data-confirm-registration="${esc(r.id)}">Confirmar</button>` : ''}
        ${r.status !== 'cancelled' ? `<button class="mini-action" data-cancel-registration="${esc(r.id)}">Cancelar</button>` : ''}
      </div>
    </div>`).join('') : `<div class="empty">Sin inscripciones todavía.</div>`}
  </div>`;
}

function adminClients(data) {
  const allClients = data?.clients || [];
  const selected = state.admin.selectedClientId ? clientById(state.admin.selectedClientId) : null;
  if (selected) return adminClientProfile(selected);
  const search = (state.admin.clientSearch || '').toLowerCase();
  const clients = search ? allClients.filter(c =>
    c.name.toLowerCase().includes(search) ||
    c.whatsapp.includes(search) ||
    (c.favoriteService || '').toLowerCase().includes(search)
  ) : allClients;
  return `<div class="card-list clients-crm-list">
    <div class="card crm-intro">
      <div class="title">CRM de clientas (${allClients.length})</div>
      <div class="subtitle">Historial, próxima cita, servicios anteriores y preferencias para dar atención personalizada.</div>
      <div class="form-field" style="margin-top:10px"><input placeholder="Buscar por nombre, WhatsApp o servicio..." data-admin-clients-search value="${esc(state.admin.clientSearch||'')}"></div>
    </div>
    ${clients.length ? clients.map(c => `<div class="client-row client-card">
      <div class="client-card-head">
        <div><div class="service-name">${esc(c.name)}</div><div class="service-meta">WhatsApp: ${esc(c.whatsapp)} · Visitas: ${esc(c.visits)} · Última: ${esc(c.lastVisit || 'Sin cita')}</div></div>
        <button class="mini-action" data-client-profile="${esc(c.id)}">Ver perfil</button>
      </div>
      <div class="client-kpis">
        <span>Próxima: ${c.nextAppointment ? `${esc(c.nextAppointment.date)} ${esc(c.nextAppointment.time)}` : 'Sin próxima cita'}</span>
        <span>Favorito: ${esc(c.favoriteService || 'Sin historial')}</span>
        <span>Gastado completado: ${money(c.totalSpent || 0)}</span>
      </div>
      <div class="service-meta">${esc(profileSummary(c))}</div>
    </div>`).join('') : `<div class="empty">${search ? `No se encontraron clientas con "${esc(search)}"` : 'Aún no hay clientas.'}</div>`}
  </div>`;
}

function appointmentMiniCard(a) {
  return `<div class="history-row">
    <div><div class="service-name">${esc(a.serviceName)}</div><div class="service-meta">${esc(formatDate(a.date))} · ${esc(a.time)} · ${money(a.servicePrice)}</div></div>
    <span class="status-chip ${esc(a.status)}">${esc(a.statusLabel)}</span>
  </div>`;
}

function adminClientProfile(c) {
  const history = c.appointmentHistory || [];
  const pastServices = c.pastServices || [];
  return `<div class="client-profile-screen">
    <div class="section-head compact-head profile-head">
      <div><div class="title">${esc(c.name)}</div><div class="subtitle">Perfil completo de clienta · ${esc(c.whatsapp)}</div></div>
      <button class="pill-button" data-client-back>VOLVER</button>
    </div>
    <div class="client-profile-grid">
      <div class="card profile-summary-card">
        <div class="eyebrow">RESUMEN</div>
        <div class="profile-stats">
          <div><b>${esc(c.visits || 0)}</b><span>Visitas</span></div>
          <div><b>${esc(c.completedVisits || 0)}</b><span>Completadas</span></div>
          <div><b>${money(c.totalSpent || 0)}</b><span>Ingresos completados</span></div>
        </div>
        <div class="info-grid profile-info-grid">
          <div class="info-line"><strong>Última cita</strong><span>${esc(c.lastAppointment ? `${c.lastAppointment.date} ${c.lastAppointment.time}` : c.lastVisit || 'Sin historial')}</span></div>
          <div class="info-line"><strong>Próxima cita</strong><span>${esc(c.nextAppointment ? `${c.nextAppointment.date} ${c.nextAppointment.time} · ${c.nextAppointment.serviceName}` : 'Sin próxima cita')}</span></div>
          <div class="info-line"><strong>Servicio favorito</strong><span>${esc(c.favoriteService || 'Sin historial')}</span></div>
          <div class="info-line"><strong>Preferencias</strong><span>${esc(profileSummary(c))}</span></div>
        </div>
        <div class="row-actions">
          <a class="mini-action" target="_blank" rel="noopener" href="${esc(whatsappTo(c.whatsapp, `Hola ${c.name || ''} ✨ te escribimos de Black Rococo sobre tu cita.`))}">WhatsApp clienta</a>
          ${c.nextAppointment ? `<a class="mini-action" target="_blank" rel="noopener" href="${esc(c.nextAppointment.clientReminderUrl)}">Recordar próxima cita</a>` : ''}
        </div>
      </div>
      <form class="card profile-form" data-client-profile-form="${esc(c.id)}">
        <div class="eyebrow">DATOS Y PREFERENCIAS</div>
        <div class="form-grid two-col">
          <div class="form-field"><label>Nombre</label><input name="name" value="${esc(c.name)}"></div>
          <div class="form-field"><label>WhatsApp</label><input name="whatsapp" inputmode="tel" value="${esc(c.whatsapp)}"></div>
          <div class="form-field"><label>Email</label><input name="email" value="${esc(c.email || '')}" placeholder="opcional"></div>
          <div class="form-field"><label>Instagram</label><input name="instagram" value="${esc(c.instagram || '')}" placeholder="@usuario"></div>
          <div class="form-field"><label>Cumpleaños</label><input type="date" name="birthday" value="${esc(c.birthday || '')}"></div>
          <div class="form-field"><label>Horario preferido</label><input name="timePreference" value="${esc(c.timePreference || '')}" placeholder="Mañana, tarde, sábado..."></div>
          <div class="form-field"><label>Estilo preferido</label><input name="styleChoice" value="${esc(c.styleChoice || '')}" placeholder="Natural, french, editorial..."></div>
          <div class="form-field"><label>Color favorito</label><input name="colorChoice" value="${esc(c.colorChoice || '')}" placeholder="Nude, rojo, negro..."></div>
          <div class="form-field"><label>Bebida favorita</label><input name="drinkChoice" value="${esc(c.drinkChoice || '')}" placeholder="Café, té, agua..."></div>
          <div class="form-field"><label>Alergias/cuidados</label><input name="allergies" value="${esc(c.allergies || '')}" placeholder="Piel sensible, alergias..."></div>
        </div>
        <div class="form-field"><label>Notas internas</label><textarea name="notes" rows="4" placeholder="Preferencias, trato, ideas de diseño, observaciones...">${esc(c.notes || '')}</textarea></div>
        <button class="btn btn-primary">GUARDAR PERFIL</button>
      </form>
      <div class="card service-history-card">
        <div class="eyebrow">SERVICIOS ANTERIORES</div>
        ${pastServices.length ? pastServices.map(s => `<div class="history-row"><div><div class="service-name">${esc(s.serviceName)}</div><div class="service-meta">${esc(s.count)} vez/veces · Última: ${esc(s.lastDate)}</div></div></div>`).join('') : `<div class="empty">Sin servicios anteriores.</div>`}
      </div>
      <div class="card appointment-history-card">
        <div class="eyebrow">HISTORIAL DE CITAS</div>
        ${history.length ? history.map(appointmentMiniCard).join('') : `<div class="empty">Sin historial de citas.</div>`}
      </div>
      ${clientPhotosSection(c.id)}
    </div>
  </div>`;
}
function adminGallery(data) {
  const media = data?.media || [];
  const editing = state.admin.editingMediaId ? media.find(m => m.id === state.admin.editingMediaId) : null;
  const draft = state.admin.mediaDraft;
  const categories = [...new Set(media.map(m => m.category).filter(Boolean))];
  const multiFiles = state.admin.multiUploadFiles || [];
  const multiUploading = state.admin.multiUploading;

  // Story 18: Multi-upload section
  const multiUploadSection = `<div class="card multi-upload-card">
    <div class="eyebrow">SUBIDA MÚLTIPLE</div>
    <div class="subtitle" style="margin:6px 0 12px">Selecciona varias fotos a la vez para agregarlas a la galería.</div>
    <div class="form-field">
      <label>Seleccionar archivos</label>
      <input type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm" data-multi-upload-input>
    </div>
    ${multiFiles.length ? `
      <div class="multi-preview-grid">
        ${multiFiles.map((f, i) => `<div class="multi-preview-item ${f.status}">
          ${f.url ? `<img src="${esc(f.url)}" alt="${esc(f.name)}">` : `<div class="multi-preview-placeholder">${f.status === 'uploading' ? '⏳' : f.status === 'error' ? '✕' : '...'}</div>`}
          <div class="multi-preview-name">${esc(f.name.slice(0, 20))}</div>
          <div class="multi-preview-status">${f.status === 'done' ? '✓' : f.status === 'error' ? esc(f.error || 'Error') : f.status === 'uploading' ? 'Subiendo...' : 'Pendiente'}</div>
        </div>`).join('')}
      </div>
      ${multiUploading ? `<div class="upload-progress"><div class="upload-progress-bar" style="width:${state.admin.multiUploadProgress}%"></div><span>${state.admin.multiUploadProgress}%</span></div>` : ''}
      ${!multiUploading && multiFiles.some(f => f.status === 'done') ? `
        <div class="form-field" style="margin-top:12px">
          <label>Categoría para todas (opcional)</label>
          <input id="multi-upload-category" list="media-categories" placeholder="Manicure Ruso, Poligel...">
        </div>
        <button class="btn btn-primary" data-save-multi-gallery>GUARDAR ${multiFiles.filter(f => f.status === 'done').length} FOTOS EN GALERÍA</button>
      ` : ''}
    ` : ''}
  </div>`;

  return `<div class="card-list">
    ${multiUploadSection}
    <form class="card" data-media-form="${editing ? esc(editing.id) : ''}">
      <div class="eyebrow">${editing ? 'EDITAR ELEMENTO' : 'NUEVA FOTO O VIDEO'}</div>
      <div class="form-field">
        <label>Archivo (foto, GIF o video corto)</label>
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm" data-media-file-input>
        ${state.admin.mediaUploading ? `<div class="empty">Subiendo archivo…</div>` : ''}
        ${draft?.url ? `<div class="admin-thumb-row">
          ${draft.kind === 'video'
            ? `<video src="${esc(draft.url)}" class="admin-thumb" muted loop playsinline></video>`
            : `<img src="${esc(draft.url)}" alt="Miniatura" class="admin-thumb">`}
          <button type="button" class="thumb-remove" data-clear-media-draft aria-label="Quitar archivo">✕</button>
        </div>` : `<div class="service-meta" style="margin-top:6px">Sin archivo seleccionado.</div>`}
      </div>
      <div class="form-field"><label>Título / caption</label><input name="title" value="${esc(editing?.title || '')}" placeholder="Set editorial en poligel"></div>
      <div class="form-field"><label>Descripción breve</label><textarea name="description" rows="2" placeholder="Manicure ruso con nail art en tono nude...">${esc(editing?.description || '')}</textarea></div>
      <div class="form-grid two-col">
        <div class="form-field"><label>Categoría</label>
          <input name="category" list="media-categories" value="${esc(editing?.category || '')}" placeholder="Manicure Ruso, Poligel, Pedicure...">
          <datalist id="media-categories">
            ${[...(state.salonConfig?.galleryCategories || []), ...(data?.media?.map(m=>m.category).filter(Boolean)||[])].filter((v,i,a)=>a.indexOf(v)===i).map(c=>`<option value="${esc(c)}">`).join('')}
          </datalist>
        </div>
        <datalist id="media-categories">${categories.map(cat => `<option value="${esc(cat)}">`).join('')}</datalist>
        <div class="form-field"><label>Orden (menor = primero)</label><input type="number" name="order" value="${esc(editing?.order ?? 0)}"></div>
      </div>
      <div class="pill-row" style="margin-bottom:12px">
        <label class="pill-button"><input type="checkbox" name="showInCarousel" ${editing?.showInCarousel ? 'checked' : ''}> Mostrar en carrusel de inicio</label>
        <label class="pill-button"><input type="checkbox" name="showInGallery" ${(!editing || editing.showInGallery) ? 'checked' : ''}> Mostrar en galería</label>
      </div>
      <div class="row-actions">
        <button class="btn btn-primary" type="submit">${editing ? 'GUARDAR CAMBIOS' : 'AGREGAR A LA GALERÍA'}</button>
        ${editing ? `<button type="button" class="pill-button" data-cancel-media-edit>CANCELAR</button>` : ''}
      </div>
    </form>
    ${media.length ? media.map(m => `<div class="admin-service-row">
      <div class="admin-service-main">
        <div class="admin-thumb-row">
          ${m.kind === 'video' ? `<video src="${esc(m.url)}" class="admin-thumb" muted loop playsinline></video>` : `<img src="${esc(m.url)}" alt="Miniatura" class="admin-thumb">`}
          <div><div class="service-name">${esc(m.title || 'Sin título')}</div><div class="service-meta">${esc(m.category || 'Sin categoría')} · orden ${esc(m.order)} · ${m.kind === 'video' ? 'Video' : 'Foto'}</div></div>
        </div>
      </div>
      <div class="pill-row">
        <button class="pill-button ${m.showInCarousel ? 'active' : ''}" data-toggle-media-carousel="${esc(m.id)}" data-active="${m.showInCarousel ? '1' : '0'}">Carrusel ${m.showInCarousel ? '✓' : ''}</button>
        <button class="pill-button ${m.showInGallery ? 'active' : ''}" data-toggle-media-gallery="${esc(m.id)}" data-active="${m.showInGallery ? '1' : '0'}">Galería ${m.showInGallery ? '✓' : ''}</button>
      </div>
      <div class="row-actions">
        <button class="mini-action" data-edit-media="${esc(m.id)}">Editar</button>
        <button class="mini-action" data-delete-media="${esc(m.id)}">Eliminar</button>
      </div>
    </div>`).join('') : `<div class="empty">Aún no hay fotos ni videos en la galería.</div>`}
  </div>`;
}

function adminPublish(data) {
  const posts = data?.posts || [];
  return `<div class="card-list">
    <form class="card" data-post-form>
      <div class="form-field"><label>Subir imagen desde celular o computadora</label><input name="imageFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></div>
      <div class="form-field"><label>Caption</label><textarea name="caption" rows="4" placeholder="Nuevo set disponible ✨"></textarea></div>
      <div class="pill-row" style="margin-bottom:12px">
        <label class="pill-button"><input type="checkbox" name="target" value="instagram" checked> IG</label>
        <label class="pill-button"><input type="checkbox" name="target" value="tiktok"> TikTok</label>
        <label class="pill-button"><input type="checkbox" name="target" value="galeria" checked> Galería</label>
      </div>
      <button class="btn btn-primary">SUBIR Y GUARDAR</button>
      <div class="subtitle" style="margin-top:10px">La imagen se guarda en /uploads y aparece en la galería del sitio. Para publicar automáticamente en redes se conecta Meta/Instagram API o Make/Zapier.</div>
    </form>
    ${posts.length ? posts.map(p => `<div class="post-row">${p.imageUrl ? `<img class="post-thumb" alt="Foto publicación" src="${esc(p.imageUrl)}">` : ''}<div><div class="service-name">${esc(p.caption)}</div><div class="service-meta">${esc(p.targets.join(', '))} · ${new Date(p.publishedAt).toLocaleString('es-MX')}</div></div></div>`).join('') : `<div class="empty">No hay publicaciones guardadas.</div>`}
  </div>`;
}

function adminIntegrations() {
  const gcal = state.admin.googleCalendar;
  const params = new URLSearchParams(location.search);
  const gcalParam = params.get('gcal');
  const banner = gcalParam === 'connected'
    ? `<div class="card" style="border-color:#2e7d32;margin-bottom:16px">✅ Google Calendar conectado correctamente.</div>`
    : gcalParam === 'denied'
      ? `<div class="error-box">La conexión fue cancelada o el enlace expiró. Intenta de nuevo.</div>`
      : gcalParam === 'error'
        ? `<div class="error-box">Ocurrió un error al conectar. Intenta de nuevo o revisa la configuración.</div>`
        : '';

  if (!gcal) {
    return `<div class="card-list">${banner}<div class="card"><div class="eyebrow">GOOGLE CALENDAR</div><div class="subtitle">Cargando estado...</div></div></div>`;
  }

  return `<div class="card-list">
    ${banner}
    <div class="card">
      <div class="eyebrow">GOOGLE CALENDAR</div>
      <div class="title" style="font-size:20px;margin:8px 0">${gcal.connected ? 'Conectado ✓' : 'No conectado'}</div>
      ${gcal.connected
        ? `<div class="subtitle">Cuenta: ${esc(gcal.email)}</div><div class="subtitle" style="margin-bottom:14px">Cada nueva reserva bloquea tu calendario automáticamente. Cancelar una cita libera el espacio.</div><button class="pill-button" data-gcal-disconnect>DESCONECTAR</button>`
        : gcal.configured
          ? `<div class="subtitle" style="margin-bottom:14px">Conecta tu cuenta de Google para bloquear tu calendario automáticamente en cada reserva.</div><a class="btn btn-primary" href="/api/admin/google-calendar/connect">CONECTAR GOOGLE CALENDAR</a>`
          : `<div class="subtitle">Falta configurar GOOGLE_OAUTH_CLIENT_ID y GOOGLE_OAUTH_CLIENT_SECRET en el servidor. Ver docs/GOOGLE_CALENDAR_SETUP.md.</div>`
      }
    </div>
  </div>`;
}

async function loadGoogleCalendarStatus() {
  try {
    state.admin.googleCalendar = await api('/api/admin/google-calendar/status');
  } catch (err) {
    state.admin.googleCalendar = { configured: false, connected: false, email: '' };
  }
  render();
}

async function disconnectGoogleCalendar() {
  if (!confirm('¿Desconectar Google Calendar? Las citas ya no se bloquearán automáticamente.')) return;
  try {
    await api('/api/admin/google-calendar/disconnect', { method: 'POST' });
    await loadGoogleCalendarStatus();
  } catch (err) {
    state.admin.error = err.message;
    render();
  }
}

async function disconnectGoogleCalendar() {
  if (!confirm('¿Desconectar Google Calendar? Las citas ya no se bloquearán automáticamente.')) return;
  try {
    await api('/api/admin/google-calendar/disconnect', { method: 'POST' });
    await loadGoogleCalendarStatus();
  } catch (err) {
    state.admin.error = err.message;
    render();
  }
}


// ===== STAFF (EQUIPO) — admin screen =====
function adminStaff(data) {
  const team = data?.staff || [];
  const editing = state.admin.editingStaffId ? team.find(m => m.id === state.admin.editingStaffId) : null;
  const photo = state.admin.staffPhotoDraft || editing?.photoUrl || '';
  const uploading = state.admin.staffUploading;

  return `<div class="card-list">
    <form class="card" data-staff-form="${editing ? esc(editing.id) : ''}">
      <div class="eyebrow">${editing ? 'EDITAR MIEMBRO' : 'NUEVO MIEMBRO DEL EQUIPO'}</div>
      <div class="form-grid two-col">
        <div class="form-field"><label>Nombre</label><input name="name" value="${esc(editing?.name || '')}" placeholder="Ana García" required></div>
        <div class="form-field"><label>Puesto</label><input name="role" value="${esc(editing?.role || '')}" placeholder="Nail Artist Senior"></div>
      </div>
      <div class="form-field"><label>Bio corta</label><textarea name="bio" rows="3" placeholder="Especialista en manicure ruso con 5 años de experiencia...">${esc(editing?.bio || '')}</textarea></div>
      <div class="form-grid two-col">
        <div class="form-field"><label>Instagram (URL)</label><input name="instagram" value="${esc(editing?.instagram || '')}" placeholder="https://instagram.com/..."></div>
        <div class="form-field"><label>Orden</label><input name="sort" type="number" value="${esc(editing?.sort ?? 0)}"></div>
      </div>
      <div class="form-field">
        <label>Foto</label>
        <input type="file" accept="image/png,image/jpeg,image/webp" data-staff-photo-input ${uploading ? 'disabled' : ''}>
        ${uploading ? '<div class="field-hint">Subiendo...</div>' : ''}
      </div>
      ${photo ? `<div class="staff-photo-preview"><img src="${esc(photo)}" alt=""><button type="button" class="thumb-remove" data-remove-staff-photo>×</button></div>` : ''}
      <input type="hidden" name="photoUrl" value="${esc(photo)}">
      <label class="pill-button" style="margin:10px 0"><input type="checkbox" name="active" ${!editing || editing.active ? 'checked' : ''}> Visible en el sitio</label>
      <div class="row-actions">
        <button class="btn btn-primary" type="submit">${editing ? 'GUARDAR CAMBIOS' : 'AGREGAR AL EQUIPO'}</button>
        ${editing ? `<button type="button" class="pill-button" data-cancel-staff-edit>CANCELAR</button>` : ''}
      </div>
    </form>

    ${team.length ? team.map(m => `<div class="card staff-row">
      ${m.photoUrl ? `<img src="${esc(m.photoUrl)}" alt="${esc(m.name)}" class="staff-row-photo">` : `<div class="staff-row-photo staff-row-nophoto">Sin foto</div>`}
      <div class="staff-row-body">
        <div class="service-name">${esc(m.name)}${m.active ? '' : ' · <span style="color:var(--muted)">Oculto</span>'}</div>
        <div class="service-meta">${esc(m.role || 'Sin puesto')}</div>
        ${m.bio ? `<p class="svc-card-desc">${esc(m.bio)}</p>` : ''}
        <div class="row-actions">
          <button class="mini-action" data-edit-staff="${esc(m.id)}">Editar</button>
          <button class="mini-action" data-toggle-staff="${esc(m.id)}" data-active="${m.active ? '1' : '0'}">${m.active ? 'Ocultar' : 'Mostrar'}</button>
          <button class="mini-action notif-delete" data-delete-staff="${esc(m.id)}">Eliminar</button>
        </div>
      </div>
    </div>`).join('') : `<div class="empty">Aún no hay miembros del equipo.</div>`}
  </div>`;
}

async function createOrUpdateStaff(form) {
  const editingId = form.dataset.staffForm;
  const fd = new FormData(form);
  const body = {
    name: fd.get('name') || '',
    role: fd.get('role') || '',
    bio: fd.get('bio') || '',
    instagram: fd.get('instagram') || '',
    photoUrl: fd.get('photoUrl') || '',
    sort: Number(fd.get('sort') || 0),
    active: fd.get('active') === 'on'
  };
  try {
    if (editingId) await api(`/api/admin/staff/${encodeURIComponent(editingId)}`, { method: 'PATCH', body });
    else await api('/api/admin/staff', { method: 'POST', body });
    state.admin.editingStaffId = null;
    state.admin.staffPhotoDraft = '';
    await loadAdminDashboard();
    await refreshPublicConfig();
  } catch (err) {
    state.admin.error = err.message;
  }
  render();
}

async function deleteStaffMember(id) {
  if (!confirm('¿Eliminar a este miembro del equipo?')) return;
  try {
    await api(`/api/admin/staff/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadAdminDashboard();
    await refreshPublicConfig();
  } catch (err) {
    state.admin.error = err.message;
  }
  render();
}

async function toggleStaffActive(id, currentlyActive) {
  try {
    await api(`/api/admin/staff/${encodeURIComponent(id)}`, { method: 'PATCH', body: { active: !currentlyActive } });
    await loadAdminDashboard();
    await refreshPublicConfig();
  } catch (err) {
    state.admin.error = err.message;
  }
  render();
}

// ===== CLIENT CONSULTATION PHOTOS — admin only =====
function clientPhotosSection(clientId) {
  const all = state.admin.data?.clientPhotos || [];
  const photos = all.filter(p => p.clientId === clientId);
  const uploading = state.admin.clientPhotoUploading;

  return `<div class="card service-history-card">
    <div class="section-head compact-head">
      <div>
        <div class="title" style="font-size:20px">Fotos de consulta</div>
        <div class="subtitle">Antes / después / referencia. Privadas — nunca se muestran en el sitio público.</div>
      </div>
    </div>
    <div class="form-grid two-col">
      <div class="form-field">
        <label>Subir foto</label>
        <input type="file" accept="image/png,image/jpeg,image/webp" data-client-photo-input="${esc(clientId)}" ${uploading ? 'disabled' : ''}>
        ${uploading ? '<div class="field-hint">Subiendo...</div>' : ''}
      </div>
      <div class="form-field">
        <label>Etapa</label>
        <select id="client-photo-phase">
          <option value="after">Después</option>
          <option value="before">Antes</option>
          <option value="reference">Referencia</option>
        </select>
      </div>
    </div>
    ${photos.length ? `<div class="client-photo-grid">
      ${photos.map(p => `<div class="client-photo-item">
        <img src="${esc(p.url)}" alt="${esc(p.note || 'Foto de consulta')}" data-client-photo-view="${esc(p.id)}">
        <span class="client-photo-phase phase-${esc(p.phase)}">${p.phase === 'before' ? 'Antes' : p.phase === 'reference' ? 'Ref.' : 'Después'}</span>
        <button class="thumb-remove" data-delete-client-photo="${esc(p.id)}">×</button>
      </div>`).join('')}
    </div>` : `<div class="empty">Aún no hay fotos de esta clienta.</div>`}
  </div>`;
}

async function uploadClientPhoto(input) {
  const clientId = input.dataset.clientPhotoInput;
  const file = input.files?.[0];
  if (!file) return;
  const invalid = validateMediaFile(file);
  if (invalid) { state.admin.error = invalid; input.value = ''; return render(); }

  const phase = document.getElementById('client-photo-phase')?.value || 'after';
  state.admin.error = '';
  state.admin.clientPhotoUploading = true;
  render();
  try {
    const url = await uploadAdminImage(file);
    await api(`/api/admin/clients/${encodeURIComponent(clientId)}/photos`, {
      method: 'POST',
      body: { url, phase }
    });
    await loadAdminDashboard();
  } catch (err) {
    state.admin.error = err.message;
  }
  state.admin.clientPhotoUploading = false;
  input.value = '';
  render();
}

async function deleteClientPhoto(id) {
  if (!confirm('¿Eliminar esta foto?')) return;
  try {
    await api(`/api/admin/client-photos/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadAdminDashboard();
  } catch (err) {
    state.admin.error = err.message;
  }
  render();
}

// ===== ABOUT US editor =====
function aboutUsEditor(data) {
  const draft = state.admin.aboutUsDraft
    || data?.aboutUs
    || { title: 'Sobre Nosotros', text: '', images: [] };
  if (!state.admin.aboutUsDraft) state.admin.aboutUsDraft = JSON.parse(JSON.stringify(draft));
  const d = state.admin.aboutUsDraft;
  const uploading = state.admin.aboutUsUploading;

  return `<div class="card">
    <div class="eyebrow">SOBRE NOSOTROS</div>
    <div class="subtitle" style="margin-bottom:12px">Texto e imágenes de la sección "Sobre Nosotros" de la página de inicio.</div>
    <div class="form-field"><label>Título</label><input value="${esc(d.title || '')}" data-about-field="title"></div>
    <div class="form-field"><label>Texto</label><textarea rows="5" data-about-field="text">${esc(d.text || '')}</textarea></div>
    <div class="form-field">
      <label>Agregar imagen (hasta 6)</label>
      <input type="file" accept="image/png,image/jpeg,image/webp" data-about-image-input ${uploading || (d.images || []).length >= 6 ? 'disabled' : ''}>
      ${uploading ? '<div class="field-hint">Subiendo...</div>' : ''}
      ${(d.images || []).length >= 6 ? '<div class="field-hint">Máximo 6 imágenes.</div>' : ''}
    </div>
    ${(d.images || []).length ? `<div class="admin-thumb-row">
      ${d.images.map((url, i) => `<div class="admin-thumb-wrap">
        <img src="${esc(url)}" alt="Miniatura" class="admin-thumb">
        <button type="button" class="thumb-remove" data-remove-about-image="${i}">×</button>
      </div>`).join('')}
    </div>` : ''}
    <button class="btn btn-primary" style="margin-top:12px" data-save-about-us ${state.admin.configSaving ? 'disabled' : ''}>GUARDAR SOBRE NOSOTROS</button>
  </div>`;
}

async function saveAboutUs() {
  const d = state.admin.aboutUsDraft;
  if (!d) return;
  state.admin.configSaving = true;
  state.admin.error = '';
  state.admin.configSuccess = '';
  render();
  try {
    await api('/api/admin/settings/about-us', {
      method: 'POST',
      body: { title: d.title, text: d.text, images: d.images || [] }
    });
    await refreshPublicConfig();
    await loadAdminDashboard();
    state.admin.configSuccess = '✓ Sobre Nosotros guardado correctamente.';
    setTimeout(() => { state.admin.configSuccess = ''; render(); }, 4000);
  } catch (err) {
    state.admin.error = err.message;
  }
  state.admin.configSaving = false;
  render();
}

// ===== HOMEPAGE CONTENT EDITOR =====
function adminHomepageEditor() {
  const hp = state.admin.homepageDraft || state.salonConfig?.homepage || {};
  // Lazily initialize the draft on first render
  if (!state.admin.homepageDraft) {
    state.admin.homepageDraft = JSON.parse(JSON.stringify(hp));
  }
  const d = state.admin.homepageDraft;
  const hero = d.hero || {};
  const spf = d.socialProof || {};
  const svcS = d.servicesSection || {};
  const whyU = d.whyUs || {};
  const exp = d.experience || {};
  const galS = d.gallerySection || {};
  const ctaC = d.contactCta || {};
  const ft = d.footer || {};
  const saving = state.admin.configSaving;

  // Helper for repeatable item lists (testimonials, why items, steps, stats, trust pills)
  const itemList = (label, key, fields, maxItems = 10) => {
    const items = d[key] || [];
    return `<div class="form-field">
      <label>${label}</label>
      ${items.map((it, i) => `<div class="card" style="margin-bottom:8px;padding:10px">
        ${fields.map(f => `<div class="form-field" style="margin-bottom:6px">
          <label style="font-size:12px">${f.label} #${i+1}</label>
          <input value="${esc(it[f.key] || '')}" data-hp-item="${key}" data-hp-item-idx="${i}" data-hp-item-field="${f.key}" placeholder="${esc(f.placeholder || '')}">
        </div>`).join('')}
        <button type="button" class="pill-button" style="color:var(--red);font-size:12px" data-hp-remove-item="${key}" data-hp-remove-idx="${i}">ELIMINAR</button>
      </div>`).join('')}
      ${items.length < maxItems ? `<button type="button" class="btn btn-outline btn-small" data-hp-add-item="${key}">+ AGREGAR</button>` : ''}
    </div>`;
  };

  // Nested object items (e.g. whyUs.items, experience.steps)
  const nestedItemList = (label, parentKey, childKey, fields, maxItems = 10) => {
    const parent = d[parentKey] || {};
    const items = parent[childKey] || [];
    return `<div class="form-field">
      <label>${label}</label>
      ${items.map((it, i) => `<div class="card" style="margin-bottom:8px;padding:10px">
        ${fields.map(f => `<div class="form-field" style="margin-bottom:6px">
          <label style="font-size:12px">${f.label} #${i+1}</label>
          ${f.type === 'textarea'
            ? `<textarea rows="2" data-hp-nested="${parentKey}" data-hp-nested-child="${childKey}" data-hp-nested-idx="${i}" data-hp-nested-field="${f.key}" placeholder="${esc(f.placeholder || '')}">${esc(it[f.key] || '')}</textarea>`
            : `<input value="${esc(it[f.key] || '')}" data-hp-nested="${parentKey}" data-hp-nested-child="${childKey}" data-hp-nested-idx="${i}" data-hp-nested-field="${f.key}" placeholder="${esc(f.placeholder || '')}">`}
        </div>`).join('')}
        <button type="button" class="pill-button" style="color:var(--red);font-size:12px" data-hp-remove-nested="${parentKey}" data-hp-remove-nested-child="${childKey}" data-hp-remove-nested-idx="${i}">ELIMINAR</button>
      </div>`).join('')}
      ${items.length < maxItems ? `<button type="button" class="btn btn-outline btn-small" data-hp-add-nested="${parentKey}" data-hp-add-nested-child="${childKey}">+ AGREGAR</button>` : ''}
    </div>`;
  };

  return `<div class="card">
    <div class="eyebrow">CONTENIDO DE LA PÁGINA DE INICIO</div>
    <div class="subtitle" style="margin-bottom:16px">Edita todos los textos, estadísticas y secciones que aparecen en la página principal del sitio. Al guardar, el sitio público se actualiza al instante.</div>

    <details class="config-section" open>
      <summary class="config-section-title">🏠 Hero (encabezado principal)</summary>
      <div class="form-grid two-col">
        <div class="form-field"><label>Eyebrow (línea superior)</label><input value="${esc(hero.eyebrow || '')}" data-hp-field="hero.eyebrow" placeholder="Estudio de uñas de lujo · Guadalajara"></div>
        <div class="form-field"><label>Titular principal</label><input value="${esc(hero.headline || '')}" data-hp-field="hero.headline" placeholder="Donde la elegancia se encuentra con el arte"></div>
      </div>
      <div class="form-field"><label>Párrafo descriptivo</label><textarea rows="3" data-hp-field="hero.lead" placeholder="Descripción del negocio que aparece debajo del titular...">${esc(hero.lead || '')}</textarea></div>
      <div class="form-grid two-col">
        <div class="form-field"><label>Botón principal</label><input value="${esc(hero.ctaPrimary || '')}" data-hp-field="hero.ctaPrimary" placeholder="Reservar mi cita"></div>
        <div class="form-field"><label>Botón secundario</label><input value="${esc(hero.ctaSecondary || '')}" data-hp-field="hero.ctaSecondary" placeholder="Ver nuestro trabajo"></div>
      </div>
    </details>

    <details class="config-section">
      <summary class="config-section-title">🏅 Sellos de confianza (trust pills)</summary>
      ${itemList('Sellos que aparecen debajo del hero', 'trustPills', [
        { key: 'icon', label: 'Icono', placeholder: '★ ◇ ✧ ♥' },
        { key: 'text', label: 'Texto', placeholder: '4.9 en Google' }
      ], 6)}
    </details>

    <details class="config-section">
      <summary class="config-section-title">📊 Prueba social (estadísticas)</summary>
      <div class="form-field"><label>Eyebrow de la sección</label><input value="${esc(spf.eyebrow || '')}" data-hp-field="socialProof.eyebrow" placeholder="La confianza se gana"></div>
      ${nestedItemList('Estadísticas destacadas', 'socialProof', 'stats', [
        { key: 'figure', label: 'Cifra', placeholder: '+500' },
        { key: 'label', label: 'Etiqueta', placeholder: 'Clientas atendidas' }
      ], 6)}
    </details>

    <details class="config-section">
      <summary class="config-section-title">💬 Testimonios</summary>
      ${itemList('Reseñas de clientas', 'testimonials', [
        { key: 'text', label: 'Reseña', placeholder: 'La atención al detalle es excepcional...' },
        { key: 'author', label: 'Autora', placeholder: 'María G.' },
        { key: 'role', label: 'Rol', placeholder: 'Clienta frecuente' }
      ], 10)}
    </details>

    <details class="config-section">
      <summary class="config-section-title">💅 Sección de servicios insignia</summary>
      <div class="form-grid two-col">
        <div class="form-field"><label>Eyebrow</label><input value="${esc(svcS.eyebrow || '')}" data-hp-field="servicesSection.eyebrow" placeholder="Servicios insignia"></div>
        <div class="form-field"><label>Título</label><input value="${esc(svcS.title || '')}" data-hp-field="servicesSection.title" placeholder="Nuestros servicios principales"></div>
      </div>
      <div class="form-field"><label>Subtítulo</label><textarea rows="2" data-hp-field="servicesSection.subtitle" placeholder="Cada servicio se realiza con instrumental esterilizado...">${esc(svcS.subtitle || '')}</textarea></div>
      <div class="form-field"><label>Texto del botón</label><input value="${esc(svcS.ctaText || '')}" data-hp-field="servicesSection.ctaText" placeholder="Ver la carta completa"></div>
    </details>

    <details class="config-section">
      <summary class="config-section-title">✨ Sección "Por qué nosotros"</summary>
      <div class="form-grid two-col">
        <div class="form-field"><label>Eyebrow</label><input value="${esc(whyU.eyebrow || '')}" data-hp-field="whyUs.eyebrow" placeholder="Por qué Black Rococo"></div>
        <div class="form-field"><label>Título</label><input value="${esc(whyU.title || '')}" data-hp-field="whyUs.title" placeholder="Lo que justifica el precio"></div>
      </div>
      <div class="form-field"><label>Párrafo descriptivo</label><textarea rows="3" data-hp-field="whyUs.lead" placeholder="No competimos por precio...">${esc(whyU.lead || '')}</textarea></div>
      <div class="form-field"><label>Texto del botón</label><input value="${esc(whyU.ctaText || '')}" data-hp-field="whyUs.ctaText" placeholder="Reservar mi cita"></div>
      ${nestedItemList('Puntos diferenciadores', 'whyUs', 'items', [
        { key: 'title', label: 'Título', placeholder: 'Técnica rusa en seco' },
        { key: 'text', label: 'Descripción', placeholder: 'Sin agua y sin cortes...', type: 'textarea' }
      ], 8)}
    </details>

    <details class="config-section">
      <summary class="config-section-title">🔄 Sección "Cómo funciona" (pasos)</summary>
      <div class="form-grid two-col">
        <div class="form-field"><label>Eyebrow</label><input value="${esc(exp.eyebrow || '')}" data-hp-field="experience.eyebrow" placeholder="La experiencia"></div>
        <div class="form-field"><label>Título</label><input value="${esc(exp.title || '')}" data-hp-field="experience.title" placeholder="Cómo funciona"></div>
      </div>
      ${nestedItemList('Pasos del proceso', 'experience', 'steps', [
        { key: 'num', label: 'Número', placeholder: '01' },
        { key: 'name', label: 'Nombre', placeholder: 'Reservas' },
        { key: 'text', label: 'Descripción', placeholder: 'Eliges servicio, día y hora...', type: 'textarea' }
      ], 8)}
    </details>

    <details class="config-section">
      <summary class="config-section-title">📸 Sección de galería (inicio)</summary>
      <div class="form-grid two-col">
        <div class="form-field"><label>Eyebrow</label><input value="${esc(galS.eyebrow || '')}" data-hp-field="gallerySection.eyebrow" placeholder="El trabajo"></div>
        <div class="form-field"><label>Título</label><input value="${esc(galS.title || '')}" data-hp-field="gallerySection.title" placeholder="Resultados reales"></div>
      </div>
      <div class="form-field"><label>Texto del botón</label><input value="${esc(galS.ctaText || '')}" data-hp-field="gallerySection.ctaText" placeholder="Ver la galería completa"></div>
    </details>

    <details class="config-section">
      <summary class="config-section-title">📞 Sección de contacto / CTA final</summary>
      <div class="form-grid two-col">
        <div class="form-field"><label>Eyebrow</label><input value="${esc(ctaC.eyebrow || '')}" data-hp-field="contactCta.eyebrow" placeholder="Reserva"></div>
        <div class="form-field"><label>Título</label><input value="${esc(ctaC.title || '')}" data-hp-field="contactCta.title" placeholder="Reserva tu cita"></div>
      </div>
      <div class="form-field"><label>Subtítulo</label><input value="${esc(ctaC.subtitle || '')}" data-hp-field="contactCta.subtitle" placeholder="Atendemos a una clienta a la vez..."></div>
      <div class="form-grid two-col">
        <div class="form-field"><label>Botón principal</label><input value="${esc(ctaC.ctaPrimary || '')}" data-hp-field="contactCta.ctaPrimary" placeholder="Reservar mi cita"></div>
        <div class="form-field"><label>Botón secundario</label><input value="${esc(ctaC.ctaSecondary || '')}" data-hp-field="contactCta.ctaSecondary" placeholder="Escribir por WhatsApp"></div>
      </div>
    </details>

    <details class="config-section">
      <summary class="config-section-title">📝 Footer y WhatsApp</summary>
      <div class="form-field"><label>Descripción del footer</label><textarea rows="2" data-hp-field="footer.description" placeholder="Atelier de uñas en Ciudad Granja, Zapopan...">${esc(ft.description || '')}</textarea></div>
      <div class="form-field"><label>Mensaje predeterminado de WhatsApp</label><input value="${esc(d.whatsappMessage || '')}" data-hp-field="whatsappMessage" placeholder="Hola, quiero información para agendar una cita ✨"></div>
    </details>

    <button class="btn btn-primary" style="margin-top:16px" data-save-homepage ${saving ? 'disabled' : ''}>${saving ? 'GUARDANDO...' : 'GUARDAR CONTENIDO DE INICIO'}</button>
  </div>`;
}

function adminConfiguracion(data) {
  const cfg = state.admin.configDraft || state.salonConfig || {};
  const brand = state.config?.brand || {};
  const contact = state.config?.contact || {};
  const booking = state.config?.booking || {};
  const saving = state.admin.configSaving;
  // Hero images are edited live against state.salonConfig (single source of truth).
  if (!state.salonConfig) state.salonConfig = {};
  if (!Array.isArray(state.salonConfig.heroImages)) state.salonConfig.heroImages = [];
  const heroImages = state.salonConfig.heroImages;
  const heroUploading = state.admin.heroUploadingIndex;

  const listField = (label, key, hint) => `
    <div class="form-field">
      <label>${label}</label>
      <textarea name="cfg_${key}" rows="3" placeholder="${hint}">${esc((cfg[key] || []).join(', '))}</textarea>
      <div class="field-hint">Separa con comas. Se usan como sugerencias al reservar y al crear servicios.</div>
    </div>`;

  return `<div class="card-list">
    ${state.admin.configSuccess ? `<div class="success-inline">${esc(state.admin.configSuccess)}</div>` : ''}
    ${adminHomepageEditor()}
    ${aboutUsEditor(data)}
    <div class="card">
      <div class="eyebrow">MARCA</div>
      <form data-settings-form="brand">
        <div class="form-grid two-col">
          <div class="form-field"><label>Nombre del salón</label><input name="name" value="${esc(brand.name||'')}"></div>
          <div class="form-field"><label>Tagline</label><input name="tagline" value="${esc(brand.tagline||'')}"></div>
          <div class="form-field"><label>Título del hero</label><input name="heroTitle" value="${esc(brand.heroTitle||'')}"></div>
          <div class="form-field"><label>Subtítulo del hero</label><input name="heroSubtitle" value="${esc(brand.heroSubtitle||'')}"></div>
          <div class="form-field"><label>Especialidades (separadas por ·)</label><input name="specialties" value="${esc(brand.specialties||'')}"></div>
          <div class="form-field"><label>Rating (ej. 4.9)</label><input name="rating" value="${esc(brand.rating||'')}"></div>
          <div class="form-field"><label>Texto de reseña</label><input name="socialProof" value="${esc(brand.socialProof||'')}"></div>
          <div class="form-field"><label>Texto del footer</label><input name="footer" value="${esc(brand.footer||'')}"></div>
        </div>
        <button class="btn btn-primary" type="submit" ${saving?'disabled':''}>GUARDAR MARCA</button>
      </form>
    </div>

    <div class="card">
      <div class="eyebrow">CONTACTO</div>
      <form data-settings-form="contact">
        <div class="form-grid two-col">
          <div class="form-field"><label>WhatsApp (número)</label><input name="whatsappNumber" value="${esc(contact.whatsappNumber||'')}"></div>
          <div class="form-field"><label>Dirección línea 1</label><input name="address1" value="${esc(contact.address1||'')}"></div>
          <div class="form-field"><label>Dirección línea 2</label><input name="address2" value="${esc(contact.address2||'')}"></div>
          <div class="form-field"><label>Horario línea 1</label><input name="hours1" value="${esc(contact.hours1||'')}"></div>
          <div class="form-field"><label>Horario línea 2</label><input name="hours2" value="${esc(contact.hours2||'')}"></div>
          <div class="form-field"><label>URL Google Maps</label><input name="mapsUrl" value="${esc(contact.mapsUrl||'')}"></div>
          <div class="form-field"><label>URL Instagram</label><input name="instagramUrl" value="${esc(contact.instagramUrl||'')}"></div>
          <div class="form-field"><label>Handle Instagram (@usuario)</label><input name="instagramHandle" value="${esc(contact.instagramHandle||'')}"></div>
          <div class="form-field"><label>URL TikTok</label><input name="tiktokUrl" value="${esc(contact.tiktokUrl||'')}"></div>
          <div class="form-field"><label>URL Facebook</label><input name="facebookUrl" value="${esc(contact.facebookUrl||'')}"></div>
        </div>
        <button class="btn btn-primary" type="submit" ${saving?'disabled':''}>GUARDAR CONTACTO</button>
      </form>
    </div>

    <div class="card">
      <div class="eyebrow">HORARIOS DE CITAS</div>
      <form data-settings-form="booking">
        <div class="form-field">
          <label>Horarios disponibles (HH:MM separados por comas)</label>
          <input name="times" value="${esc((booking.times||[]).join(', '))}" placeholder="09:00, 10:00, 11:00...">
        </div>
        <div class="form-field"><label>Nota de confirmación</label><textarea name="confirmNote" rows="3">${esc(booking.confirmNote||'')}</textarea></div>
        <button class="btn btn-primary" type="submit" ${saving?'disabled':''}>GUARDAR HORARIOS</button>
      </form>
    </div>

    <div class="card">
      <div class="eyebrow">LISTAS DE PREFERENCIAS</div>
      <form data-settings-form="config">
        <div class="form-field"><label>WhatsApp del negocio (número)</label><input name="cfg_whatsappNumber" value="${esc(cfg.whatsappNumber||'')}"></div>
        ${listField('Colores disponibles','colors','Nude, Rojo, Negro, Rosa...')}
        ${listField('Bebidas disponibles','bebidas','Café, Té, Agua, Jugo...')}
        ${listField('Estilos disponibles','estilos','Natural, French, Editorial...')}
        ${listField('Categorías de servicios','serviceCategories','MANOS, PIES, EXTRAS...')}
        ${listField('Categorías de galería','galleryCategories','Manicure Ruso, Poligel, Pedicure...')}
        <button class="btn btn-primary" type="submit" ${saving?'disabled':''}>GUARDAR LISTAS</button>
      </form>
    </div>

    <div class="card">
      <div class="eyebrow">FOTO PRINCIPAL (hasta 10 imágenes, carrusel automático)</div>
      <div class="subtitle" style="margin-bottom:12px">Configura las fotos del hero de la página de inicio. Cada foto puede tener un título y subtítulo propios.</div>
      ${heroImages.map((img, i) => `
        <div class="card hero-img-row" style="margin-bottom:8px">
          <div class="form-grid two-col">
            <div class="form-field"><label>URL foto ${i+1}</label><input value="${esc(img.url || '')}" data-hero-img-url="${i}" placeholder="Sube una foto o pega una URL"></div>
            <div class="form-field">
              <label>Archivo</label>
              <input type="file" accept="image/png,image/jpeg,image/webp" data-hero-img-file="${i}" ${heroUploading === i ? 'disabled' : ''}>
              ${heroUploading === i ? '<div class="field-hint">Subiendo...</div>' : ''}
            </div>
          </div>
          <div class="form-grid two-col">
            <div class="form-field"><label>Título</label><input value="${esc(img.title||'')}" data-hero-img-title="${i}"></div>
            <div class="form-field"><label>Subtítulo</label><input value="${esc(img.subtitle||'')}" data-hero-img-subtitle="${i}"></div>
          </div>
          ${img.url ? `<img src="${esc(img.url)}" alt="" style="width:100%;height:120px;object-fit:cover;border-radius:4px;margin-top:8px">` : ''}
          <button type="button" class="pill-button" data-remove-hero-img="${i}" style="margin-top:8px;color:var(--red)">ELIMINAR</button>
        </div>`).join('')}
      ${heroImages.length ? '' : '<div class="empty">Aún no hay fotos hero. Agrega la primera.</div>'}
      <div class="row-actions" style="margin-top:12px">
        ${heroImages.length < 10
          ? `<button type="button" class="btn btn-outline btn-small" data-add-hero-img>+ AGREGAR FOTO</button>`
          : ''}
        <button type="button" class="btn btn-primary btn-small" data-save-hero-images ${saving?'disabled':''}>${saving ? 'GUARDANDO...' : 'GUARDAR FOTOS HERO'}</button>
      </div>
    </div>
  </div>`;
}

async function saveHomepage() {
  const d = state.admin.homepageDraft;
  if (!d) return;
  state.admin.configSaving = true;
  state.admin.error = '';
  state.admin.configSuccess = '';
  render();
  try {
    await api('/api/admin/settings/homepage', { method: 'POST', body: d });
    await refreshPublicConfig();
    await loadAdminDashboard();
    // Re-sync the draft with saved data
    state.admin.homepageDraft = JSON.parse(JSON.stringify(state.salonConfig?.homepage || {}));
    state.admin.configSuccess = '✓ Contenido de la página de inicio guardado correctamente.';
    setTimeout(() => { state.admin.configSuccess = ''; render(); }, 4000);
  } catch (err) {
    state.admin.error = err.message;
  }
  state.admin.configSaving = false;
  render();
}

async function saveSettings(section, formData) {
  state.admin.configSaving = true;
  state.admin.error = '';
  state.admin.configSuccess = '';
  render();
  try {
    let body = {};
    if (section === 'brand' || section === 'contact') {
      body = Object.fromEntries(formData.entries());
    } else if (section === 'booking') {
      body = Object.fromEntries(formData.entries());
      body.times = String(body.times || '').split(',').map(t => t.trim()).filter(t => /^\d{2}:\d{2}$/.test(t));
    } else if (section === 'config') {
      const parseList = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
      body = {
        whatsappNumber: formData.get('cfg_whatsappNumber') || '',
        colors: parseList(formData.get('cfg_colors')),
        bebidas: parseList(formData.get('cfg_bebidas')),
        estilos: parseList(formData.get('cfg_estilos')),
        serviceCategories: parseList(formData.get('cfg_serviceCategories')),
        galleryCategories: parseList(formData.get('cfg_galleryCategories'))
      };
    }
    const result = await api(`/api/admin/settings/${section}`, { method: 'POST', body });
    await refreshPublicConfig();
    await loadAdminDashboard();
    // Refresh configDraft with newly saved data
    state.admin.configDraft = JSON.parse(JSON.stringify(state.salonConfig || {}));
    state.admin.configSuccess = `✓ ${section === 'brand' ? 'Marca' : section === 'contact' ? 'Contacto' : section === 'booking' ? 'Horarios' : 'Listas'} guardado correctamente.`;
    setTimeout(() => { state.admin.configSuccess = ''; render(); }, 4000);
  } catch (err) {
    state.admin.error = err.message;
  }
  state.admin.configSaving = false;
  render();
}

async function saveHeroImages() {
  const cfg = state.salonConfig || {};
  state.admin.configSaving = true;
  state.admin.error = '';
  state.admin.configSuccess = '';
  render();
  try {
    await api('/api/admin/settings/hero-images', { method: 'POST', body: { images: cfg.heroImages || [] } });
    await refreshPublicConfig();
    state.admin.configSuccess = '✓ Fotos hero guardadas correctamente.';
    setTimeout(() => { state.admin.configSuccess = ''; render(); }, 4000);
  } catch (err) {
    state.admin.error = err.message;
  }
  state.admin.configSaving = false;
  render();
}

function render() {
  if (!state.config) return;
  const body = state.mode === 'admin'
    ? adminScreen()
    : state.tab === 'servicios'
      ? servicesScreen()
      : state.tab === 'reservar'
        ? bookingScreen()
        : state.tab === 'galeria'
          ? galleryScreen()
          : state.tab === 'academia'
            ? academiaScreen()
            : homeScreen();
  app.innerHTML = `${body}${state.mode !== 'admin' && state.serviceModalId ? serviceDetailModal() : ''}${state.mode !== 'admin' && state.lightbox ? lightboxOverlay() : ''}`;
  // render() replaced the DOM, so every carousel element is new. Re-arm the
  // shared ticker so freshly-rendered carousels start cycling from now, rather
  // than inheriting the phase of an interval that began before this render.
  startCarouselTicker();

  // .fade-up starts invisible — this is what reveals it. If it doesn't run, the
  // page renders BLANK, so it must happen on every render, not just at boot.
  initReveal();
  initNavScroll();
  afterRender();
}

let carouselRafId = null;
function manageAutoCarousel() {
  if (carouselRafId) {
    cancelAnimationFrame(carouselRafId);
    carouselRafId = null;
  }
  const el = document.querySelector('[data-auto-carousel]');
  if (!el) return;
  let paused = false;
  let lastTs = null;
  const speed = 34; // px per second
  const pause = () => { paused = true; };
  const resume = () => { paused = false; };
  el.addEventListener('mouseenter', pause);
  el.addEventListener('mouseleave', resume);
  el.addEventListener('touchstart', pause, { passive: true });
  el.addEventListener('touchend', () => setTimeout(resume, 2000), { passive: true });
  function step(ts) {
    if (lastTs == null) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (!paused && el.scrollWidth > el.clientWidth) {
      el.scrollLeft += speed * dt;
      const half = el.scrollWidth / 2;
      if (half > 0 && el.scrollLeft >= half) el.scrollLeft -= half;
    }
    carouselRafId = requestAnimationFrame(step);
  }
  carouselRafId = requestAnimationFrame(step);
}

function manageLightboxSwipe() {
  const el = document.querySelector('[data-lightbox-container]');
  if (!el) return;
  let startX = null;
  el.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
  el.addEventListener('touchend', e => {
    if (startX == null) return;
    const endX = e.changedTouches[0].clientX;
    const delta = endX - startX;
    startX = null;
    if (Math.abs(delta) < 40) return;
    if (delta < 0) lightboxNext(); else lightboxPrev();
  }, { passive: true });
}

function afterRender() {
  manageAutoCarousel();
  manageLightboxSwipe();
}

app.addEventListener('click', async event => {
  if (event.target.matches('[data-close-service-modal]')) {
    state.serviceModalId = null;
    return render();
  }
  if (event.target.matches('[data-close-lightbox]')) {
    return closeLightbox();
  }
  const target = event.target.closest('button, a, label, [data-view-service], [data-open-lightbox]');
  if (!target) return;

  if (target.dataset.viewService) {
    state.serviceModalId = target.dataset.viewService;
    return render();
  }
  if (target.hasAttribute('data-book-from-modal')) {
    const id = target.getAttribute('data-book-from-modal');
    state.serviceModalId = null;
    return startBooking(id);
  }
  if (target.dataset.openLightbox !== undefined) {
    const list = target.dataset.lightboxList === 'homeCarousel' ? state.homeCarouselCache : state.galleryFilteredCache;
    return openLightbox(list || [], Number(target.dataset.openLightbox));
  }
  if (target.hasAttribute('data-lightbox-next')) return lightboxNext();
  if (target.hasAttribute('data-lightbox-prev')) return lightboxPrev();
  if (target.dataset.galleryFilter !== undefined) {
    state.galleryFilter = target.dataset.galleryFilter;
    state.galleryVisibleCount = 9;
    return render();
  }
  if (target.hasAttribute('data-load-more-gallery')) {
    state.galleryVisibleCount = (state.galleryVisibleCount || 9) + 9;
    return render();
  }

  if (target.dataset.action === 'client') return goClient('inicio');
  if (target.dataset.action === 'admin') return goAdmin();
  if (target.dataset.tab) return goClient(target.dataset.tab);
  if (target.dataset.book) return startBooking(target.dataset.book);
  // Carousel controls (dots / arrows) — in-place, never a re-render.
  if (target.dataset.acGo !== undefined) {
    const el = target.closest('.auto-carousel');
    if (el) {
      carouselGo(el, Number(target.dataset.acGo));
      startCarouselTicker(); // don't auto-advance right after a manual tap
    }
    return;
  }
  if (target.hasAttribute('data-ac-prev') || target.hasAttribute('data-ac-next')) {
    const el = target.closest('.auto-carousel');
    if (el) {
      carouselAdvance(el, target.hasAttribute('data-ac-next') ? 1 : -1);
      startCarouselTicker();
    }
    return;
  }
  if (target.hasAttribute('data-rebook-lookup')) return lookupRebook();
  if (target.hasAttribute('data-rebook-apply')) return applyRebook();
  if (target.dataset.selectService) {
    state.booking.serviceId = target.dataset.selectService;
    state.booking.step = 2;
    state.booking.time = null;
    await loadAvailability();
    return render();
  }
  if (target.dataset.step) {
    state.booking.step = Number(target.dataset.step);
    state.booking.error = '';
    if (state.booking.step === 2) await loadAvailability();
    return render();
  }
  if (target.dataset.date) {
    state.booking.date = target.dataset.date;
    state.booking.time = null;
    await loadAvailability();
    return render();
  }
  if (target.dataset.time) {
    state.booking.time = target.dataset.time;
    return render();
  }
  if (target.hasAttribute('data-confirm-booking')) return createBooking();
  if (target.hasAttribute('data-reset-booking')) {
    state.booking = { step: 1, serviceId: null, date: todayLocal(), time: null, name: '', whatsapp: '', styleChoice: '', colorChoice: '', drinkChoice: '', timePreference: '', allergies: '', notes: '', promoCode: '', loadingSlots: false, slots: [], error: '', success: null, rebook: { whatsapp: '', checking: false, checked: false, found: false, name: '', service: null, preferences: null, error: '' } };
    return render();
  }
  if (target.hasAttribute('data-admin-login')) return adminLogin();
  if (target.hasAttribute('data-logout')) return adminLogout();
  if (target.hasAttribute('data-gcal-disconnect')) return disconnectGoogleCalendar();

  // Hero image controls
  if (target.hasAttribute('data-add-hero-img')) {
    if (!state.salonConfig) state.salonConfig = {};
    state.salonConfig.heroImages = [...(state.salonConfig.heroImages || []), { url: '', title: '', subtitle: '' }];
    return render();
  }
  if (target.dataset.removeHeroImg !== undefined) {
    const idx = Number(target.dataset.removeHeroImg);
    state.salonConfig.heroImages = (state.salonConfig.heroImages || []).filter((_, i) => i !== idx);
    return render();
  }
  if (target.hasAttribute('data-save-hero-images')) return saveHeroImages();
  if (target.hasAttribute('data-save-homepage')) return saveHomepage();

  // Homepage content editor: add/remove items in flat lists (trustPills, testimonials)
  if (target.dataset.hpAddItem) {
    const key = target.dataset.hpAddItem;
    if (!state.admin.homepageDraft) state.admin.homepageDraft = {};
    if (!Array.isArray(state.admin.homepageDraft[key])) state.admin.homepageDraft[key] = [];
    const defaults = { trustPills: { icon: '★', text: '' }, testimonials: { text: '', author: '', role: '' } };
    state.admin.homepageDraft[key].push(defaults[key] || {});
    return render();
  }
  if (target.dataset.hpRemoveItem) {
    const key = target.dataset.hpRemoveItem;
    const idx = Number(target.dataset.hpRemoveIdx);
    if (state.admin.homepageDraft?.[key]) state.admin.homepageDraft[key].splice(idx, 1);
    return render();
  }
  // Nested items (socialProof.stats, whyUs.items, experience.steps)
  if (target.dataset.hpAddNested) {
    const pKey = target.dataset.hpAddNested;
    const cKey = target.dataset.hpAddNestedChild;
    if (!state.admin.homepageDraft) state.admin.homepageDraft = {};
    if (!state.admin.homepageDraft[pKey]) state.admin.homepageDraft[pKey] = {};
    if (!Array.isArray(state.admin.homepageDraft[pKey][cKey])) state.admin.homepageDraft[pKey][cKey] = [];
    const defaults = {
      stats: { figure: '', label: '' },
      items: { title: '', text: '' },
      steps: { num: String(state.admin.homepageDraft[pKey][cKey].length + 1).padStart(2, '0'), name: '', text: '' }
    };
    state.admin.homepageDraft[pKey][cKey].push(defaults[cKey] || {});
    return render();
  }
  if (target.dataset.hpRemoveNested) {
    const pKey = target.dataset.hpRemoveNested;
    const cKey = target.dataset.hpRemoveNestedChild;
    const idx = Number(target.dataset.hpRemoveNestedIdx);
    if (state.admin.homepageDraft?.[pKey]?.[cKey]) state.admin.homepageDraft[pKey][cKey].splice(idx, 1);
    return render();
  }

  // Staff
  if (target.dataset.editStaff) {
    state.admin.editingStaffId = target.dataset.editStaff;
    state.admin.staffPhotoDraft = '';
    return render();
  }
  if (target.hasAttribute('data-cancel-staff-edit')) {
    state.admin.editingStaffId = null;
    state.admin.staffPhotoDraft = '';
    return render();
  }
  if (target.dataset.deleteStaff) return deleteStaffMember(target.dataset.deleteStaff);
  if (target.dataset.toggleStaff) return toggleStaffActive(target.dataset.toggleStaff, target.dataset.active === '1');
  if (target.hasAttribute('data-remove-staff-photo')) {
    state.admin.staffPhotoDraft = '';
    const editing = (state.admin.data?.staff || []).find(m => m.id === state.admin.editingStaffId);
    if (editing) editing.photoUrl = '';
    return render();
  }

  // Client consultation photos
  if (target.dataset.deleteClientPhoto) return deleteClientPhoto(target.dataset.deleteClientPhoto);
  if (target.dataset.lightboxOpen !== undefined) {
    const gal = (state.media?.gallery || []);
    const car = (state.media?.carousel || []);
    const tiles = (gal.length ? gal : car).slice(0, 10);
    const i = Number(target.dataset.lightboxOpen);
    if (tiles.length) openLightbox(tiles, i);
    return;
  }
  if (target.dataset.aboutLightbox !== undefined) {
    const imgs = state.aboutImagesCache || [];
    const i = Number(target.dataset.aboutLightbox);
    if (imgs.length) openLightbox(imgs.map(url => ({ url, kind: 'image', title: '' })), i);
    return;
  }
  if (target.dataset.clientPhotoView) {
    const photos = (state.admin.data?.clientPhotos || []);
    const idx = photos.findIndex(p => p.id === target.dataset.clientPhotoView);
    if (idx !== -1) openLightbox(photos.map(p => ({ url: p.url, kind: 'image', title: p.note || '' })), idx);
    return;
  }

  // About Us
  if (target.dataset.removeAboutImage !== undefined) {
    const i = Number(target.dataset.removeAboutImage);
    if (state.admin.aboutUsDraft) state.admin.aboutUsDraft.images.splice(i, 1);
    return render();
  }
  if (target.hasAttribute('data-save-about-us')) return saveAboutUs();
  if (target.hasAttribute('data-remove-promo-image')) {
    state.admin.promoImageDraft = '';
    const editing = (state.admin.data?.promotions || []).find(p => p.id === state.admin.editingPromoId);
    if (editing) editing.imageUrl = '';
    return render();
  }
  if (target.dataset.markNotification) return markNotificationRead(target.dataset.markNotification);
  if (target.hasAttribute('data-mark-all-notifications')) return markAllNotificationsRead();
  if (target.hasAttribute('data-clear-all-notifications')) return clearAllNotifications();
  if (target.dataset.deleteNotification) return deleteNotification(target.dataset.deleteNotification);
  if (target.dataset.agendaView) {
    state.admin.agendaView = target.dataset.agendaView;
    if (target.dataset.agendaView === 'weekly') loadWeeklyAppointments();
    return render();
  }
  if (target.hasAttribute('data-open-manual-booking')) return openManualBooking();
  if (target.hasAttribute('data-close-manual-booking')) {
    state.admin.manualBooking = null;
    return render();
  }
  if (target.hasAttribute('data-confirm-manual-booking')) return submitManualBooking();
  if (target.hasAttribute('data-save-multi-gallery')) {
    const cat = document.getElementById('multi-upload-category')?.value || '';
    return saveMultiUploadToGallery(cat);
  }
  if (target.dataset.adminTab) {
    state.admin.tab = target.dataset.adminTab;
    if (state.admin.tab !== 'clientas') state.admin.selectedClientId = null;
    if (state.admin.tab === 'integraciones') loadGoogleCalendarStatus();
    if (state.admin.tab === 'configuracion') {
      state.admin.configDraft = JSON.parse(JSON.stringify(state.salonConfig || {}));
      state.admin.homepageDraft = JSON.parse(JSON.stringify(state.salonConfig?.homepage || {}));
    }
    return render();
  }
  if (target.dataset.clientProfile) {
    state.admin.tab = 'clientas';
    state.admin.selectedClientId = target.dataset.clientProfile;
    return render();
  }
  if (target.hasAttribute('data-client-back')) {
    state.admin.selectedClientId = null;
    return render();
  }
  if (target.dataset.cycleStatus) return cycleStatus(target.dataset.cycleStatus, target.dataset.currentStatus);
  if (target.dataset.priceStep) {
    const id = target.dataset.priceStep;
    const service = state.admin.data.services.find(s => s.id === id);
    return updateService(id, { price: Number(service.price) + Number(target.dataset.delta) });
  }
  if (target.dataset.toggleService) {
    return updateService(target.dataset.toggleService, { active: target.dataset.active !== '1' });
  }
  if (target.dataset.selectCourse) return selectCourse(target.dataset.selectCourse);
  if (target.hasAttribute('data-cancel-course-select')) {
    state.academia.selectedCourseId = null;
    return render();
  }
  if (target.dataset.carouselPrev) {
    const id = target.dataset.carouselPrev;
    const course = courseById(id);
    const total = course?.imageUrls?.length || 1;
    state.academia.imageIndex[id] = ((state.academia.imageIndex[id] || 0) - 1 + total) % total;
    return render();
  }
  if (target.dataset.carouselNext) {
    const id = target.dataset.carouselNext;
    const course = courseById(id);
    const total = course?.imageUrls?.length || 1;
    state.academia.imageIndex[id] = ((state.academia.imageIndex[id] || 0) + 1) % total;
    return render();
  }
  if (target.hasAttribute('data-confirm-course-registration')) return submitCourseRegistration();
  if (target.hasAttribute('data-reset-academia')) {
    state.academia = { selectedCourseId: null, name: '', whatsapp: '', email: '', notes: '', imageIndex: state.academia.imageIndex, error: '', success: null };
    return render();
  }
  if (target.dataset.editPromo) {
    state.admin.editingPromoId = target.dataset.editPromo;
    return render();
  }
  if (target.hasAttribute('data-cancel-promo-edit')) {
    state.admin.editingPromoId = null;
    return render();
  }
  if (target.dataset.togglePromo) return togglePromotion(target.dataset.togglePromo, target.dataset.active);
  if (target.dataset.deletePromo) return deletePromotion(target.dataset.deletePromo);
  if (target.dataset.editCourse) {
    state.admin.editingCourseId = target.dataset.editCourse;
    const course = courseById(target.dataset.editCourse) || (state.admin.data?.courses || []).find(c => c.id === target.dataset.editCourse);
    state.admin.courseImageDraft = course?.imageUrls ? [...course.imageUrls] : [];
    return render();
  }
  if (target.hasAttribute('data-cancel-course-edit')) {
    state.admin.editingCourseId = null;
    state.admin.courseImageDraft = [];
    return render();
  }
  if (target.dataset.removeCourseImage !== undefined) {
    removeCourseDraftImage(target.dataset.removeCourseImage);
    return;
  }
  if (target.dataset.toggleCourse) return toggleCourse(target.dataset.toggleCourse, target.dataset.active);
  if (target.dataset.deleteCourse) return deleteCourse(target.dataset.deleteCourse);
  if (target.dataset.confirmRegistration) return updateCourseRegistrationStatus(target.dataset.confirmRegistration, 'confirmed');
  if (target.dataset.cancelRegistration) return updateCourseRegistrationStatus(target.dataset.cancelRegistration, 'cancelled');
  if (target.dataset.editService) {
    state.admin.editingServiceId = target.dataset.editService;
    return render();
  }
  if (target.hasAttribute('data-cancel-service-edit')) {
    state.admin.editingServiceId = null;
    return render();
  }
  if (target.dataset.deleteService) return deleteServiceEntry(target.dataset.deleteService);
  if (target.dataset.viewServiceImages) {
    const svc = (state.admin.data?.services || []).find(s => s.id === target.dataset.viewServiceImages);
    if (svc) {
      const imgs = (svc.imageUrls?.length ? svc.imageUrls : (svc.imageUrl ? [svc.imageUrl] : [])).filter(Boolean);
      if (imgs.length) openLightbox(imgs.map(url => ({ url, kind: 'image', title: svc.name })), 0);
    }
    return;
  }
  if (target.dataset.toggleFeaturedService) return toggleFeaturedService(target.dataset.toggleFeaturedService, target.dataset.featured);
  if (target.dataset.editMedia) {
    state.admin.editingMediaId = target.dataset.editMedia;
    const item = (state.admin.data?.media || []).find(m => m.id === target.dataset.editMedia);
    state.admin.mediaDraft = item ? { url: item.url, kind: item.kind, posterUrl: item.posterUrl } : null;
    return render();
  }
  if (target.hasAttribute('data-cancel-media-edit')) {
    state.admin.editingMediaId = null;
    state.admin.mediaDraft = null;
    return render();
  }
  if (target.hasAttribute('data-clear-media-draft')) return clearMediaDraft();
  if (target.dataset.toggleMediaCarousel) return toggleMediaFlag(target.dataset.toggleMediaCarousel, 'showInCarousel', target.dataset.active !== '1');
  if (target.dataset.toggleMediaGallery) return toggleMediaFlag(target.dataset.toggleMediaGallery, 'showInGallery', target.dataset.active !== '1');
  if (target.dataset.deleteMedia) return deleteMediaEntry(target.dataset.deleteMedia);
});

app.addEventListener('input', event => {
  const el = event.target;
  if (el.dataset.field) state.booking[el.dataset.field] = el.value;
  if (el.dataset.adminField) state.admin[el.dataset.adminField] = el.value;
  if (el.dataset.mbField && state.admin.manualBooking) state.admin.manualBooking[el.dataset.mbField] = el.value;
  if (el.dataset.aboutField && state.admin.aboutUsDraft) state.admin.aboutUsDraft[el.dataset.aboutField] = el.value;
  if (el.dataset.academiaField) state.academia[el.dataset.academiaField] = el.value;
  if (el.hasAttribute('data-rebook-whatsapp')) state.booking.rebook.whatsapp = el.value;
  // Homepage content editor — dot-path fields like "hero.eyebrow"
  if (el.dataset.hpField) {
    if (!state.admin.homepageDraft) state.admin.homepageDraft = {};
    const path = el.dataset.hpField.split('.');
    if (path.length === 1) {
      state.admin.homepageDraft[path[0]] = el.value;
    } else {
      if (!state.admin.homepageDraft[path[0]]) state.admin.homepageDraft[path[0]] = {};
      state.admin.homepageDraft[path[0]][path[1]] = el.value;
    }
  }
  // Flat item lists (trustPills, testimonials)
  if (el.dataset.hpItem) {
    const key = el.dataset.hpItem;
    const idx = Number(el.dataset.hpItemIdx);
    const field = el.dataset.hpItemField;
    if (state.admin.homepageDraft?.[key]?.[idx]) {
      state.admin.homepageDraft[key][idx][field] = el.value;
    }
  }
  // Nested item lists (socialProof.stats, whyUs.items, experience.steps)
  if (el.dataset.hpNested) {
    const pKey = el.dataset.hpNested;
    const cKey = el.dataset.hpNestedChild;
    const idx = Number(el.dataset.hpNestedIdx);
    const field = el.dataset.hpNestedField;
    if (state.admin.homepageDraft?.[pKey]?.[cKey]?.[idx]) {
      state.admin.homepageDraft[pKey][cKey][idx][field] = el.value;
    }
  }
  if (el.hasAttribute('data-admin-clients-search')) {
    state.admin.clientSearch = el.value;
    render();
  }
  if (el.hasAttribute('data-gallery-search')) {
    state.gallerySearch = el.value;
    state.galleryVisibleCount = 9;
    render();
  }
  if (el.dataset.heroImgUrl !== undefined) {
    const i = Number(el.dataset.heroImgUrl);
    if (!state.salonConfig.heroImages) state.salonConfig.heroImages = [];
    if (state.salonConfig.heroImages[i]) state.salonConfig.heroImages[i].url = el.value;
  }
  if (el.dataset.heroImgTitle !== undefined) {
    const i = Number(el.dataset.heroImgTitle);
    if (state.salonConfig.heroImages?.[i]) state.salonConfig.heroImages[i].title = el.value;
  }
  if (el.dataset.heroImgSubtitle !== undefined) {
    const i = Number(el.dataset.heroImgSubtitle);
    if (state.salonConfig.heroImages?.[i]) state.salonConfig.heroImages[i].subtitle = el.value;
  }
});


app.addEventListener('change', async event => {
  const el = event.target;
  // Manual booking selects
  if (el.dataset.mbField && state.admin.manualBooking) {
    state.admin.manualBooking[el.dataset.mbField] = el.value;
  }
  if (el.matches('[data-booking-date-input]')) {
    state.booking.date = el.value;
    state.booking.time = null;
    await loadAvailability();
    return render();
  }
  if (el.matches('[data-course-image-input]')) {
    return handleCourseImageFilesSelected(el);
  }
  if (el.matches('[data-media-file-input]')) {
    return handleMediaFileSelected(el);
  }
  if (el.matches('[data-multi-upload-input]')) {
    return handleMultiUploadFiles(el);
  }
  if (el.matches('[data-staff-photo-input]')) {
    const file = el.files?.[0];
    if (!file) return;
    const invalid = validateMediaFile(file);
    if (invalid) { state.admin.error = invalid; el.value = ''; return render(); }
    state.admin.error = '';
    state.admin.staffUploading = true;
    render();
    try {
      state.admin.staffPhotoDraft = await uploadAdminImage(file);
    } catch (err) {
      state.admin.error = `No se pudo subir la foto: ${err.message}`;
    }
    state.admin.staffUploading = false;
    el.value = '';
    return render();
  }
  if (el.dataset.clientPhotoInput !== undefined) {
    return uploadClientPhoto(el);
  }
  if (el.matches('[data-promo-image-input]')) {
    const file = el.files?.[0];
    if (!file) return;
    const invalid = validateMediaFile(file);
    if (invalid) { state.admin.error = invalid; el.value = ''; return render(); }
    state.admin.error = '';
    render();
    try {
      state.admin.promoImageDraft = await uploadAdminImage(file);
    } catch (err) {
      state.admin.error = `No se pudo subir la imagen: ${err.message}`;
    }
    el.value = '';
    return render();
  }
  if (el.matches('[data-about-image-input]')) {
    const file = el.files?.[0];
    if (!file) return;
    const invalid = validateMediaFile(file);
    if (invalid) { state.admin.error = invalid; el.value = ''; return render(); }
    if (!state.admin.aboutUsDraft) state.admin.aboutUsDraft = { title: 'Sobre Nosotros', text: '', images: [] };
    if (!Array.isArray(state.admin.aboutUsDraft.images)) state.admin.aboutUsDraft.images = [];
    state.admin.error = '';
    state.admin.aboutUsUploading = true;
    render();
    try {
      const url = await uploadAdminImage(file);
      state.admin.aboutUsDraft.images.push(url);
    } catch (err) {
      state.admin.error = `No se pudo subir la imagen: ${err.message}`;
    }
    state.admin.aboutUsUploading = false;
    el.value = '';
    return render();
  }
  if (el.dataset.heroImgFile !== undefined) {
    const idx = Number(el.dataset.heroImgFile);
    const file = el.files?.[0];
    if (!file) return;
    if (!state.salonConfig) state.salonConfig = {};
    if (!Array.isArray(state.salonConfig.heroImages)) state.salonConfig.heroImages = [];
    // Ensure the row exists before we write into it (previously failed silently).
    if (!state.salonConfig.heroImages[idx]) {
      state.salonConfig.heroImages[idx] = { url: '', title: '', subtitle: '' };
    }
    const invalid = validateMediaFile(file);
    if (invalid) {
      state.admin.error = invalid;
      el.value = '';
      return render();
    }
    state.admin.error = '';
    state.admin.heroUploadingIndex = idx;
    render();
    try {
      const url = await uploadAdminImage(file);
      if (!url) throw new Error('El servidor no devolvió una URL de imagen.');
      state.salonConfig.heroImages[idx].url = url;
    } catch (err) {
      state.admin.error = `No se pudo subir la foto: ${err.message}`;
    }
    state.admin.heroUploadingIndex = null;
    render();
  }
});

app.addEventListener('submit', event => {
  if (event.target.matches('[data-staff-form]')) {
    event.preventDefault();
    return createOrUpdateStaff(event.target);
  }
  const postForm = event.target.closest('[data-post-form]');
  if (postForm) {
    event.preventDefault();
    createPost(postForm);
    return;
  }
  const clientForm = event.target.closest('[data-client-profile-form]');
  if (clientForm) {
    event.preventDefault();
    updateClientProfile(clientForm);
    return;
  }
  const promoForm = event.target.closest('[data-promo-form]');
  if (promoForm) {
    event.preventDefault();
    createOrUpdatePromotion(promoForm);
    return;
  }
  const courseForm = event.target.closest('[data-course-form]');
  if (courseForm) {
    event.preventDefault();
    createOrUpdateCourse(courseForm);
    return;
  }
  const serviceForm = event.target.closest('[data-service-form]');
  if (serviceForm) {
    event.preventDefault();
    createOrUpdateService(serviceForm);
    return;
  }
  const mediaForm = event.target.closest('[data-media-form]');
  if (mediaForm) {
    event.preventDefault();
    createOrUpdateMedia(mediaForm);
    return;
  }
  const settingsForm = event.target.closest('[data-settings-form]');
  if (settingsForm) {
    event.preventDefault();
    saveSettings(settingsForm.dataset.settingsForm, new FormData(settingsForm));
  }
});

// Back/forward now traverse real URLs, not hashes.
window.addEventListener('popstate', () => {
  setRouteFromUrl();
  openPendingServiceFromUrl();
  render();
});

window.addEventListener('hashchange', () => {
  setHashMode();
  if (state.mode === 'admin') checkAdmin().then(render);
  else render();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (state.lightbox) return closeLightbox();
    if (state.serviceModalId) {
      state.serviceModalId = null;
      return render();
    }
  }
  if (state.lightbox) {
    if (event.key === 'ArrowRight') return lightboxNext();
    if (event.key === 'ArrowLeft') return lightboxPrev();
  }
});

loadInitial().catch(err => {
  app.innerHTML = `<div class="loading-card">Error: ${esc(err.message)}</div>`;
});

// (Hero auto-advance now runs on the shared auto-carousel ticker above.)

// (The old hover-based image cycler was removed: it targeted `.service-thumb-multi`,
// a class the Story 7 card redesign renamed, so it had silently stopped working —
// and hover doesn't exist on a phone anyway. All carousels now run on the shared
// auto-carousel engine, which works on touch and desktop alike.)
