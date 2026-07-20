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
  menuOpen: false,
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
    focusSlug: null,
    name: '',
    whatsapp: '',
    email: '',
    notes: '',
    imageIndex: {},
    error: '',
    success: null
  },
  clientAuth: {
    loggedIn: false,
    displayName: '',
    whatsapp: '',
    clientId: null,
    showForm: '', // 'login' | 'register' | 'verify' | ''
    loginWhatsapp: '',
    loginPassword: '',
    regName: '',
    regWhatsapp: '',
    regEmail: '',
    regPassword: '',
    otpCode: '',
    otpSent: '',       // the code we generated
    otpExpiry: 0,      // timestamp
    error: '',
    loading: false,
    appointments: [],
    appointmentsLoaded: false
  },
  blogPosts: [],
  chat: {
    open: false,
    messages: [],
    draft: '',
    sending: false,
    loaded: false
  },
  adminChat: {
    threads: [],
    totalUnread: 0,
    activeThreadId: null,
    messages: [],
    draft: '',
    toast: null
  },
  blogDetail: null,
  blogAdmin: {
    editingId: null,
    coverImageDraft: '',
    coverUploading: false,
    // Block-based content: [{type:'text',content:''}, {type:'image',url:'',caption:''}]
    blocks: [],
    blockUploading: null // index of block currently uploading
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

const CLIENT_TABS = ['inicio', 'servicios', 'reservar', 'galeria', 'academia', 'blog', 'mi-cuenta'];

// Mirrors lib/domains/seo.js — must produce identical slugs.
function clientSlugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120) || 'item';
}
function clientCourseSlug(course) {
  return `${clientSlugify(course.title)}-${String(course.id).slice(-6)}`;
}

/*
  Routing — path-based URLs, the SEO-friendly kind:
    /               home
    /servicios      etc. for every tab
    /blog/slug      blog article (server injects its meta tags too)
    /academia/slug  course detail (opens academia with the course focused)
  Legacy hash URLs (#servicios, #blog/slug, #admin) still work: they are
  read once at boot and immediately upgraded to the path form.
*/
function setHashMode() {
  const hash = location.hash.replace('#', '');
  const path = location.pathname.replace(/\/+$/, '') || '/';

  // Admin stays on hash (never indexed, keeps its own session flow).
  if (hash === 'admin') { state.mode = 'admin'; return; }

  // Path routing first.
  if (path.startsWith('/blog/')) {
    state.mode = 'client';
    state.tab = 'blog';
    const slug = decodeURIComponent(path.slice(6));
    if (slug) loadBlogDetail(slug);
    return;
  }
  if (path.startsWith('/academia/')) {
    state.mode = 'client';
    state.tab = 'academia';
    state.academia.focusSlug = decodeURIComponent(path.slice(10));
    return;
  }
  const pathTab = path === '/' ? 'inicio' : path.slice(1);
  if (CLIENT_TABS.includes(pathTab)) {
    state.mode = 'client';
    state.tab = pathTab;
    return;
  }

  // Legacy hash URLs → upgrade to paths.
  if (hash.startsWith('blog/')) {
    state.mode = 'client';
    state.tab = 'blog';
    const slug = hash.slice(5);
    if (slug) loadBlogDetail(slug);
    return;
  }
  if (CLIENT_TABS.includes(hash)) {
    state.mode = 'client';
    state.tab = hash;
    history.replaceState(null, '', hash === 'inicio' ? '/' : `/${hash}`);
  }
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

function whatsappChatUrl(message = 'Hola Black Rococo, quiero información para agendar una cita ✨') {
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

function goClient(tab) {
  state.mode = 'client';
  state.tab = tab;
  if (tab !== 'blog') state.blogDetail = null;
  // Navigating anywhere always dismisses transient overlays.
  state.menuOpen = false;
  state.serviceModalId = null;
  const newPath = tab === 'inicio' ? '/' : `/${tab}`;
  if (location.pathname !== newPath) history.pushState({ tab }, '', newPath);
  window.scrollTo(0, 0);
  updatePageMeta();
  render();
}

// SEO: keep <title> in sync with the visible page. Crawlers that execute JS
// (Google) index the per-tab titles; users get meaningful browser-tab labels
// and share previews.
const PAGE_TITLES = {
  inicio: null, // keep the rich default title from index.html
  servicios: 'Servicios y precios',
  reservar: 'Reservar cita',
  galeria: 'Galería de trabajos',
  academia: 'Cursos — Black Rococo Academy',
  blog: 'Blog',
  'mi-cuenta': 'Mi cuenta'
};
const BASE_TITLE = document.title;

function updatePageMeta() {
  if (state.blogDetail) {
    document.title = `${state.blogDetail.title} | Black Rococo`;
    injectBlogJsonLd(state.blogDetail);
    return;
  }
  removeBlogJsonLd();
  const t = PAGE_TITLES[state.tab];
  document.title = t ? `${t} | Black Rococo` : BASE_TITLE;
}

function injectBlogJsonLd(post) {
  removeBlogJsonLd();
  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.id = 'blog-jsonld';
  script.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.excerpt || '',
    image: post.coverImageUrl || undefined,
    author: { '@type': 'Organization', name: post.author || 'Black Rococo' },
    publisher: { '@type': 'Organization', name: 'Black Rococo' },
    datePublished: post.createdAt,
    dateModified: post.updatedAt || post.createdAt
  });
  document.head.appendChild(script);
}

function removeBlogJsonLd() {
  document.getElementById('blog-jsonld')?.remove();
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
  history.replaceState(null, '', '#reservar');
  if (serviceId) loadAvailability();
  render();
}

async function loadInitial() {
  setHashMode();
  const data = await api('/api/config');
  state.config = data.settings;
  state.salonConfig = data.salonConfig || { colors: [], bebidas: [], estilos: [], serviceCategories: [], galleryCategories: [], heroImages: [] };
  state.staff = data.staff || [];
  state.services = data.services;
  state.groupedServices = data.groupedServices;
  state.promotions = data.promotions || [];
  state.courses = data.courses || [];
  state.media = data.media || { gallery: [], carousel: [], categories: [] };
  state.blogPosts = data.blogPosts || [];
  state.booking.date = todayLocal();
  // Check client auth session
  checkClientSession();
  if (state.mode === 'admin') {
    await checkAdmin();
    if (new URLSearchParams(location.search).has('gcal')) {
      state.admin.tab = 'integraciones';
      if (state.admin.loggedIn) loadGoogleCalendarStatus();
    }
  }
  render();
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
  loadAdminChats(); // fire-and-forget; updates the CHAT tab badge
}

// --- Client auth ---
async function checkClientSession() {
  try {
    const data = await api('/api/client/me');
    state.clientAuth.loggedIn = Boolean(data.loggedIn);
    state.clientAuth.displayName = data.displayName || '';
    state.clientAuth.whatsapp = data.whatsapp || '';
    state.clientAuth.clientId = data.clientId || null;
  } catch (_) {
    state.clientAuth.loggedIn = false;
  }
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function sendOtpViaWhatsApp() {
  const ca = state.clientAuth;
  if (!ca.regName || ca.regName.trim().length < 2) { ca.error = 'Escribe tu nombre.'; render(); return; }
  const wp = ca.regWhatsapp.replace(/\D/g, '');
  if (wp.length < 8) { ca.error = 'WhatsApp inválido.'; render(); return; }
  if ((ca.regPassword || '').length < 6) { ca.error = 'La contraseña debe tener al menos 6 caracteres.'; render(); return; }
  ca.error = '';
  const code = generateOtp();
  ca.otpSent = code;
  ca.otpExpiry = Date.now() + 10 * 60 * 1000; // 10 min
  ca.showForm = 'verify';
  // Open WhatsApp with the verification code pre-filled for the user to send to themselves
  const fullNum = wp.startsWith('52') ? wp : '52' + wp;
  const msg = encodeURIComponent(`Mi código de verificación Black Rococo es: ${code}`);
  window.open(`https://api.whatsapp.com/send/?phone=${fullNum}&text=${msg}`, '_blank');
  render();
}

function verifyOtpAndRegister() {
  const ca = state.clientAuth;
  if (!ca.otpCode || ca.otpCode.trim() !== ca.otpSent) {
    ca.error = 'El código no coincide. Revisa tu WhatsApp.';
    render();
    return;
  }
  if (Date.now() > ca.otpExpiry) {
    ca.error = 'El código expiró. Vuelve a intentar.';
    ca.showForm = 'register';
    ca.otpSent = '';
    ca.otpCode = '';
    render();
    return;
  }
  // Code matches — proceed with registration
  clientRegister();
}

async function clientRegister() {
  const ca = state.clientAuth;
  ca.error = '';
  ca.loading = true;
  render();
  try {
    const data = await api('/api/client/register', {
      method: 'POST',
      body: { name: ca.regName, whatsapp: ca.regWhatsapp, email: ca.regEmail, password: ca.regPassword }
    });
    ca.loggedIn = true;
    ca.displayName = data.displayName;
    ca.whatsapp = data.whatsapp;
    ca.showForm = '';
    ca.regName = ''; ca.regWhatsapp = ''; ca.regEmail = ''; ca.regPassword = '';
    ca.otpSent = ''; ca.otpCode = '';
    await checkClientSession();
  } catch (err) {
    ca.error = err.message;
    ca.showForm = 'register';
  }
  ca.loading = false;
  render();
}

async function clientLogin() {
  const ca = state.clientAuth;
  ca.error = '';
  ca.loading = true;
  render();
  try {
    const data = await api('/api/client/login', {
      method: 'POST',
      body: { whatsapp: ca.loginWhatsapp, password: ca.loginPassword }
    });
    ca.loggedIn = true;
    ca.displayName = data.displayName;
    ca.whatsapp = data.whatsapp;
    ca.showForm = '';
    ca.loginWhatsapp = ''; ca.loginPassword = '';
    await checkClientSession();
  } catch (err) {
    ca.error = err.message;
  }
  ca.loading = false;
  render();
}

async function clientLogout() {
  try { await api('/api/client/logout', { method: 'POST' }); } catch (_) {}
  state.clientAuth.loggedIn = false;
  state.clientAuth.displayName = '';
  state.clientAuth.whatsapp = '';
  state.clientAuth.clientId = null;
  state.clientAuth.appointments = [];
  state.clientAuth.appointmentsLoaded = false;
  state.clientAuth.showForm = '';
  render();
}

async function loadClientAppointments() {
  if (state.clientAuth.appointmentsLoaded) return;
  try {
    const data = await api('/api/client/appointments');
    state.clientAuth.appointments = data.appointments || [];
    state.clientAuth.appointmentsLoaded = true;
  } catch (err) {
    state.clientAuth.error = err.message;
  }
  render();
}

// --- Visitor chat ---
async function loadChatMessages() {
  try {
    const data = await api('/api/chat/messages');
    state.chat.messages = data.messages || [];
    state.chat.loaded = true;
    // Targeted update: if the chat panel is open, patch just the messages
    // container instead of tearing down the whole DOM with render().
    const msgBox = document.querySelector('.chat-panel .chat-messages');
    if (msgBox) {
      updateChatMessagesDOM(msgBox, state.chat.messages, 'client');
    } else {
      render();
    }
    scrollChatToBottom();
  } catch (_) {}
}

/* Downscale an image File/Blob to ≤1024px JPEG so it fits the server's
   1MB request cap. Returns a data URL, or null if it can't be processed. */
function compressChatImage(file) {
  return new Promise(resolve => {
    if (!file || !file.type.startsWith('image/')) return resolve(null);
    const img = new Image();
    const objUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objUrl);
      const MAX = 1024;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        const scale = MAX / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      let quality = 0.8;
      let dataUrl = canvas.toDataURL('image/jpeg', quality);
      // Step quality down until it fits the server cap.
      while (dataUrl.length > 900_000 && quality > 0.3) {
        quality -= 0.15;
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      }
      resolve(dataUrl.length <= 900_000 ? dataUrl : null);
    };
    img.onerror = () => { URL.revokeObjectURL(objUrl); resolve(null); };
    img.src = objUrl;
  });
}

