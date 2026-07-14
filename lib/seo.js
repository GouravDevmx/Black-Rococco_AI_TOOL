// ===========================================================================
// SEO — SERVER-SIDE RENDERED PAGES
//
// THE PROBLEM THIS SOLVES
//
// This app is a single-page application: `app.innerHTML = ...`. The HTML the
// server sent to a crawler was:
//
//     <main id="app"><div>Cargando Black Rococo…</div></main>
//
// No services. No prices. No gallery. No About text. Everything arrived later,
// via JavaScript.
//
// Worse, there was exactly ONE page. `/servicios`, `/manicura-rusa`, `/galeria`
// and every other path returned 200 with the SAME title tag — infinite URLs
// serving duplicate content, and no 404 at all.
//
// One page means one <title>, which means ONE keyword target. You cannot rank
// for "manicura rusa Guadalajara" AND "pedicure Guadalajara" from a single URL,
// no matter how good the meta tags are.
//
// THE FIX
//
// The server now renders a real page for each route: unique title, description,
// canonical, H1, real body copy, and route-specific structured data — with the
// service list, prices and descriptions read from the live database, so the
// content is never stale.
//
// Humans are unaffected. app.js boots and replaces #app on hydration exactly as
// before, so the interface does not change. The server-rendered content exists
// for crawlers and for the first paint.
// ===========================================================================