async function sendChatImage(file, isAdmin) {
  const dataUrl = await compressChatImage(file);
  if (!dataUrl) return;
  try {
    if (isAdmin) {
      const threadId = state.adminChat.activeThreadId;
      if (!threadId) return;
      const data = await api(`/api/admin/chats/${encodeURIComponent(threadId)}/reply`, {
        method: 'POST', body: { text: '', image: dataUrl }
      });
      if (data.message) state.adminChat.messages.push(data.message);
      patchAdminChatMessages();
    } else {
      const data = await api('/api/chat/messages', {
        method: 'POST',
        body: { text: '', image: dataUrl, name: state.clientAuth.displayName || undefined }
      });
      if (data.message) state.chat.messages.push(data.message);
      const msgBox = document.querySelector('.chat-panel .chat-messages');
      if (msgBox) updateChatMessagesDOM(msgBox, state.chat.messages, 'client');
    }
    scrollChatToBottom();
  } catch (_) { /* transient; user can retry */ }
}

/* Escape first, then turn bare URLs into safe clickable links.
   Only http(s) URLs are linkified, so no javascript: injection is possible. */
function linkifyEsc(text) {
  const escaped = esc(text || '');
  return escaped.replace(/(https?:\/\/[^\s<]+)/g, url => {
    // Trim trailing punctuation that's almost never part of the URL.
    const clean = url.replace(/[.,;:!?)\]]+$/, '');
    const trail = url.slice(clean.length);
    return `<a href="${clean}" target="_blank" rel="noopener noreferrer" class="chat-link">${clean}</a>${trail}`;
  });
}

/* Patch just the chat message list — avoids full innerHTML rebuild and the
   resulting flash / scroll-jump that users see as "fluctuation". */
function updateChatMessagesDOM(container, messages, perspective) {
  const isEmpty = messages.length === 0;
  const html = isEmpty
    ? `<div class="chat-empty">¡Hola! Escríbenos y te ayudamos con tu cita, precios o cualquier duda.</div>`
    : messages.map(m => {
        const mine = (perspective === 'client' && m.sender === 'client') ||
                     (perspective === 'admin'  && m.sender === 'admin');
        const timeStr = perspective === 'admin'
          ? `${esc(m.name)} · ${esc(new Date(m.createdAt).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}`
          : esc(new Date(m.createdAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }));
        return `<div class="chat-msg ${mine ? 'mine' : 'theirs'}">
          <div class="chat-bubble">${m.imageUrl ? `<img class="chat-img" src="${esc(m.imageUrl)}" alt="Imagen adjunta" loading="lazy" data-chat-img>` : ''}${m.text ? `<div>${linkifyEsc(m.text)}</div>` : ''}</div>
          <div class="chat-time">${timeStr}</div>
        </div>`;
      }).join('');
  container.innerHTML = html;
}

async function sendChatMessage() {
  const text = state.chat.draft.trim();
  if (!text || state.chat.sending) return;
  state.chat.sending = true;
  // Disable send button directly instead of full render
  const sendBtn = document.querySelector('.chat-panel .chat-send');
  if (sendBtn) sendBtn.disabled = true;
  try {
    const data = await api('/api/chat/messages', {
      method: 'POST',
      body: { text, name: state.clientAuth.displayName || undefined }
    });
    if (data.message) state.chat.messages.push(data.message);
    state.chat.draft = '';
    // Clear input directly
    const input = document.querySelector('.chat-panel .chat-input');
    if (input) input.value = '';
  } catch (err) { /* keep draft so user can retry */ }
  state.chat.sending = false;
  // Patch just the message list
  const msgBox = document.querySelector('.chat-panel .chat-messages');
  if (msgBox) {
    updateChatMessagesDOM(msgBox, state.chat.messages, 'client');
  }
  if (sendBtn) sendBtn.disabled = false;
  // Keep the caret in the input — continuous typing like a real messenger.
  const inputEl = document.querySelector('.chat-panel .chat-input');
  if (inputEl) inputEl.focus();
  scrollChatToBottom();
}

function scrollChatToBottom() {
  // Double-rAF ensures the DOM has fully painted (especially after innerHTML
  // patches) before we measure scrollHeight. Prevents the "jump" users see.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const boxes = document.querySelectorAll('.chat-messages');
      boxes.forEach(box => { box.scrollTop = box.scrollHeight; });
    });
  });
}

// --- Admin chat ---
async function loadAdminChats() {
  try {
    const data = await api('/api/admin/chats');
    state.adminChat.threads = data.threads || [];
    state.adminChat.totalUnread = data.totalUnread || 0;
    // Guard: never full-render while the admin is typing (would eat
    // keystrokes), and never while a chat thread is open (the thread is
    // patched in place — a full render would re-introduce the flicker).
    const typing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    if (state.mode === 'admin' && !typing && !state.adminChat.activeThreadId) render();
  } catch (_) {}
}

async function openAdminThread(threadId) {
  state.adminChat.activeThreadId = threadId;
  try {
    const data = await api(`/api/admin/chats/${encodeURIComponent(threadId)}`);
    state.adminChat.messages = data.messages || [];
    // Opening marks as read server-side; refresh counts.
    loadAdminChats();
  } catch (_) {}
  render();
  scrollChatToBottom();
}

/* Targeted admin-chat message patch — mirrors the visitor-side fix so the
   admin view doesn't flash/jump either when new messages arrive. */
function patchAdminChatMessages() {
  const msgBox = document.querySelector('.admin-chat-messages');
  if (msgBox) {
    updateChatMessagesDOM(msgBox, state.adminChat.messages, 'admin');
  } else {
    render();
  }
}

async function sendAdminReply() {
  const text = state.adminChat.draft.trim();
  const threadId = state.adminChat.activeThreadId;
  if (!text || !threadId) return;
  const sendBtn = document.querySelector('.admin-chat-card .chat-send');
  if (sendBtn) sendBtn.disabled = true;
  try {
    const data = await api(`/api/admin/chats/${encodeURIComponent(threadId)}/reply`, {
      method: 'POST', body: { text }
    });
    if (data.message) state.adminChat.messages.push(data.message);
    state.adminChat.draft = '';
    const input = document.querySelector('.admin-chat-card .chat-input');
    if (input) input.value = '';
  } catch (err) { state.admin.error = err.message; }
  // Targeted patch instead of full render
  patchAdminChatMessages();
  if (sendBtn) sendBtn.disabled = false;
  const inputEl = document.querySelector('.admin-chat-card .chat-input');
  if (inputEl) inputEl.focus();
  scrollChatToBottom();
}

function showAdminChatToast(info) {
  state.adminChat.toast = {
    name: info.name || 'Visitante',
    threadId: info.threadId,
    newThread: Boolean(info.newThread)
  };
  render();
  setTimeout(() => {
    if (state.adminChat.toast?.threadId === info.threadId) {
      state.adminChat.toast = null;
      render();
    }
  }, 6000);
}

// --- Blog ---
async function loadBlogDetail(id) {
  try {
    const data = await api(`/api/blogs/${encodeURIComponent(id)}`);
    state.blogDetail = data.post;
    state.tab = 'blog';
    state.mode = 'client';
    history.pushState({ blog: data.post.slug }, '', `/blog/${data.post.slug}`);
    updatePageMeta();
  } catch (err) {
    state.blogDetail = null;
  }
  render();
}

async function createOrUpdateBlog(form) {
  const fd = new FormData(form);
  // Serialize blocks to HTML body
  const blocks = state.blogAdmin.blocks || [];
  const bodyHtml = blocks.map(b => {
    if (b.type === 'text') return b.content || '';
    if (b.type === 'image' && b.url) {
      return `<figure class="blog-inline-figure"><img src="${b.url}" alt="${(b.caption || '').replace(/"/g, '&quot;')}" loading="lazy">${b.caption ? `<figcaption>${b.caption}</figcaption>` : ''}</figure>`;
    }
    return '';
  }).join('\n');

  const body = {
    title: fd.get('title') || '',
    excerpt: fd.get('excerpt') || '',
    body: bodyHtml,
    coverImageUrl: state.blogAdmin.coverImageDraft || fd.get('coverImageUrl') || '',
    published: fd.get('published') === 'on',
    tags: (fd.get('tags') || '').split(',').map(t => t.trim()).filter(Boolean),
    author: fd.get('author') || 'Black Rococo'
  };
  const editId = state.blogAdmin.editingId;
  try {
    if (editId && editId !== '__new__') {
      await api(`/api/admin/blogs/${editId}`, { method: 'PUT', body });
    } else {
      await api('/api/admin/blogs', { method: 'POST', body });
    }
    state.blogAdmin.editingId = null;
    state.blogAdmin.coverImageDraft = '';
    state.blogAdmin.blocks = [];
    await loadAdminDashboard();
  } catch (err) {
    state.admin.error = err.message;
  }
  render();
}

// Parse existing HTML body back into blocks for editing
function htmlToBlocks(html) {
  if (!html) return [{ type: 'text', content: '' }];
  const blocks = [];
  // Split on figure tags
  const parts = String(html).split(/(<figure[\s\S]*?<\/figure>)/gi);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const figMatch = trimmed.match(/<figure[^>]*>[\s\S]*?<img[^>]+src="([^"]*)"[^>]*(?:alt="([^"]*)")?[\s\S]*?(?:<figcaption>([\s\S]*?)<\/figcaption>)?[\s\S]*?<\/figure>/i);
    if (figMatch) {
      blocks.push({ type: 'image', url: figMatch[1] || '', caption: figMatch[3] || figMatch[2] || '' });
    } else {
      blocks.push({ type: 'text', content: trimmed });
    }
  }
  return blocks.length ? blocks : [{ type: 'text', content: '' }];
}