const { BUSINESS_TIME_ZONE } = require('./config');

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// "Manicure Ruso" -> "manicure-ruso". Stable, ASCII, hyphenated: what a URL
// should be. Accents are folded rather than percent-encoded, because
// /servicios/manicura-rusa reads and shares better than /servicios/manicura-rusa%CC%81.
function slugify(text) {
  return String(text || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// ---------------------------------------------------------------------------
// Static routes. Each is a genuinely distinct page with its own keyword target.
// Titles stay under ~60 chars and descriptions under ~155 so Google doesn't
// truncate them in the results page.
// ---------------------------------------------------------------------------
const STATIC_PAGES = {
  '/': {
    tab: 'inicio',
    title: 'Black Rococo | Manicura Rusa y Uñas Premium en Zapopan, Guadalajara',
    description: 'Estudio de uñas premium en Ciudad Granja, Zapopan. Especialistas en manicura rusa, poligel, rubber base y pedicure spa. Reserva tu cita por WhatsApp.',
    h1: 'Estudio de uñas premium en Zapopan, Guadalajara',
    keywords: 'manicura rusa guadalajara, salón de uñas zapopan, uñas premium guadalajara'
  },
  '/servicios': {
    tab: 'servicios',
    title: 'Servicios y Precios | Manicura Rusa, Poligel y Pedicure — Black Rococo',
    description: 'Lista completa de servicios y precios: manicura rusa, poligel, rubber base, gelish y pedicure spa en Zapopan, Guadalajara. Reserva en línea.',
    h1: 'Servicios y precios',
    keywords: 'precios manicura rusa guadalajara, servicios uñas zapopan'
  },
  '/galeria': {
    tab: 'galeria',
    title: 'Galería de Uñas | Trabajos Reales — Black Rococo Guadalajara',
    description: 'Galería de trabajos reales: manicura rusa, nail art, poligel y diseños personalizados hechos en nuestro estudio en Zapopan, Guadalajara.',
    h1: 'Galería de trabajos reales',
    keywords: 'nail art guadalajara, diseños de uñas zapopan'
  },
  '/sobre-nosotros': {
    tab: 'inicio',
    title: 'Sobre Nosotros | Estudio de Uñas en Ciudad Granja — Black Rococo',
    description: 'Conoce Black Rococo: estudio profesional de uñas en Ciudad Granja, Zapopan. Técnicas rusas, materiales premium y esterilización certificada.',
    h1: 'Sobre Black Rococo',
    keywords: 'estudio de uñas zapopan, salón de uñas ciudad granja'
  },
  '/reservar': {
    tab: 'reservar',
    title: 'Reservar Cita | Manicura Rusa en Zapopan — Black Rococo',
    description: 'Reserva tu cita en línea en segundos. Elige tu servicio, día y hora. Estudio de uñas premium en Ciudad Granja, Zapopan, Guadalajara.',
    h1: 'Reserva tu cita',
    keywords: 'reservar cita uñas guadalajara, agendar manicura zapopan'
  },
  '/contacto': {
    tab: 'inicio',
    title: 'Contacto y Ubicación | Black Rococo, Ciudad Granja, Zapopan',
    description: 'Dirección, horarios, WhatsApp y cómo llegar a Black Rococo en Ciudad Granja, Zapopan, Guadalajara. Estacionamiento disponible.',
    h1: 'Contacto y ubicación',
    keywords: 'salón de uñas cerca de mí zapopan, black rococo dirección'
  },
  '/academia': {
    tab: 'academia',
    title: 'Cursos de Uñas | Black Rococo Academy, Guadalajara',
    description: 'Cursos profesionales de manicura rusa, poligel y nail art en Guadalajara. Certifícate con técnicas y materiales de nivel profesional.',
    h1: 'Black Rococo Academy',
    keywords: 'curso de uñas guadalajara, curso manicura rusa'
  }
};

// ---------------------------------------------------------------------------
// FAQ — the highest-leverage structured data a local salon can ship.
//
// It wins the "People also ask" box and rich-result real estate, and every
// answer is a natural place for the exact phrases people actually search for.
// These are written to be genuinely useful, not keyword-stuffed: Google's
// helpful-content system penalises the latter, and a customer reads them too.
// ---------------------------------------------------------------------------
const FAQ = [
  {
    q: '¿Qué es la manicura rusa y en qué se diferencia de una manicura normal?',
    a: 'La manicura rusa es una técnica en seco que utiliza herramientas rotativas (tornos) para retirar la cutícula con precisión, sin agua ni cortes. El resultado es un acabado más limpio y cercano a la cutícula, y el esmaltado dura considerablemente más: entre tres y cuatro semanas frente a una o dos de una manicura tradicional.'
  },
  {
    q: '¿Cuánto dura una manicura rusa?',
    a: 'Entre tres y cuatro semanas, dependiendo del crecimiento natural de tu uña y de tu rutina diaria. Es una de las razones por las que, aunque el precio inicial es mayor, suele salir más económica al mes que una manicura convencional.'
  },
  {
    q: '¿Cuánto cuesta una manicura rusa en Guadalajara?',
    a: 'En la zona metropolitana de Guadalajara los precios varían aproximadamente entre 160 y 350 pesos según el estudio, la técnica y los materiales. Puedes consultar nuestros precios actualizados en la página de servicios.'
  },
  {
    q: '¿La manicura rusa daña la uña natural?',
    a: 'No, siempre que la realice una técnica capacitada. El torno trabaja sobre la cutícula y no sobre la lámina de la uña. El riesgo aparece cuando se aplica con presión o velocidad incorrectas, por eso importa tanto la formación de quien te atiende.'
  },
  {
    q: '¿Dónde están ubicados y hay estacionamiento?',
    a: 'Estamos en Ciudad Granja, Zapopan, con acceso rápido desde Av. Vallarta y López Mateos. Consulta la página de contacto para el mapa y la ruta.'
  },
  {
    q: '¿Necesito cita previa o puedo llegar sin reservar?',
    a: 'Recomendamos reservar: trabajamos con cita para dedicarle a cada clienta el tiempo completo del servicio. Puedes agendar en línea en menos de un minuto o escribirnos por WhatsApp.'
  },
  {
    q: '¿Qué es el poligel y cuál es la diferencia con el acrílico?',
    a: 'El poligel combina la resistencia del acrílico con la flexibilidad y ligereza del gel. No tiene el olor fuerte del acrílico, es más liviano al tacto y resulta menos agresivo con la uña natural al retirarlo.'
  },
  {
    q: '¿Cómo esterilizan sus herramientas?',
    a: 'Todo el instrumental metálico pasa por un proceso de limpieza, desinfección y esterilización entre clientas. Las limas y elementos porosos son de un solo uso.'
  }
];

// ---------------------------------------------------------------------------
// Structured data (JSON-LD)
//
// Previously this was HARDCODED in index.html — so when the owner changed the
// address or phone in Configuración, the structured data kept telling Google
// the old one. Everything below is generated from the live database instead, so
// it can never drift.
// ---------------------------------------------------------------------------
function localBusinessSchema(db, origin) {
  const contact = db.settings?.contact || {};
  const brand = db.settings?.brand || {};
  const services = (db.services || []).filter(s => s.active);
  const phone = String(contact.whatsappNumber || '').replace(/\D/g, '');

  return {
    '@context': 'https://schema.org',
    '@type': ['BeautySalon', 'NailSalon', 'LocalBusiness'],
    '@id': `${origin}/#business`,
    name: brand.name || 'Black Rococo',
    description: 'Estudio de uñas premium en Ciudad Granja, Zapopan. Especialistas en manicura rusa, poligel, rubber base, gelish y pedicure spa.',
    url: origin,
    telephone: phone ? `+${phone}` : undefined,
    image: `${origin}/og-image.jpg`,
    logo: `${origin}/favicon.svg`,
    priceRange: '$$',
    currenciesAccepted: 'MXN',
    address: {
      '@type': 'PostalAddress',
      streetAddress: contact.address1 || '',
      addressLocality: 'Zapopan',
      addressRegion: 'Jalisco',
      postalCode: '45010',
      addressCountry: 'MX'
    },
    // Coordinates matter for the map pack. Ciudad Granja, Zapopan.
    geo: { '@type': 'GeoCoordinates', latitude: 20.7105, longitude: -103.4408 },
    areaServed: [
      { '@type': 'City', name: 'Zapopan' },
      { '@type': 'City', name: 'Guadalajara' },
      { '@type': 'Place', name: 'Ciudad Granja' },
      { '@type': 'Place', name: 'Andares' },
      { '@type': 'Place', name: 'Puerta de Hierro' },
      { '@type': 'Place', name: 'Valle Real' }
    ],
    openingHoursSpecification: [{
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      opens: '10:00',
      closes: '19:00'
    }],
    sameAs: [contact.instagramUrl, contact.tiktokUrl, contact.facebookUrl].filter(Boolean),
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'Servicios de uñas',
      itemListElement: services.slice(0, 20).map(s => ({
        '@type': 'Offer',
        itemOffered: {
          '@type': 'Service',
          name: s.name,
          description: s.desc || undefined,
          url: `${origin}/servicios/${slugify(s.name)}`
        },
        price: String(s.price),
        priceCurrency: 'MXN'
      }))
    },
    potentialAction: {
      '@type': 'ReserveAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${origin}/reservar`,
        inLanguage: 'es-MX',
        actionPlatform: [
          'http://schema.org/DesktopWebPlatform',
          'http://schema.org/MobileWebPlatform'
        ]
      },
      result: { '@type': 'Reservation', name: 'Cita en Black Rococo' }
    }
  };
}