// Format blog body HTML for reader view: if the body contains no block-level
// HTML tags, treat each double-newline as a paragraph break. This ensures
// content typed as plain text in the block editor renders with proper spacing.
function formatBlogBody(raw) {
  if (!raw || !raw.trim()) return '<p><em>Sin contenido.</em></p>';
  const s = raw.trim();
  // If already has block-level tags, render as-is (it's proper HTML)
  if (/<(?:p|h[1-6]|div|ul|ol|li|blockquote|figure|table|section|article)\b/i.test(s)) return s;
  // Plain text — split on double newlines into paragraphs, preserve single
  // newlines as <br>. This mirrors the Manucurist-style flowing paragraph layout.
  return s
    .split(/\n\s*\n/)
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => `<p>${block.replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

async function deleteBlog(id) {
  if (!confirm('¿Eliminar esta entrada de blog?')) return;
  try {
    await api(`/api/admin/blogs/${id}`, { method: 'DELETE' });
    await loadAdminDashboard();
  } catch (err) {
    state.admin.error = err.message;
  }
  render();
}

async function toggleBlogPublish(id, currentlyPublished) {
  try {
    await api(`/api/admin/blogs/${id}/publish`, {
      method: 'PATCH',
      body: { published: !currentlyPublished }
    });
    await loadAdminDashboard();
  } catch (err) {
    state.admin.error = err.message;
  }
  render();
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

async function loadMonthlyAppointments() {
  // monthOffset lets the admin page through months (0 = current).
  const offset = state.admin.monthOffset || 0;
  const base = new Date();
  const first = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  const last = new Date(base.getFullYear(), base.getMonth() + offset + 1, 0);
  try {
    const data = await api(`/api/admin/appointments/range?start=${ymdLocal(first)}&end=${ymdLocal(last)}`);
    state.admin.monthlyAppointments = data.appointments || [];
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
  // Shareable, indexable URL for this specific course.
  const course = courseById(id);
  if (course) {
    history.pushState({ course: id }, '', `/academia/${clientCourseSlug(course)}`);
    document.title = `${course.title} | Black Rococo Academy`;
  }
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
  const ca = state.clientAuth;
  return `<header class="brand-header">
    <div class="brand-topbar">
      <div class="topbar-left">
        <button class="topbar-icon topbar-home" data-tab="inicio" aria-label="Inicio"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></button>
        <button class="topbar-icon topbar-menu" data-toggle-menu aria-label="Menú"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button>
      </div>
      <div class="topbar-center"><button class="topbar-brand" data-tab="inicio">${esc(one)} ${esc(two)}</button></div>
      <div class="topbar-right">
        <button class="topbar-icon topbar-account ${ca.loggedIn ? 'topbar-icon-active' : ''}" data-tab="mi-cuenta" aria-label="${ca.loggedIn ? 'Mi cuenta' : 'Acceder'}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 016-6h4a6 6 0 016 6v1"/></svg>${ca.loggedIn ? '<span class="topbar-dot"></span>' : ''}</button>
      </div>
    </div>
    ${state.menuOpen ? sideMenu() : ''}
  </header>`;
}

function sideMenu() {
  const tabs = [
    ['inicio', 'Inicio', '🏠'],
    ['servicios', 'Servicios', '💅'],
    ['reservar', 'Reservar cita', '📅'],
    ['academia', 'Academia', '🎓'],
    ['galeria', 'Galería', '📷'],
    ['blog', 'Blog', '✍️'],
    ['mi-cuenta', state.clientAuth.loggedIn ? 'Mi cuenta' : 'Acceder', '👤']
  ];
  return `<div class="side-menu-overlay" data-close-menu></div>
  <nav class="side-menu">
    <div class="side-menu-head">
      <span class="side-menu-title">MENÚ</span>
      <button class="topbar-icon" data-close-menu aria-label="Cerrar">✕</button>
    </div>
    ${tabs.map(([id, label, icon]) => `<button class="side-menu-item ${state.tab === id ? 'active' : ''}" data-menu-tab="${id}"><span class="side-menu-icon">${icon}</span><span>${label}</span></button>`).join('')}
    <div class="side-menu-footer">
      <a class="side-menu-wa" target="_blank" rel="noopener" href="${esc(whatsappChatUrl())}">💬 ESCRÍBENOS POR WHATSAPP</a>
    </div>
  </nav>`;
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
  return `<div class="featured-svc-card" data-view-service="${esc(s.id)}">
    <div class="featured-svc-img">
      ${imgs.length
        ? `<img src="${esc(imgs[0])}" alt="${esc(s.name)}" loading="lazy">`
        : `<div class="featured-svc-placeholder"></div>`}
    </div>
    <div class="featured-svc-info">
      <div class="featured-svc-name">${esc(s.name)}</div>
      <div class="featured-svc-dur">${esc(s.dur)} min</div>
      <div class="featured-svc-desc">${esc(s.desc)}</div>
      <div class="featured-svc-price">${priceDisplay(s)}</div>
    </div>
  </div>`;
}

function featuredServicesCarousel() {
  const items = (state.config.featuredServiceIds || [])
    .map(id => serviceById(id))
    .filter(Boolean);
  if (!items.length) return `<div class="empty">Aún no hay servicios destacados.</div>`;
  return `<div class="featured-svc-track">${items.map(featuredServiceCarouselCard).join('')}</div>`;
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
  const imgs = (s.imageUrls && s.imageUrls.length) ? s.imageUrls : (s.imageUrl ? [s.imageUrl] : []);
  return `<div class="modal-overlay" data-modal-backdrop>
    <div class="modal-card">
      <button class="modal-close" data-close-service-modal aria-label="Cerrar">✕</button>
      <div class="modal-scroll">
        ${imgs.length
          ? `<div class="modal-img-wrap"><img src="${esc(imgs[0])}" alt="${esc(s.name)}" loading="eager"></div>`
          : ''}
        <div class="modal-body">
          <div class="category-title">${esc(s.cat)}</div>
          <div class="service-name" style="font-size:22px;margin:6px 0">${esc(s.name)}</div>
          <div class="service-meta" style="margin-bottom:10px">${esc(s.dur)} min</div>
          <p class="subtitle">${esc(s.desc)}</p>
          <div class="price" style="font-size:26px;margin:16px 0 6px">${priceDisplay(s)}</div>
          ${discount ? `<div class="service-meta">${esc(discount.promo.label || 'Promoción aplicada')}</div>` : ''}
          <div class="modal-actions">
            <button class="btn btn-primary" data-book-from-modal="${esc(s.id)}">RESERVAR ESTE SERVICIO</button>
            <button class="btn btn-outline" data-close-service-modal>VOLVER</button>
          </div>
        </div>
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
  const carouselMedia = (state.media?.carousel || []).slice(0, 10);
  const heroImages = (state.salonConfig?.heroImages || []).filter(h => h.url);
  const heroSlide = Math.min(state.heroSlide || 0, Math.max(0, heroImages.length - 1));
  const heroItem = heroImages[heroSlide] || null;
  state.homeCarouselCache = carouselMedia;

  // About Us + team, both managed from the admin panel
  const about = state.salonConfig?.aboutUs || {};
  const aboutImages = (about.images || []).filter(Boolean);
  state.aboutImagesCache = aboutImages;
  const team = state.staff || [];

  // Social links
  const whatsappNum = (c.contact?.whatsappNumber || '').replace(/\D/g, '') || '5213326553522';
  const socialLinks = [
    { name: 'Instagram', url: c.contact.instagramUrl, icon: socialIconSvg('instagram') },
    { name: 'WhatsApp', url: `https://api.whatsapp.com/send/?phone=${whatsappNum}`, icon: socialIconSvg('whatsapp') },
    { name: 'TikTok', url: c.contact.tiktokUrl, icon: socialIconSvg('tiktok') },
    { name: 'Facebook', url: c.contact.facebookUrl, icon: socialIconSvg('facebook') }
  ].filter(l => l.url);

  // Google Maps embed URL
  // P0: this used to be a HARDCODED embed URL with fixed coordinates and a
  // placeholder place-ID of literally `0x0:0x0`. The admin panel offers editable
  // Address fields, but the map ignored them entirely — so changing the address
  // in Configuración updated the text above the map while the map itself kept
  // pointing at the old location. The two silently disagreed, and a customer
  // following the pin could be sent to the wrong place.
  //
  // Now derived from the saved address. `?q=<address>&output=embed` is Google's
  // keyless embed form: it geocodes the address string at render time, so the
  // map always matches whatever Configuración says. No API key required, so
  // there is nothing extra to provision or to expire.
  const mapsQuery = [c.contact.address1, c.contact.address2]
    .map(part => String(part || '').trim())
    .filter(Boolean)
    .join(', ');
  const mapsEmbedSrc = mapsQuery
    ? `https://www.google.com/maps?q=${encodeURIComponent(mapsQuery)}&hl=es&z=16&output=embed`
    : '';

  return `<section class="screen">
    ${brandHeader()}
    <div class="hero-intro">
      <div class="gold-rule"></div>
      <div class="tagline">${esc(c.brand.tagline)}</div>
      <div class="social-proof"><strong>★ ${esc(c.brand.rating)}</strong> · ${esc(c.brand.socialProof)}</div>
    </div>

    <!-- 1. HERO -->
    <div class="hero ${heroImages.length ? 'hero-has-image' : ''}">
      ${heroImages.length
        ? `<div class="hero-img-wrap">
            ${autoCarousel(
              heroImages.map(h => h.url),
              {
                alt: '',
                className: 'ac-fill hero-carousel',
                eager: true,
                captions: heroImages.map(h => ({ title: h.title, subtitle: h.subtitle }))
              }
            )}
            <div class="hero-img-overlay"></div>
          </div>`
        : `<div class="hero-art"><div class="hero-art-inner">✦</div></div>`}
      <div class="hero-overlay">
        <div class="hero-title" data-hero-title>${esc(heroItem?.title || c.brand.heroTitle)}</div>
        <div class="hero-subtitle" data-hero-subtitle>${esc(heroItem?.subtitle || c.brand.heroSubtitle)}</div>
      </div>
    </div>
    <div class="section-tight cta-row">
      <button class="btn btn-primary" data-tab="reservar">RESERVA TU CITA</button>
    </div>
    <div class="specialties"><span class="line"></span><div class="eyebrow">ESPECIALISTAS EN<br><span>${esc(c.brand.specialties)}</span></div><span class="line"></span></div>

    <!-- 2. SERVICES (Featured carousel + all services link) -->
    <div class="section">
      <div class="section-head"><div><div class="title">Servicios destacados</div><div class="subtitle">Los favoritos de nuestras clientas</div></div></div>
      ${featuredServicesCarousel()}
      <button class="btn btn-outline" style="margin-top:12px" data-tab="servicios">VER TODOS LOS SERVICIOS</button>
    </div>

    ${promoBanner()}

    <!-- 3. ABOUT US (content + images managed in Admin -> CONFIGURACIÓN) -->
    <div class="section about-section">
      <div class="about-inner">
        <div class="about-eyebrow">${esc((about.title || 'Sobre Nosotros').toUpperCase())}</div>
        <div class="about-title">${esc(c.brand.name || 'Black Rococo')}</div>
        <div class="about-rule"></div>
        <p class="about-text">${esc(about.text || 'Somos un estudio profesional de uñas en Ciudad Granja, Zapopan.')}</p>
        ${aboutImages.length ? `<div class="about-image-grid about-count-${Math.min(aboutImages.length, 3)}">
          ${aboutImages.map((url, i) => `<img src="${esc(url)}" alt="" loading="lazy" data-about-lightbox="${i}">`).join('')}
        </div>` : ''}
        <div class="about-stats">
          <div><span class="about-stat-number">${esc(c.brand.rating || '4.9')}</span><span class="about-stat-label">Calificación</span></div>
          <div><span class="about-stat-number">+500</span><span class="about-stat-label">Clientas felices</span></div>
          <div><span class="about-stat-number">6</span><span class="about-stat-label">Años de experiencia</span></div>
        </div>
      </div>
    </div>

    ${team.length ? `<!-- 3b. TEAM -->
    <div class="section team-section">
      <div class="section-head"><div><div class="title">Nuestro Equipo</div><div class="subtitle">Las manos detrás de tus uñas</div></div></div>
      <div class="team-grid">
        ${team.map(m => `<div class="team-card">
          ${m.photoUrl
            ? `<img class="team-photo" src="${esc(m.photoUrl)}" alt="${esc(m.name)}" loading="lazy">`
            : `<div class="team-photo team-photo-empty">${esc((m.name || '?').charAt(0))}</div>`}
          <div class="team-name">${esc(m.name)}</div>
          ${m.role ? `<div class="team-role">${esc(m.role)}</div>` : ''}
          ${m.bio ? `<p class="team-bio">${esc(m.bio)}</p>` : ''}
          ${m.instagram ? `<a class="team-ig" href="${esc(m.instagram)}" target="_blank" rel="noopener">Instagram</a>` : ''}
        </div>`).join('')}
      </div>
    </div>` : ''}

    <!-- 4. GALLERY -->
    <div class="section">
      <div class="section-head"><div class="title">Resultados reales</div><button class="pill-button" data-tab="galeria">VER GALERÍA →</button></div>
      <div class="carousel">
        ${carouselMedia.length
          ? carouselMedia.map((m, i) => mediaThumbCard(m, i, 'homeCarousel')).join('')
          : `<div class="image-card"><div class="placeholder">Aún no hay fotos<br>sube fotos reales en Admin → GALERÍA</div></div>`}
      </div>
    </div>

    ${(state.blogPosts || []).length ? `<div class="section">
      <div class="section-head"><div class="title">Blog</div><button class="pill-button" data-tab="blog">VER TODOS →</button></div>
      <div class="card-list">
        ${(state.blogPosts || []).slice(0, 2).map(p => {
          const dateStr = new Date(p.createdAt).toLocaleDateString('es-MX', { month: 'short', day: 'numeric' });
          return `<div class="card blog-card" data-blog-open="${esc(p.slug || p.id)}" style="cursor:pointer">
            <div class="eyebrow">${esc(dateStr)}</div>
            <div class="title" style="font-size:16px;margin:4px 0">${esc(p.title)}</div>
            ${p.excerpt ? `<div class="subtitle" style="font-size:13px">${esc(p.excerpt).slice(0, 80)}${p.excerpt.length > 80 ? '…' : ''}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>` : ''}

    ${(state.courses || []).length ? `<div class="section"><div class="card promo-card" style="border-color:var(--gold, #b08d57)"><div class="eyebrow">BLACK ROCOCO ACADEMY</div><div class="title" style="font-size:22px;margin:6px 0">Cursos y talleres profesionales</div><div class="subtitle">Certifícate en poligel, manicure ruso y más.</div><button class="btn btn-outline" style="margin-top:14px" data-tab="academia">VER CURSOS</button></div></div>` : ''}

    <!-- 5. MAP -->
    <div class="section map-section">
      <div class="section-head"><div class="title">Ubicación</div></div>
      <div class="map-address">
        <p>${esc(c.contact.address1)}${c.contact.address2 ? '<br>' + esc(c.contact.address2) : ''}</p>
        <p class="map-hours">${esc(c.contact.hours1)}${c.contact.hours2 ? ' · ' + esc(c.contact.hours2) : ''}</p>
      </div>
      ${mapsEmbedSrc ? `<div class="map-embed">
        <iframe
          src="${esc(mapsEmbedSrc)}"
          width="100%" height="300"
          style="border:0;border-radius:8px"
          allowfullscreen=""
          loading="lazy"
          referrerpolicy="no-referrer-when-downgrade"
          title="Black Rococo en Google Maps"
        ></iframe>
      </div>` : ''}
      <div class="map-actions">
        <a class="btn btn-outline btn-small" target="_blank" rel="noopener" href="${esc(c.contact.mapsUrl)}">ABRIR EN GOOGLE MAPS</a>
        <a class="btn btn-outline btn-small" target="_blank" rel="noopener" href="${esc(whatsappChatUrl())}">CONTACTAR POR WHATSAPP</a>
      </div>
    </div>

    <!-- 6. SOCIAL -->
    <div class="section social-section">
      <div class="social-eyebrow">SÍGUENOS</div>
      <div class="social-icons-row">
        ${socialLinks.map(l => `<a class="social-icon-link" href="${esc(l.url)}" target="_blank" rel="noopener" aria-label="${esc(l.name)}">${l.icon}<span class="social-icon-label">${esc(l.name)}</span></a>`).join('')}
      </div>
    </div>

    <!-- 7. FOOTER -->
    <div class="footer">${esc(c.brand.footer)}</div>
    ${bottomNav()}
  </section>`;
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
  // Logged-in clients: their WhatsApp is already on file — prefill the
  // rebook lookup so "reserve again" is a single tap.
  if (state.clientAuth.loggedIn && !rb.whatsapp && state.clientAuth.whatsapp) {
    rb.whatsapp = state.clientAuth.whatsapp;
  }
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
  const ca = state.clientAuth;
  // Auto-fill from logged-in account if fields are empty
  if (ca.loggedIn && !b.name && ca.displayName) b.name = ca.displayName;
  if (ca.loggedIn && !b.whatsapp && ca.whatsapp) b.whatsapp = ca.whatsapp;
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
  const a = data?.appointment;
  // Defensive: if the response shape is ever wrong, degrade gracefully
  // instead of throwing inside render() and blanking the entire app.
  if (!a) {
    return `<section class="screen">
      <div class="success">
        <div>
          <div class="check">✓</div>
          <div class="eyebrow">CITA APARTADA</div>
          <p class="subtitle">Tu cita fue registrada. Te contactaremos por WhatsApp para confirmar.</p>
          <button class="btn btn-outline" data-reset-booking>AGENDAR OTRA CITA</button>
        </div>
      </div>
    </section>`;
  }
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
        ${!state.clientAuth.loggedIn ? `<div class="card" style="margin-top:18px;text-align:center">
          <div class="eyebrow">💅 GUARDA TU HISTORIAL</div>
          <div class="subtitle" style="margin:6px 0 12px">Crea tu cuenta para ver tus citas y reservar más rápido la próxima vez.</div>
          <button class="btn btn-outline btn-small" data-tab="mi-cuenta">CREAR MI CUENTA</button>
        </div>` : ''}
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
  // Deep link: /academia/curso-slug pre-selects that course's inscription form.
  if (ac.focusSlug && !ac.selectedCourseId) {
    const focused = courses.find(c => clientCourseSlug(c) === ac.focusSlug || c.id === ac.focusSlug);
    if (focused) ac.selectedCourseId = focused.id;
    ac.focusSlug = null;
  }
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

// =========================================================================
// BLOG SCREEN — public, no login required
// =========================================================================
function blogScreen() {
  // Detail view
  if (state.blogDetail) {
    const p = state.blogDetail;
    const dateStr = new Date(p.createdAt).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
    return `<section class="screen blog-screen">
      ${brandHeader()}
      <div class="section">
        <button class="pill-button" data-blog-back>← VOLVER AL BLOG</button>
      </div>
      ${p.coverImageUrl ? `<div class="blog-cover"><img src="${esc(p.coverImageUrl)}" alt="${esc(p.title)}" loading="lazy"></div>` : ''}
      <div class="section">
        <div class="blog-detail-header">
          <div class="eyebrow">${esc(p.author)} · ${esc(dateStr)}</div>
          <h1 class="title" style="font-size:24px;margin:8px 0 10px">${esc(p.title)}</h1>
          ${p.tags.length ? `<div class="blog-tags">${p.tags.map(t => `<span class="blog-tag">${esc(t)}</span>`).join('')}</div>` : ''}
        </div>
        <div class="blog-body">${formatBlogBody(p.body)}</div>
      </div>
      ${bottomNav()}
    </section>`;
  }

  // Listing view
  const posts = state.blogPosts || [];
  return `<section class="screen blog-screen">
    ${brandHeader()}
    <div class="page-header"><div class="title">Blog</div><div class="subtitle">Artículos de cuidado, tendencias y más.</div></div>
    ${posts.length === 0 ? `<div class="section"><div class="card" style="text-align:center"><div class="subtitle">Próximamente.</div></div></div>` : ''}
    <div class="blog-list">
      ${posts.map(p => {
        const dateStr = new Date(p.createdAt).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
        return `<div class="section"><div class="card blog-card" data-blog-open="${esc(p.slug || p.id)}">
          ${p.coverImageUrl ? `<div class="blog-card-cover"><img src="${esc(p.coverImageUrl)}" alt="${esc(p.title)}" loading="lazy"></div>` : ''}
          <div class="blog-card-body">
            <div class="eyebrow">${esc(p.author)} · ${esc(dateStr)}</div>
            <div class="title" style="font-size:18px;margin:6px 0">${esc(p.title)}</div>
            ${p.excerpt ? `<div class="subtitle" style="margin-top:6px">${esc(p.excerpt)}</div>` : ''}
            ${p.tags.length ? `<div class="blog-tags">${p.tags.map(t => `<span class="blog-tag">${esc(t)}</span>`).join('')}</div>` : ''}
          </div>
        </div></div>`;
      }).join('')}
    </div>
    ${bottomNav()}
  </section>`;
}

// =========================================================================
// MI CUENTA SCREEN — login/register/account with guest option
// =========================================================================
function miCuentaScreen() {
  const ca = state.clientAuth;

  if (ca.loggedIn) {
    // Load appointments on first visit
    if (!ca.appointmentsLoaded) loadClientAppointments();

    const today = todayLocal();
    const upcoming = ca.appointments
      .filter(a => a.date >= today && a.status !== 'cancelled')
      .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
    const past = ca.appointments.filter(a => a.date < today || a.status === 'cancelled');
    const completed = past.filter(a => a.status === 'completed');
    const nextAppt = upcoming[0];
    const lastService = completed[0] || past[0];

    const daysUntil = nextAppt
      ? Math.round((new Date(`${nextAppt.date}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000)
      : null;
    const countdownLabel = daysUntil === 0 ? '¡HOY!' : daysUntil === 1 ? 'MAÑANA' : `EN ${daysUntil} DÍAS`;

    return `<section class="screen mi-cuenta-screen">
      ${brandHeader()}
      <div class="section">
        <div class="profile-hero">
          <div class="profile-avatar">${esc((ca.displayName || '?').trim().charAt(0).toUpperCase())}</div>
          <div class="profile-hero-info">
            <div class="title" style="font-size:20px">Hola, ${esc(ca.displayName.split(' ')[0])}</div>
            <div class="subtitle" style="font-size:12px">${esc(ca.whatsapp)}</div>
          </div>
          <button class="pill-button" data-client-logout>SALIR</button>
        </div>
      </div>

      ${nextAppt ? `<div class="section">
        <div class="card next-appt-card">
          <div class="next-appt-badge">${esc(countdownLabel)}</div>
          <div class="eyebrow">TU PRÓXIMA CITA</div>
          <div class="title" style="font-size:19px;margin:6px 0">${esc(nextAppt.serviceName || '')}</div>
          <div class="next-appt-when">${esc(formatDate(nextAppt.date))} · ${esc(nextAppt.time)}</div>
          <span class="status-badge status-${esc(nextAppt.status)}" style="margin-top:10px">${esc(statusLabel(nextAppt.status))}</span>
        </div>
      </div>` : `<div class="section">
        <div class="card" style="text-align:center">
          <div class="subtitle" style="margin-bottom:12px">No tienes citas próximas.</div>
          <button class="btn btn-primary" data-tab="reservar">RESERVAR CITA</button>
        </div>
      </div>`}

      ${lastService && lastService.serviceId ? `<div class="section-tight">
        <button class="card rebook-card" data-book="${esc(lastService.serviceId)}">
          <span class="rebook-icon">↻</span>
          <span class="rebook-text"><strong>Repetir mi último servicio</strong><br><span class="subtitle" style="font-size:12px">${esc(lastService.serviceName || '')}</span></span>
          <span class="rebook-arrow">→</span>
        </button>
      </div>` : ''}

      <div class="section-tight">
        <div class="profile-stats">
          <div class="profile-stat"><div class="stat-num">${completed.length}</div><div class="stat-label">VISITAS</div></div>
          <div class="profile-stat"><div class="stat-num">${upcoming.length}</div><div class="stat-label">PRÓXIMAS</div></div>
          <div class="profile-stat"><div class="stat-num">${ca.appointments.length}</div><div class="stat-label">TOTAL</div></div>
        </div>
      </div>

      ${upcoming.length > 1 ? `<div class="section">
        <div class="section-head"><div class="title">Más citas próximas</div></div>
        <div class="card-list">
          ${upcoming.slice(1).map(a => `<div class="card appt-card">
            <div class="appt-main">
              <div>
                <div class="eyebrow">${esc(a.date)} · ${esc(a.time)}</div>
                <div class="title" style="font-size:16px">${esc(a.serviceName || '')}</div>
              </div>
              <span class="status-badge status-${esc(a.status)}">${esc(statusLabel(a.status))}</span>
            </div>
          </div>`).join('')}
        </div>
      </div>` : ''}

      <div class="section">
        <div class="section-head"><div class="title">Historial</div></div>
        ${past.length === 0 ? `<div class="card" style="text-align:center"><div class="subtitle">Aún no tienes citas pasadas.</div></div>` : ''}
        <div class="card-list">
          ${past.slice(0, 20).map(a => `<div class="card appt-card past">
            <div class="appt-main">
              <div>
                <div class="eyebrow">${esc(a.date)} · ${esc(a.time)}</div>
                <div class="title" style="font-size:16px">${esc(a.serviceName || '')}</div>
              </div>
              <span class="status-badge status-${esc(a.status)}">${esc(statusLabel(a.status))}</span>
            </div>
          </div>`).join('')}
        </div>
      </div>
      ${bottomNav()}
    </section>`;
  }

  // Not logged in — show options
  const form = ca.showForm;
  return `<section class="screen mi-cuenta-screen">
    ${brandHeader()}
    <div class="page-header"><div class="title">Tu Cuenta</div></div>

    ${form === '' ? `<div class="section">
      <div class="card" style="text-align:center">
        <div class="title" style="font-size:20px;margin-bottom:8px">Accede a tu cuenta</div>
        <div class="subtitle" style="margin-bottom:18px">Inicia sesión o regístrate para ver tus citas y tu historial. También puedes continuar como invitada.</div>
        <button class="btn btn-primary" data-show-client-form="login">INICIAR SESIÓN</button>
        <button class="btn btn-outline" style="margin-top:10px" data-show-client-form="register">CREAR CUENTA</button>
        <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px">
          <button class="pill-button" data-tab="reservar">CONTINUAR COMO INVITADA →</button>
        </div>
      </div>
    </div>` : ''}

    ${form === 'login' ? `<div class="section">
      <div class="card">
        <div class="title" style="font-size:20px;margin-bottom:14px">Iniciar sesión</div>
        ${ca.error ? `<div class="error-box">${esc(ca.error)}</div>` : ''}
        <div class="form-field"><label>WhatsApp</label><input data-client-auth-field="loginWhatsapp" value="${esc(ca.loginWhatsapp)}" inputmode="tel" placeholder="33 0000 0000"></div>
        <div class="form-field"><label>Contraseña</label><input type="password" data-client-auth-field="loginPassword" value="${esc(ca.loginPassword)}" placeholder="Tu contraseña"></div>
        <button class="btn btn-primary" data-client-login ${ca.loading ? 'disabled' : ''}>${ca.loading ? 'ENTRANDO...' : 'ENTRAR'}</button>
        <div style="margin-top:14px;text-align:center">
          <button class="pill-button" data-show-client-form="register">¿No tienes cuenta? Regístrate</button>
        </div>
        <div style="margin-top:8px;text-align:center">
          <button class="pill-button" data-show-client-form="">← Volver</button>
        </div>
      </div>
    </div>` : ''}

    ${form === 'register' ? `<div class="section">
      <div class="card">
        <div class="title" style="font-size:20px;margin-bottom:14px">Crear cuenta</div>
        ${ca.error ? `<div class="error-box">${esc(ca.error)}</div>` : ''}
        <div class="form-field"><label>Nombre</label><input data-client-auth-field="regName" value="${esc(ca.regName)}" placeholder="Tu nombre"></div>
        <div class="form-field"><label>WhatsApp</label><input data-client-auth-field="regWhatsapp" value="${esc(ca.regWhatsapp)}" inputmode="tel" placeholder="33 0000 0000"></div>
        <div class="form-field"><label>Email (opcional)</label><input type="email" data-client-auth-field="regEmail" value="${esc(ca.regEmail)}" placeholder="tu@email.com"></div>
        <div class="form-field"><label>Contraseña (mín. 6 caracteres)</label><input type="password" data-client-auth-field="regPassword" value="${esc(ca.regPassword)}" placeholder="Tu contraseña"></div>
        <div class="subtitle" style="font-size:11px;margin:4px 0 12px;color:var(--muted)">Te enviaremos un código de verificación por WhatsApp para confirmar tu número.</div>
        <button class="btn btn-primary" data-client-send-otp>VERIFICAR MI WHATSAPP</button>
        <div style="margin-top:14px;text-align:center">
          <button class="pill-button" data-show-client-form="login">¿Ya tienes cuenta? Inicia sesión</button>
        </div>
        <div style="margin-top:8px;text-align:center">
          <button class="pill-button" data-show-client-form="">← Volver</button>
        </div>
      </div>
    </div>` : ''}

    ${form === 'verify' ? `<div class="section">
      <div class="card">
        <div class="title" style="font-size:20px;margin-bottom:10px">Verificar WhatsApp</div>
        <div class="subtitle" style="margin-bottom:14px">Acabamos de abrir WhatsApp con tu código. Envía el mensaje y luego escribe el código de 6 dígitos aquí:</div>
        ${ca.error ? `<div class="error-box">${esc(ca.error)}</div>` : ''}
        <div class="form-field"><label>Código de verificación</label><input data-client-auth-field="otpCode" value="${esc(ca.otpCode)}" inputmode="numeric" maxlength="6" placeholder="000000" style="text-align:center;font-size:24px;letter-spacing:8px"></div>
        <button class="btn btn-primary" data-client-verify-otp ${ca.loading ? 'disabled' : ''}>${ca.loading ? 'VERIFICANDO...' : 'VERIFICAR Y CREAR CUENTA'}</button>
        <div style="margin-top:14px;text-align:center">
          <button class="pill-button" data-client-resend-otp>REENVIAR CÓDIGO</button>
        </div>
        <div style="margin-top:8px;text-align:center">
          <button class="pill-button" data-show-client-form="register">← Cambiar datos</button>
        </div>
      </div>
    </div>` : ''}

    ${bottomNav()}
  </section>`;
}

function statusLabel(s) {
  return { new: 'NUEVA', confirmed: 'CONFIRMADA', in_progress: 'EN CURSO', completed: 'COMPLETADA', cancelled: 'CANCELADA' }[s] || s;
}

// =========================================================================
// CHAT — visitor widget (floating button + slide-up panel)
// =========================================================================
function chatWidget() {
  const ch = state.chat;
  if (!ch.open) {
    const unread = ch.messages.filter(m => m.sender === 'admin' && !m.readByClient).length;
    return `<button class="chat-fab" data-chat-toggle aria-label="Chatear con nosotros">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>
      ${unread ? `<span class="chat-fab-badge">${unread}</span>` : ''}
    </button>`;
  }
  return `<div class="chat-panel">
    <div class="chat-head">
      <div>
        <div class="chat-title">Black Rococo</div>
        <div class="chat-sub">Te respondemos lo antes posible 💅</div>
      </div>
      <button class="topbar-icon" data-chat-toggle aria-label="Cerrar chat">✕</button>
    </div>
    <div class="chat-messages">
      ${ch.messages.length === 0 ? `<div class="chat-empty">¡Hola! Escríbenos y te ayudamos con tu cita, precios o cualquier duda.</div>` : ''}
      ${ch.messages.map(m => `<div class="chat-msg ${m.sender === 'client' ? 'mine' : 'theirs'}">
        <div class="chat-bubble">${m.imageUrl ? `<img class="chat-img" src="${esc(m.imageUrl)}" alt="Imagen adjunta" loading="lazy" data-chat-img>` : ''}${m.text ? `<div>${linkifyEsc(m.text)}</div>` : ''}</div>
        <div class="chat-time">${esc(new Date(m.createdAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }))}</div>
      </div>`).join('')}
    </div>
    <div class="chat-input-row">
      <button class="chat-attach" data-chat-attach aria-label="Adjuntar imagen" title="Adjuntar imagen">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
      </button>
      <input type="file" accept="image/*" data-chat-file hidden>
      <input class="chat-input" data-chat-draft value="${esc(ch.draft)}" placeholder="Escribe tu mensaje..." maxlength="2000">
      <button class="chat-send" data-chat-send ${ch.sending ? 'disabled' : ''} aria-label="Enviar">➤</button>
    </div>
  </div>`;
}

// =========================================================================
// CHAT — admin toast popup (new incoming message)
// =========================================================================
function adminChatToast() {
  const t = state.adminChat.toast;
  return `<div class="admin-chat-toast" data-open-chat-thread="${esc(t.threadId)}">
    <div class="toast-icon">💬</div>
    <div class="toast-body">
      <strong>${t.newThread ? 'Nuevo chat' : 'Nuevo mensaje'}</strong><br>
      <span>${esc(t.name)} te escribió — toca para responder</span>
    </div>
  </div>`;
}

// =========================================================================
// CHAT — admin panel tab
// =========================================================================
function adminChatScreen() {
  const ac = state.adminChat;
  const active = ac.activeThreadId;

  if (active) {
    const thread = ac.threads.find(t => t.threadId === active);
    return `<div class="section">
      <div class="section-head compact-head">
        <div class="title">💬 ${esc(thread?.name || 'Conversación')}</div>
        <button class="pill-button" data-close-chat-thread>← TODAS</button>
      </div>
      <div class="card admin-chat-card">
        <div class="chat-messages admin-chat-messages">
          ${ac.messages.map(m => `<div class="chat-msg ${m.sender === 'admin' ? 'mine' : 'theirs'}">
            <div class="chat-bubble">${m.imageUrl ? `<img class="chat-img" src="${esc(m.imageUrl)}" alt="Imagen adjunta" loading="lazy" data-chat-img>` : ''}${m.text ? `<div>${linkifyEsc(m.text)}</div>` : ''}</div>
            <div class="chat-time">${esc(m.name)} · ${esc(new Date(m.createdAt).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</div>
          </div>`).join('')}
        </div>
        <div class="chat-input-row">
          <button class="chat-attach" data-admin-chat-attach aria-label="Adjuntar imagen" title="Adjuntar imagen">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
          </button>
          <input type="file" accept="image/*" data-admin-chat-file hidden>
          <input class="chat-input" data-admin-chat-draft value="${esc(ac.draft)}" placeholder="Responder..." maxlength="2000">
          <button class="chat-send" data-admin-chat-send aria-label="Enviar">➤</button>
        </div>
      </div>
    </div>`;
  }

  return `<div class="section">
    <div class="section-head compact-head">
      <div class="title">Chats${ac.totalUnread ? ` (${ac.totalUnread} sin leer)` : ''}</div>
      <button class="pill-button" data-refresh-chats>ACTUALIZAR</button>
    </div>
    ${ac.threads.length === 0 ? '<div class="card" style="text-align:center"><div class="subtitle">Aún no hay conversaciones. Cuando una clienta te escriba desde el sitio, aparecerá aquí.</div></div>' : ''}
    <div class="card-list">
      ${ac.threads.map(t => `<button class="card chat-thread-row ${t.unread ? 'has-unread' : ''}" data-open-chat-thread="${esc(t.threadId)}">
        <div class="chat-thread-main">
          <div class="chat-thread-name">${esc(t.name)}${t.unread ? `<span class="chat-unread-badge">${t.unread}</span>` : ''}</div>
          <div class="chat-thread-last">${t.lastSender === 'admin' ? 'Tú: ' : ''}${esc(t.lastText.slice(0, 60))}${t.lastText.length > 60 ? '…' : ''}</div>
        </div>
        <div class="chat-thread-time">${esc(new Date(t.lastAt).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</div>
      </button>`).join('')}
    </div>
  </div>`;
}

function bottomNav() {
  const tabs = [
    ['inicio', 'INICIO'],
    ['servicios', 'SERVICIOS'],
    ['reservar', 'RESERVAR'],
    ['academia', 'ACADEMIA'],
    ['galeria', 'GALERÍA'],
    ['blog', 'BLOG']
  ];
  return `<a class="wa-float" target="_blank" rel="noopener" href="${esc(whatsappChatUrl())}" aria-label="Chatear por WhatsApp">WhatsApp</a><nav class="bottom-nav">${tabs.map(([id, label]) => `<button class="bottom-tab ${state.tab === id ? 'active' : ''}" data-tab="${id}"><span>${label}</span><span class="nav-dot"></span></button>`).join('')}</nav>`;
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
      ${[['agenda','AGENDA'],['chat',`CHAT${state.adminChat.totalUnread ? ` (${state.adminChat.totalUnread})` : ''}`],['notificaciones',`NOTIFICACIONES${data?.unreadNotifications ? ` (${data.unreadNotifications})` : ''}`],['servicios','SERVICIOS'],['promociones','PROMOCIONES'],['clientas','CLIENTAS'],['equipo','EQUIPO'],['academia','ACADEMIA'],['galeria','GALERÍA'],['blog','BLOG'],['publicar','PUBLICAR'],['integraciones','INTEGRACIONES'],['configuracion','CONFIGURACIÓN']].map(([id,label]) => `<button class="pill-button ${state.admin.tab === id ? 'active' : ''}" data-admin-tab="${id}">${label}</button>`).join('')}
    </div>
    ${state.admin.error ? `<div class="error-box">${esc(state.admin.error)}</div>` : ''}
    ${state.admin.tab === 'agenda' ? adminAgenda(data) : ''}
    ${state.admin.tab === 'chat' ? adminChatScreen() : ''}
    ${state.admin.tab === 'notificaciones' ? adminNotifications(data) : ''}
    ${state.admin.tab === 'servicios' ? adminServices(data) : ''}
    ${state.admin.tab === 'promociones' ? adminPromotions(data) : ''}
    ${state.admin.tab === 'clientas' ? adminClients(data) : ''}
    ${state.admin.tab === 'equipo' ? adminStaff(data) : ''}
    ${state.admin.tab === 'academia' ? adminAcademia(data) : ''}
    ${state.admin.tab === 'galeria' ? adminGallery(data) : ''}
    ${state.admin.tab === 'blog' ? adminBlog(data) : ''}
    ${state.admin.tab === 'publicar' ? adminPublish(data) : ''}
    ${state.admin.tab === 'integraciones' ? adminIntegrations() : ''}
    ${state.admin.tab === 'configuracion' ? adminConfiguracion(data) : ''}
  </section>`;
}

function adminBlog(data) {
  const blogs = data?.blogPosts || [];
  const editing = state.blogAdmin.editingId;
  const editPost = editing && editing !== '__new__' ? blogs.find(b => b.id === editing) : null;
  const isNew = editing === '__new__';
  const blocks = state.blogAdmin.blocks || [];

  if (editing) {
    return `<div class="section">
      <div class="section-head compact-head">
        <div class="title">${isNew ? 'Nueva Entrada' : 'Editar Entrada'}</div>
        <button class="pill-button" data-cancel-blog-edit>CANCELAR</button>
      </div>
      <form data-blog-form class="card">
        <div class="form-field"><label>Título</label><input name="title" value="${esc(editPost?.title || '')}" placeholder="Título del artículo" required></div>
        <div class="form-field"><label>Extracto / Resumen</label><textarea name="excerpt" rows="2" placeholder="Breve descripción para listado...">${esc(editPost?.excerpt || '')}</textarea></div>

        <div class="form-field"><label>Imagen de portada</label>
          ${state.blogAdmin.coverImageDraft || editPost?.coverImageUrl ? `<div class="admin-thumb-row"><img src="${esc(state.blogAdmin.coverImageDraft || editPost?.coverImageUrl || '')}" style="width:100%;max-height:180px;object-fit:cover;border-radius:8px"><button type="button" class="pill-button" data-remove-blog-cover>QUITAR</button></div>` : ''}
          <input type="file" accept="image/*" data-blog-cover-input>
          <input type="hidden" name="coverImageUrl" value="${esc(state.blogAdmin.coverImageDraft || editPost?.coverImageUrl || '')}">
          ${state.blogAdmin.coverUploading ? '<div class="subtitle">Subiendo imagen...</div>' : ''}
        </div>

        <div class="form-field"><label>CONTENIDO DEL ARTÍCULO</label>
          <div class="subtitle" style="margin:-4px 0 8px;font-size:11px">Agrega bloques de texto e imágenes. Las imágenes aparecerán exactamente donde las coloques.</div>
        </div>

        <div class="blog-blocks-editor">
          ${blocks.map((block, i) => {
            if (block.type === 'text') {
              return `<div class="blog-block blog-block-text" data-block-index="${i}">
                <div class="blog-block-head"><span class="eyebrow">TEXTO</span><div class="pill-row"><button type="button" class="pill-button" data-blog-block-move-up="${i}" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" class="pill-button" data-blog-block-move-down="${i}" ${i === blocks.length - 1 ? 'disabled' : ''}>↓</button><button type="button" class="pill-button" data-blog-block-remove="${i}">✕</button></div></div>
                <textarea rows="6" data-blog-block-text="${i}" placeholder="Escribe el contenido... Puedes usar HTML: <p>, <h2>, <h3>, <ul>, <strong>, <em>">${esc(block.content)}</textarea>
              </div>`;
            }
            if (block.type === 'image') {
              return `<div class="blog-block blog-block-image" data-block-index="${i}">
                <div class="blog-block-head"><span class="eyebrow">IMAGEN</span><div class="pill-row"><button type="button" class="pill-button" data-blog-block-move-up="${i}" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" class="pill-button" data-blog-block-move-down="${i}" ${i === blocks.length - 1 ? 'disabled' : ''}>↓</button><button type="button" class="pill-button" data-blog-block-remove="${i}">✕</button></div></div>
                ${block.url ? `<img src="${esc(block.url)}" style="width:100%;max-height:220px;object-fit:cover;border-radius:8px;margin-bottom:8px">` : ''}
                ${state.blogAdmin.blockUploading === i ? '<div class="subtitle">Subiendo imagen...</div>' : ''}
                ${!block.url ? `<input type="file" accept="image/*" data-blog-block-image-input="${i}">` : ''}
                <input placeholder="Pie de foto (opcional)" value="${esc(block.caption || '')}" data-blog-block-caption="${i}" style="margin-top:6px">
              </div>`;
            }
            return '';
          }).join('')}
        </div>

        <div class="pill-row" style="margin:12px 0 16px;justify-content:center">
          <button type="button" class="pill-button" data-blog-add-block="text">+ TEXTO</button>
          <button type="button" class="pill-button" data-blog-add-block="image">+ IMAGEN</button>
        </div>

        <div class="form-field"><label>Etiquetas (separadas por coma)</label><input name="tags" value="${esc((editPost?.tags || []).join(', '))}" placeholder="tendencias, manicure, tips"></div>
        <div class="form-field"><label>Autor</label><input name="author" value="${esc(editPost?.author || 'Black Rococo')}" placeholder="Black Rococo"></div>
        <div class="form-field" style="flex-direction:row;align-items:center;gap:8px">
          <input type="checkbox" name="published" id="blog-published" ${editPost?.published ? 'checked' : ''}>
          <label for="blog-published" style="font-size:13px;letter-spacing:0">Publicar inmediatamente</label>
        </div>
        <button class="btn btn-primary" type="submit">${isNew ? 'CREAR ENTRADA' : 'GUARDAR CAMBIOS'}</button>
      </form>
    </div>`;
  }

  return `<div class="section">
    <div class="section-head compact-head">
      <div class="title">Blog (${blogs.length})</div>
      <button class="pill-button" data-new-blog>+ NUEVA ENTRADA</button>
    </div>
    ${blogs.length === 0 ? '<div class="card" style="text-align:center"><div class="subtitle">No hay entradas de blog aún.</div></div>' : ''}
    <div class="card-list">
      ${blogs.map(b => {
        const dateStr = new Date(b.createdAt).toLocaleDateString('es-MX', { month: 'short', day: 'numeric', year: 'numeric' });
        return `<div class="card">
          <div class="appt-main">
            <div style="flex:1;min-width:0">
              <div class="eyebrow">${b.published ? '🟢 PUBLICADO' : '⚪ BORRADOR'} · ${esc(dateStr)}</div>
              <div class="title" style="font-size:15px">${esc(b.title)}</div>
              ${b.excerpt ? `<div class="subtitle" style="margin-top:4px;font-size:12px">${esc(b.excerpt).slice(0, 100)}</div>` : ''}
            </div>
            <div class="pill-row" style="flex-shrink:0">
              <button class="pill-button" data-edit-blog="${esc(b.id)}">EDITAR</button>
              <button class="pill-button" data-toggle-blog-publish="${esc(b.id)}" data-published="${b.published ? '1' : '0'}">${b.published ? 'DESPUBLICAR' : 'PUBLICAR'}</button>
              <button class="pill-button" data-delete-blog="${esc(b.id)}">ELIMINAR</button>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
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
  if (view === 'monthly') return adminAgendaMonthly(data) + manualBookingForm;

  // Daily calendar grid view
  const timeSlots = times.length ? times : ['09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00'];
  const apptMap = {};
  list.forEach(a => { apptMap[a.time] = a; });

  return `<div class="agenda-controls">
    <div class="pill-row">
      <button class="pill-button ${view === 'daily' ? 'active' : ''}" data-agenda-view="daily">DÍA</button>
      <button class="pill-button ${view === 'weekly' ? 'active' : ''}" data-agenda-view="weekly">SEMANA</button>
      <button class="pill-button ${view === 'monthly' ? 'active' : ''}" data-agenda-view="monthly">MES</button>
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
      <button class="pill-button ${(state.admin.agendaView||'daily') === 'monthly' ? 'active' : ''}" data-agenda-view="monthly">MES</button>
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

function adminAgendaMonthly(data) {
  const offset = state.admin.monthOffset || 0;
  const base = new Date();
  const first = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const monthName = first.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  const appts = state.admin.monthlyAppointments || [];
  const byDay = {};
  appts.forEach(a => { (byDay[a.date] = byDay[a.date] || []).push(a); });

  // Monday-start grid: leading blanks before day 1.
  const lead = (first.getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= last.getDate(); d++) {
    cells.push(new Date(first.getFullYear(), first.getMonth(), d));
  }
  while (cells.length % 7) cells.push(null);
  const today = todayLocal();
  const dayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  return `<div class="agenda-controls">
    <div class="pill-row">
      <button class="pill-button" data-agenda-view="daily">DÍA</button>
      <button class="pill-button" data-agenda-view="weekly">SEMANA</button>
      <button class="pill-button active" data-agenda-view="monthly">MES</button>
    </div>
    <button class="btn btn-primary btn-small" data-open-manual-booking>+ NUEVA CITA</button>
  </div>
  <div class="month-nav">
    <button class="pill-button" data-month-nav="-1">‹ ANTERIOR</button>
    <div class="month-title">${esc(monthName.charAt(0).toUpperCase() + monthName.slice(1))}</div>
    <button class="pill-button" data-month-nav="1">SIGUIENTE ›</button>
  </div>
  <div class="month-grid">
    ${dayNames.map(n => `<div class="mg-header">${n}</div>`).join('')}
    ${cells.map(d => {
      if (!d) return `<div class="mg-cell mg-blank"></div>`;
      const ymd = ymdLocal(d);
      const dayAppts = (byDay[ymd] || []).filter(a => a.status !== 'cancelled');
      const isToday = ymd === today;
      return `<div class="mg-cell ${isToday ? 'mg-today' : ''} ${dayAppts.length ? 'mg-has-appts' : ''}">
        <div class="mg-daynum">${d.getDate()}</div>
        ${dayAppts.length ? `<div class="mg-count">${dayAppts.length} cita${dayAppts.length > 1 ? 's' : ''}</div>
        <div class="mg-names">${dayAppts.slice(0, 2).map(a => `<span>${esc(a.time)} ${esc((a.clientName || '').split(' ')[0])}</span>`).join('')}${dayAppts.length > 2 ? `<span class="mg-more">+${dayAppts.length - 2} más</span>` : ''}</div>` : ''}
      </div>`;
    }).join('')}
  </div>`;
}


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
      ${s.imageUrl ? `<div class="admin-thumb-row" style="margin-top:8px">${(s.imageUrls?.length ? s.imageUrls : [s.imageUrl]).filter(Boolean).map(url => `<img src="${esc(url)}" alt="" class="admin-thumb">`).join('')}</div>` : ''}
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
        ${draftImages.length ? `<div class="admin-thumb-row">${draftImages.map((url, i) => `<div class="admin-thumb-wrap"><img src="${esc(url)}" alt="" class="admin-thumb"><button type="button" class="thumb-remove" data-remove-course-image="${i}" aria-label="Quitar foto">✕</button></div>`).join('')}</div>` : `<div class="service-meta" style="margin-top:6px">Sin fotos todavía.</div>`}
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
      ${c.imageUrls && c.imageUrls.length ? `<div class="admin-thumb-row">${c.imageUrls.map(url => `<img src="${esc(url)}" alt="" class="admin-thumb">`).join('')}</div>` : ''}
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
            : `<img src="${esc(draft.url)}" alt="" class="admin-thumb">`}
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
          ${m.kind === 'video' ? `<video src="${esc(m.url)}" class="admin-thumb" muted loop playsinline></video>` : `<img src="${esc(m.url)}" alt="" class="admin-thumb">`}
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
        <img src="${esc(p.url)}" alt="" data-client-photo-view="${esc(p.id)}">
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
        <img src="${esc(url)}" alt="" class="admin-thumb">
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

function adminConfiguracion(data) {
  const cfg = state.admin.configDraft || state.salonConfig || {};
  const brand = state.config?.brand || {};
  const contact = state.config?.contact || {};
  const booking = state.config?.booking || {};
  const saving = state.admin.configSaving;
  // Hero images are edited live against state.salonConfig (single source of truth).
  // Rendering them from configDraft would desync them from the click/input handlers.
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
            : state.tab === 'blog'
              ? blogScreen()
              : state.tab === 'mi-cuenta'
                ? miCuentaScreen()
                : homeScreen();
  app.innerHTML = `${body}${state.mode !== 'admin' && state.serviceModalId ? serviceDetailModal() : ''}${state.lightbox ? lightboxOverlay() : ''}${state.mode !== 'admin' ? chatWidget() : ''}${state.mode === 'admin' && state.adminChat.toast ? adminChatToast() : ''}`;
  // render() replaced the DOM, so every carousel element is new. Re-arm the
  // shared ticker so freshly-rendered carousels start cycling from now, rather
  // than inheriting the phase of an interval that began before this render.
  startCarouselTicker();
  afterRender();
  // Lock body scroll when modal/lightbox/menu is open
  document.body.classList.toggle('modal-open', Boolean(state.serviceModalId || state.lightbox || state.menuOpen));
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
  // Backdrop click: close modal ONLY if the click landed on the backdrop
  // itself, not on anything inside the modal card.
  if (event.target.hasAttribute?.('data-modal-backdrop')) {
    state.serviceModalId = null;
    return render();
  }
  // Close buttons: use closest() because the ✕ glyph is a text node inside
  // the button — event.target.matches() misses it when the text is clicked.
  if (event.target.closest('[data-close-service-modal]')) {
    state.serviceModalId = null;
    return render();
  }
  if (event.target.closest('[data-close-lightbox]')) {
    return closeLightbox();
  }
  if (event.target.closest('[data-close-menu]') || event.target.classList?.contains('side-menu-overlay')) {
    state.menuOpen = false;
    return render();
  }
  const target = event.target.closest('button, a, label, [data-view-service], [data-open-lightbox], [data-blog-open], [data-open-chat-thread]');
  if (!target) return;

  // Visitor chat
  if (target.hasAttribute('data-chat-toggle')) {
    state.chat.open = !state.chat.open;
    if (state.chat.open && !state.chat.loaded) loadChatMessages();
    render();
    if (state.chat.open) scrollChatToBottom();
    return;
  }
  if (target.hasAttribute('data-chat-send')) return sendChatMessage();
  if (target.hasAttribute('data-chat-img')) {
    return openLightbox([{ url: target.src, kind: 'image', title: '' }], 0);
  }
  if (target.hasAttribute('data-chat-attach')) {
    const fi = document.querySelector('[data-chat-file]');
    if (fi) fi.click();
    return;
  }
  if (target.hasAttribute('data-admin-chat-attach')) {
    const fi = document.querySelector('[data-admin-chat-file]');
    if (fi) fi.click();
    return;
  }

  // Admin chat
  if (target.dataset.openChatThread) {
    state.adminChat.toast = null;
    state.mode = 'admin';
    state.admin.tab = 'chat';
    return openAdminThread(target.dataset.openChatThread);
  }
  if (target.hasAttribute('data-close-chat-thread')) {
    state.adminChat.activeThreadId = null;
    return render();
  }
  if (target.hasAttribute('data-admin-chat-send')) return sendAdminReply();
  if (target.hasAttribute('data-refresh-chats')) return loadAdminChats();

  if (target.hasAttribute('data-toggle-menu')) {
    state.menuOpen = !state.menuOpen;
    return render();
  }
  if (target.dataset.menuTab) {
    state.menuOpen = false;
    return goClient(target.dataset.menuTab);
  }

  // data-book-from-modal must be checked BEFORE data-view-service:
  // the RESERVAR button sits inside a card that may carry data-view-service,
  // and closest() would otherwise re-open the modal instead of booking.
  if (target.hasAttribute('data-book-from-modal')) {
    const id = target.getAttribute('data-book-from-modal');
    state.serviceModalId = null;
    return startBooking(id);
  }
  if (target.dataset.viewService) {
    state.serviceModalId = target.dataset.viewService;
    return render();
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

  // Client auth
  if (target.dataset.showClientForm !== undefined) {
    state.clientAuth.showForm = target.dataset.showClientForm;
    state.clientAuth.error = '';
    return render();
  }
  if (target.hasAttribute('data-client-login')) return clientLogin();
  if (target.hasAttribute('data-client-send-otp')) return sendOtpViaWhatsApp();
  if (target.hasAttribute('data-client-verify-otp')) return verifyOtpAndRegister();
  if (target.hasAttribute('data-client-resend-otp')) return sendOtpViaWhatsApp();
  if (target.hasAttribute('data-client-logout')) return clientLogout();

  // Blog (public)
  if (target.dataset.blogOpen || target.closest('[data-blog-open]')) {
    const id = target.dataset.blogOpen || target.closest('[data-blog-open]').dataset.blogOpen;
    return loadBlogDetail(id);
  }
  if (event.target.closest('[data-blog-back]')) {
    state.blogDetail = null;
    history.pushState({ tab: 'blog' }, '', '/blog');
    updatePageMeta();
    return render();
  }

  // Blog (admin)
  if (target.hasAttribute('data-new-blog')) {
    state.blogAdmin.editingId = '__new__';
    state.blogAdmin.coverImageDraft = '';
    state.blogAdmin.blocks = [{ type: 'text', content: '' }];
    return render();
  }
  if (target.dataset.editBlog) {
    state.blogAdmin.editingId = target.dataset.editBlog;
    const post = (state.admin.data?.blogPosts || []).find(b => b.id === target.dataset.editBlog);
    state.blogAdmin.coverImageDraft = post?.coverImageUrl || '';
    state.blogAdmin.blocks = htmlToBlocks(post?.body || '');
    return render();
  }
  if (target.hasAttribute('data-cancel-blog-edit')) {
    state.blogAdmin.editingId = null;
    state.blogAdmin.coverImageDraft = '';
    state.blogAdmin.blocks = [];
    return render();
  }
  if (target.dataset.deleteBlog) return deleteBlog(target.dataset.deleteBlog);
  if (target.dataset.toggleBlogPublish) return toggleBlogPublish(target.dataset.toggleBlogPublish, target.dataset.published === '1');
  if (target.hasAttribute('data-remove-blog-cover')) {
    state.blogAdmin.coverImageDraft = '';
    return render();
  }
  // Blog block editor controls
  if (target.dataset.blogAddBlock) {
    const type = target.dataset.blogAddBlock;
    state.blogAdmin.blocks.push(type === 'image' ? { type: 'image', url: '', caption: '' } : { type: 'text', content: '' });
    return render();
  }
  if (target.dataset.blogBlockRemove !== undefined) {
    state.blogAdmin.blocks.splice(Number(target.dataset.blogBlockRemove), 1);
    if (!state.blogAdmin.blocks.length) state.blogAdmin.blocks.push({ type: 'text', content: '' });
    return render();
  }
  if (target.dataset.blogBlockMoveUp !== undefined) {
    const i = Number(target.dataset.blogBlockMoveUp);
    if (i > 0) { const tmp = state.blogAdmin.blocks[i]; state.blogAdmin.blocks[i] = state.blogAdmin.blocks[i-1]; state.blogAdmin.blocks[i-1] = tmp; }
    return render();
  }
  if (target.dataset.blogBlockMoveDown !== undefined) {
    const i = Number(target.dataset.blogBlockMoveDown);
    if (i < state.blogAdmin.blocks.length - 1) { const tmp = state.blogAdmin.blocks[i]; state.blogAdmin.blocks[i] = state.blogAdmin.blocks[i+1]; state.blogAdmin.blocks[i+1] = tmp; }
    return render();
  }

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
    if (target.dataset.agendaView === 'monthly') { state.admin.monthOffset = 0; loadMonthlyAppointments(); }
    return render();
  }
  if (target.hasAttribute('data-month-nav')) {
    state.admin.monthOffset = (state.admin.monthOffset || 0) + Number(target.dataset.monthNav);
    return loadMonthlyAppointments();
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
  if (el.dataset.clientAuthField) state.clientAuth[el.dataset.clientAuthField] = el.value;
  if (el.hasAttribute('data-chat-draft')) state.chat.draft = el.value;
  if (el.hasAttribute('data-admin-chat-draft')) state.adminChat.draft = el.value;
  // Blog block editor text inputs
  if (el.dataset.blogBlockText !== undefined) {
    const i = Number(el.dataset.blogBlockText);
    if (state.blogAdmin.blocks[i]) state.blogAdmin.blocks[i].content = el.value;
  }
  if (el.dataset.blogBlockCaption !== undefined) {
    const i = Number(el.dataset.blogBlockCaption);
    if (state.blogAdmin.blocks[i]) state.blogAdmin.blocks[i].caption = el.value;
  }
  if (el.hasAttribute('data-rebook-whatsapp')) state.booking.rebook.whatsapp = el.value;
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
  // Chat image attachments (visitor + admin)
  if (el.hasAttribute('data-chat-file') && el.files?.[0]) {
    sendChatImage(el.files[0], false);
    el.value = '';
    return;
  }
  if (el.hasAttribute('data-admin-chat-file') && el.files?.[0]) {
    sendChatImage(el.files[0], true);
    el.value = '';
    return;
  }
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
  if (el.matches('[data-blog-cover-input]')) {
    const file = el.files?.[0];
    if (!file) return;
    const invalid = validateMediaFile(file);
    if (invalid) { state.admin.error = invalid; el.value = ''; return render(); }
    state.admin.error = '';
    state.blogAdmin.coverUploading = true;
    render();
    try {
      state.blogAdmin.coverImageDraft = await uploadAdminImage(file);
    } catch (err) {
      state.admin.error = `No se pudo subir la imagen: ${err.message}`;
    }
    state.blogAdmin.coverUploading = false;
    el.value = '';
    return render();
  }
  if (el.dataset.blogBlockImageInput !== undefined) {
    const idx = Number(el.dataset.blogBlockImageInput);
    const file = el.files?.[0];
    if (!file) return;
    const invalid = validateMediaFile(file);
    if (invalid) { state.admin.error = invalid; el.value = ''; return render(); }
    state.admin.error = '';
    state.blogAdmin.blockUploading = idx;
    render();
    try {
      const url = await uploadAdminImage(file);
      if (state.blogAdmin.blocks[idx]) state.blogAdmin.blocks[idx].url = url;
    } catch (err) {
      state.admin.error = `No se pudo subir la imagen: ${err.message}`;
    }
    state.blogAdmin.blockUploading = null;
    el.value = '';
    return render();
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
  // Always prevent default form submission to avoid page refresh
  event.preventDefault();
  if (event.target.matches('[data-staff-form]')) {
    event.preventDefault();
    return createOrUpdateStaff(event.target);
  }
  const blogForm = event.target.closest('[data-blog-form]');
  if (blogForm) {
    event.preventDefault();
    createOrUpdateBlog(blogForm);
    return;
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

window.addEventListener('hashchange', () => {
  setHashMode();
  if (state.mode === 'admin') checkAdmin().then(render);
  else render();
});

// Browser back/forward with path-based URLs.
window.addEventListener('popstate', () => {
  state.blogDetail = null;
  state.menuOpen = false;
  state.serviceModalId = null;
  setHashMode();
  updatePageMeta();
  render();
});

/* Paste an image from the clipboard directly into either chat.
   Works when the caret is in a chat input (screenshots, copied photos). */
document.addEventListener('paste', event => {
  const inChat = event.target.hasAttribute?.('data-chat-draft');
  const inAdminChat = event.target.hasAttribute?.('data-admin-chat-draft');
  if (!inChat && !inAdminChat) return;
  const items = event.clipboardData?.items || [];
  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      event.preventDefault();
      const file = item.getAsFile();
      if (file) sendChatImage(file, inAdminChat);
      return;
    }
  }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Enter' && event.target.hasAttribute?.('data-chat-draft')) {
    event.preventDefault();
    return sendChatMessage();
  }
  if (event.key === 'Enter' && event.target.hasAttribute?.('data-admin-chat-draft')) {
    event.preventDefault();
    return sendAdminReply();
  }
  if (event.key === 'Escape') {
    if (state.lightbox) return closeLightbox();
    if (state.serviceModalId) {
      state.serviceModalId = null;
      return render();
    }
    if (state.menuOpen) {
      state.menuOpen = false;
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

// =========================================================================
// REALTIME — SSE stream keeps every open tab in sync with admin changes.
// On any `data` event we silently re-fetch the public config (debounced) and
// re-render, preserving the user's current screen, scroll, modal and inputs
// where possible. `chat` events refresh the chat panes instantly.
// =========================================================================
let refetchTimer = null;
function scheduleLiveRefresh() {
  clearTimeout(refetchTimer);
  refetchTimer = setTimeout(async () => {
    try {
      const data = await api('/api/config');
      state.config = data.settings;
      state.salonConfig = data.salonConfig || state.salonConfig;
      state.staff = data.staff || [];
      state.services = data.services;
      state.groupedServices = data.groupedServices;
      state.promotions = data.promotions || [];
      state.courses = data.courses || [];
      state.media = data.media || state.media;
      state.blogPosts = data.blogPosts || [];
      // Never re-render mid-typing on the booking confirm step: a re-render
      // rebuilds inputs and would eat the user's keystrokes. Also never
      // re-render while the visitor chat panel or an admin chat thread is
      // open — those are patched in place and a full render would flash.
      const typing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
      const chatOpen = state.chat.open || (state.mode === 'admin' && state.adminChat.activeThreadId);
      if (!typing && !chatOpen) render();
      // Admin dashboard refreshes too, unless mid-edit.
      if (state.mode === 'admin' && state.admin.loggedIn && !typing && !chatOpen) {
        await loadAdminDashboard();
        render();
      }
    } catch (_) { /* transient network error; next event retries */ }
  }, 800);
}

function connectRealtime() {
  if (!window.EventSource) return; // very old browsers: no live sync, app still works
  const es = new EventSource('/api/events');
  es.addEventListener('data', scheduleLiveRefresh);
  es.addEventListener('chat', e => {
    let info = {};
    try { info = JSON.parse(e.data); } catch (_) {}
    // Visitor side: refresh the open chat thread (targeted patch).
    if (state.chat.open && info.from === 'admin') loadChatMessages();
    // Admin side: refresh chat list + active thread; popup on new messages.
    if (state.mode === 'admin' && state.admin.loggedIn && info.from === 'client') {
      loadAdminChats();
      // If the matching thread is currently open, refresh its messages too
      if (state.adminChat.activeThreadId && info.threadId === state.adminChat.activeThreadId) {
        (async () => {
          try {
            const data = await api(`/api/admin/chats/${encodeURIComponent(info.threadId)}`);
            state.adminChat.messages = data.messages || [];
            patchAdminChatMessages();
            scrollChatToBottom();
          } catch (_) {}
        })();
      }
      showAdminChatToast(info);
    }
  });
  // EventSource auto-reconnects on error; nothing to do.
}
connectRealtime();

// (Hero auto-advance now runs on the shared auto-carousel ticker above.)

// (The old hover-based image cycler was removed: it targeted `.service-thumb-multi`,
// a class the Story 7 card redesign renamed, so it had silently stopped working —
// and hover doesn't exist on a phone anyway. All carousels now run on the shared
// auto-carousel engine, which works on touch and desktop alike.)