function serviceSchema(service, db, origin) {
  const brand = db.settings?.brand || {};
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: service.name,
    description: service.desc || `${service.name} en Zapopan, Guadalajara.`,
    serviceType: service.name,
    url: `${origin}/servicios/${slugify(service.name)}`,
    provider: { '@type': 'BeautySalon', name: brand.name || 'Black Rococo', '@id': `${origin}/#business` },
    areaServed: { '@type': 'City', name: 'Guadalajara' },
    offers: {
      '@type': 'Offer',
      price: String(service.price),
      priceCurrency: 'MXN',
      availability: 'https://schema.org/InStock',
      url: `${origin}/reservar`
    }
  };
}

function faqSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a }
    }))
  };
}

function breadcrumbSchema(trail, origin) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: `${origin}${item.path}`
    }))
  };
}

function websiteSchema(origin, brandName) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${origin}/#website`,
    url: origin,
    name: brandName || 'Black Rococo',
    inLanguage: 'es-MX',
    publisher: { '@id': `${origin}/#business` }
  };
}

// ---------------------------------------------------------------------------
// Route resolution
// ---------------------------------------------------------------------------
function resolvePage(pathname, db) {
  const clean = pathname.replace(/\/+$/, '') || '/';

  if (STATIC_PAGES[clean]) {
    return { kind: 'static', path: clean, meta: STATIC_PAGES[clean] };
  }

  // /servicios/<slug> — one page per service. THIS is what makes it possible to
  // rank for "manicura rusa guadalajara" separately from "pedicure guadalajara":
  // each gets its own URL, title, H1 and Service schema.
  const svcMatch = clean.match(/^\/servicios\/([a-z0-9-]+)$/);
  if (svcMatch) {
    const service = (db.services || []).find(s => s.active && slugify(s.name) === svcMatch[1]);
    if (service) return { kind: 'service', path: clean, service };
  }

  return null; // -> genuine 404
}

// ---------------------------------------------------------------------------
// Body content, rendered server-side.
//
// This is REAL content — service names, prices, descriptions, FAQ answers —
// read from the database. It is what Google indexes. app.js replaces it on
// hydration, so a human never sees it for more than a moment.
// ---------------------------------------------------------------------------
function renderBody(page, db, origin) {
  const brand = db.settings?.brand || {};
  const contact = db.settings?.contact || {};
  const services = (db.services || []).filter(s => s.active);
  const salonName = brand.name || 'Black Rococo';

  const nav = `<nav aria-label="Principal">
    <a href="/">Inicio</a> ·
    <a href="/servicios">Servicios</a> ·
    <a href="/galeria">Galería</a> ·
    <a href="/sobre-nosotros">Sobre nosotros</a> ·
    <a href="/academia">Cursos</a> ·
    <a href="/contacto">Contacto</a> ·
    <a href="/reservar">Reservar cita</a>
  </nav>`;

  const serviceList = services.length
    ? `<ul>${services.map(s => `<li>
        <a href="/servicios/${slugify(s.name)}"><strong>${esc(s.name)}</strong></a>
        — $${esc(s.price)} MXN · ${esc(s.dur)} min
        ${s.desc ? `<p>${esc(s.desc)}</p>` : ''}
      </li>`).join('')}</ul>`
    : '';

  const faqBlock = `<section><h2>Preguntas frecuentes</h2>
    ${FAQ.map(f => `<div><h3>${esc(f.q)}</h3><p>${esc(f.a)}</p></div>`).join('')}
  </section>`;

  const contactBlock = `<section><h2>Ubicación y contacto</h2>
    <address>
      ${esc(contact.address1 || '')}${contact.address2 ? `, ${esc(contact.address2)}` : ''}<br>
      Zapopan, Jalisco, México<br>
      Horario: ${esc(contact.hours1 || 'Lun a Sáb, 10:00 a 19:00')}
    </address>
    <p><a href="/reservar">Reservar cita en línea</a></p>
  </section>`;

  if (page.kind === 'service') {
    const s = page.service;
    const related = services.filter(x => x.id !== s.id).slice(0, 4);
    return `<article>
      ${nav}
      <h1>${esc(s.name)} en Zapopan, Guadalajara</h1>
      <p><strong>$${esc(s.price)} MXN · ${esc(s.dur)} minutos</strong></p>
      ${s.desc ? `<p>${esc(s.desc)}</p>` : ''}
      <p>Realizamos ${esc(s.name.toLowerCase())} en ${esc(salonName)}, nuestro estudio en Ciudad Granja, Zapopan, con materiales premium e instrumental esterilizado entre cada clienta.</p>
      <p><a href="/reservar">Reservar ${esc(s.name)}</a></p>
      ${related.length ? `<section><h2>Otros servicios</h2><ul>
        ${related.map(r => `<li><a href="/servicios/${slugify(r.name)}">${esc(r.name)}</a> — $${esc(r.price)} MXN</li>`).join('')}
      </ul></section>` : ''}
      ${contactBlock}
    </article>`;
  }

  const m = page.meta;
  const path = page.path;

  let main = `<h1>${esc(m.h1)}</h1>`;

  if (path === '/') {
    main += `<p>${esc(salonName)} es un estudio de uñas premium en Ciudad Granja, Zapopan. Nos especializamos en manicura rusa, poligel, rubber base, gelish y pedicure spa, con técnicas precisas y materiales de nivel profesional.</p>
      <section><h2>Nuestros servicios</h2>${serviceList}</section>
      ${faqBlock}
      ${contactBlock}`;
  } else if (path === '/servicios') {
    main += `<p>Precios y duraciones actualizados de todos nuestros servicios de uñas en Zapopan, Guadalajara.</p>
      ${serviceList}
      ${contactBlock}`;
  } else if (path === '/galeria') {
    main += `<p>Trabajos reales realizados en nuestro estudio: manicura rusa, nail art, poligel y diseños personalizados.</p>
      ${contactBlock}`;
  } else if (path === '/sobre-nosotros') {
    const about = db.settings?.config?.aboutUs || {};
    main += `<p>${esc(about.text || `${salonName} es un estudio profesional de uñas en Ciudad Granja, Zapopan.`)}</p>
      ${faqBlock}
      ${contactBlock}`;
  } else if (path === '/reservar') {
    main += `<p>Reserva tu cita en línea en menos de un minuto. Elige servicio, día y hora.</p>
      <section><h2>Servicios disponibles</h2>${serviceList}</section>
      ${contactBlock}`;
  } else if (path === '/contacto') {
    main += contactBlock + faqBlock;
  } else if (path === '/academia') {
    const courses = (db.courses || []).filter(c => c.active);
    main += `<p>Cursos profesionales de uñas en Guadalajara.</p>
      ${courses.length ? `<ul>${courses.map(c => `<li><strong>${esc(c.title)}</strong> — $${esc(c.price)} MXN${c.description ? `<p>${esc(c.description)}</p>` : ''}</li>`).join('')}</ul>` : ''}
      ${contactBlock}`;
  }

  return `<article>${nav}${main}</article>`;
}

// ---------------------------------------------------------------------------
// Head assembly
// ---------------------------------------------------------------------------
function buildHead(page, db, origin) {
  const brand = db.settings?.brand || {};
  const salonName = brand.name || 'Black Rococo';

  let title, description, canonical, keywords;
  const schemas = [localBusinessSchema(db, origin), websiteSchema(origin, salonName)];

  if (page.kind === 'service') {
    const s = page.service;
    const slug = slugify(s.name);
    title = `${s.name} en Zapopan, Guadalajara | $${s.price} — ${salonName}`;
    description = `${s.desc ? s.desc.slice(0, 110) : `${s.name} profesional`} · $${s.price} MXN · ${s.dur} min. Estudio premium en Ciudad Granja, Zapopan. Reserva en línea.`;
    canonical = `${origin}/servicios/${slug}`;
    keywords = `${s.name.toLowerCase()} guadalajara, ${s.name.toLowerCase()} zapopan`;
    schemas.push(serviceSchema(s, db, origin));
    schemas.push(breadcrumbSchema([
      { name: 'Inicio', path: '/' },
      { name: 'Servicios', path: '/servicios' },
      { name: s.name, path: `/servicios/${slug}` }
    ], origin));
  } else {
    const m = page.meta;
    title = m.title;
    description = m.description;
    canonical = `${origin}${page.path === '/' ? '/' : page.path}`;
    keywords = m.keywords;

    if (['/', '/sobre-nosotros', '/contacto'].includes(page.path)) schemas.push(faqSchema());
    if (page.path !== '/') {
      schemas.push(breadcrumbSchema([
        { name: 'Inicio', path: '/' },
        { name: m.h1, path: page.path }
      ], origin));
    }
  }

  const ld = schemas
    .map(s => `<script type="application/ld+json">${JSON.stringify(s)}</script>`)
    .join('\n  ');

  return `
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="keywords" content="${esc(keywords || '')}">
  <link rel="canonical" href="${esc(canonical)}">

  <meta property="og:type" content="business.business">
  <meta property="og:site_name" content="${esc(salonName)}">
  <meta property="og:locale" content="es_MX">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(canonical)}">
  <meta property="og:image" content="${origin}/og-image.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${origin}/og-image.jpg">

  <meta name="geo.region" content="MX-JAL">
  <meta name="geo.placename" content="Zapopan, Jalisco">
  <meta name="geo.position" content="20.7105;-103.4408">
  <meta name="ICBM" content="20.7105, -103.4408">

  ${ld}`;
}

// Every indexable URL, generated from the live service list — so a new service
// automatically gets a sitemap entry instead of being invisible to Google.
function buildSitemap(db, origin) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: '/', priority: '1.0', freq: 'weekly' },
    { loc: '/servicios', priority: '0.9', freq: 'weekly' },
    { loc: '/reservar', priority: '0.9', freq: 'monthly' },
    { loc: '/galeria', priority: '0.8', freq: 'weekly' },
    { loc: '/sobre-nosotros', priority: '0.7', freq: 'monthly' },
    { loc: '/contacto', priority: '0.7', freq: 'monthly' },
    { loc: '/academia', priority: '0.6', freq: 'monthly' }
  ];

  for (const s of (db.services || []).filter(x => x.active)) {
    urls.push({ loc: `/servicios/${slugify(s.name)}`, priority: '0.8', freq: 'monthly' });
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${origin}${u.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${u.freq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;
}

function buildRobots(origin) {
  return `User-agent: *
Allow: /

# The admin panel holds client data. Keep it out of the index.
Disallow: /api/
Disallow: /admin

Sitemap: ${origin}/sitemap.xml`;
}

module.exports = {
  STATIC_PAGES,
  FAQ,
  slugify,
  resolvePage,
  renderBody,
  buildHead,
  buildSitemap,
  buildRobots,
  localBusinessSchema,
  serviceSchema,
  faqSchema
};
