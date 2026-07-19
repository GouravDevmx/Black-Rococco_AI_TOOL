/*
  SEO domain — makes blog posts and academy courses individually indexable.

  Crawlers (and WhatsApp/Facebook link previews) do not reliably execute
  JavaScript, so a plain SPA shows them the same generic index.html for every
  URL. This module intercepts path-based URLs BEFORE the static handler and
  serves index.html with the <title>, meta description, canonical and
  OpenGraph tags rewritten for that specific post/course. The SPA client then
  boots normally and renders the same content interactively.

  Routes handled:
    GET /blog/:slug        -> index.html with the post's meta + BlogPosting JSON-LD
    GET /academia/:slug    -> index.html with the course's meta + Course JSON-LD
    GET /sitemap.xml       -> generated from live DB (static pages + posts + courses)
*/
const fs = require('fs');
const path = require('path');
const { PUBLIC_DIR, SITE_URL } = require('../config');

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120) || 'item';
}

function courseSlug(course) {
  // Courses have no stored slug; derive deterministically from title + id
  // suffix so two courses with the same title still get distinct URLs.
  return `${slugify(course.title)}-${String(course.id).slice(-6)}`;
}

function escAttr(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function originFor(req) {
  if (SITE_URL) return SITE_URL;
  const host = req.headers.host || 'localhost';
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
    || (req.socket.encrypted ? 'https' : 'http');
  return `${proto}://${host}`;
}

let cachedIndex = null;
function readIndex() {
  // index.html changes only on deploy; cache the template in memory.
  if (!cachedIndex) {
    cachedIndex = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  }
  return cachedIndex;
}

/*
  Replace the head meta block for a specific page. We rewrite:
  <title>, meta[name=description], link[rel=canonical],
  og:title, og:description, og:url, og:image (if provided),
  twitter:title, twitter:description — and append JSON-LD.
*/
function renderSeoPage({ req, title, description, urlPath, image, jsonLd }) {
  const origin = originFor(req);
  let html = readIndex();
  const fullUrl = `${origin}${urlPath}`;

  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escAttr(title)}</title>`);
  html = html.replace(/(<meta name="description" content=")[^"]*(")/, `$1${escAttr(description)}$2`);
  html = html.replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${escAttr(fullUrl)}$2`);
  html = html.replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${escAttr(title)}$2`);
  html = html.replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${escAttr(description)}$2`);
  html = html.replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${escAttr(fullUrl)}$2`);
  html = html.replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${escAttr(title)}$2`);
  html = html.replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${escAttr(description)}$2`);
  if (image) {
    html = html.replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${escAttr(image)}$2`);
    html = html.replace(/(<meta name="twitter:image" content=")[^"]*(")/, `$1${escAttr(image)}$2`);
  }
  if (jsonLd) {
    html = html.replace('</head>', `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>\n</head>`);
  }
  // Rewrite the canonical-placeholder domain the same way server.js does.
  html = html.replace(/https:\/\/blackrococo\.mx/g, origin);
  return html;
}

function sendHtml(res, html) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

/*
  Main entry. Returns true if the request was handled.
  db is read lazily by the caller only for matching paths.
*/
async function handleSeoRoutes({ req, res, pathname, readDb, salonId }) {
  if (req.method !== 'GET') return false;

  // ---- /blog/:slug ----
  const blogMatch = pathname.match(/^\/blog\/([^/]+)\/?$/);
  if (blogMatch) {
    const db = await readDb(salonId, ['blogPosts']);
    const slug = decodeURIComponent(blogMatch[1]);
    const post = db.blogPosts.find(p => (p.slug === slug || p.id === slug) && p.published);
    if (!post) return false; // fall through to SPA fallback (client shows listing)
    const desc = post.excerpt || `${post.title} — Blog de Black Rococo, estudio de uñas en Zapopan.`;
    sendHtml(res, renderSeoPage({
      req,
      title: `${post.title} | Black Rococo Blog`,
      description: desc.slice(0, 300),
      urlPath: `/blog/${post.slug}`,
      image: post.coverImageUrl || null,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: post.title,
        description: desc,
        image: post.coverImageUrl || undefined,
        author: { '@type': 'Organization', name: post.author || 'Black Rococo' },
        publisher: { '@type': 'Organization', name: 'Black Rococo' },
        datePublished: post.createdAt,
        dateModified: post.updatedAt || post.createdAt,
        mainEntityOfPage: { '@type': 'WebPage', '@id': `${originFor(req)}/blog/${post.slug}` }
      }
    }));
    return true;
  }

  // ---- /academia/:slug ----
  const courseMatch = pathname.match(/^\/academia\/([^/]+)\/?$/);
  if (courseMatch) {
    const db = await readDb(salonId, ['courses']);
    const slug = decodeURIComponent(courseMatch[1]);
    const course = db.courses.find(c => c.active && (courseSlug(c) === slug || c.id === slug));
    if (!course) return false;
    const desc = course.description || `${course.title} — curso profesional en Black Rococo Academy, Zapopan.`;
    sendHtml(res, renderSeoPage({
      req,
      title: `${course.title} | Black Rococo Academy`,
      description: desc.slice(0, 300),
      urlPath: `/academia/${courseSlug(course)}`,
      image: (course.imageUrls && course.imageUrls[0]) || null,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'Course',
        name: course.title,
        description: desc,
        provider: { '@type': 'Organization', name: 'Black Rococo Academy', sameAs: originFor(req) },
        offers: { '@type': 'Offer', price: course.price, priceCurrency: 'MXN' }
      }
    }));
    return true;
  }

  // ---- /sitemap.xml (dynamic, from live DB) ----
  if (pathname === '/sitemap.xml') {
    const db = await readDb(salonId, ['blogPosts', 'courses']);
    const origin = originFor(req);
    const urls = [
      { loc: `${origin}/`, priority: '1.0', changefreq: 'weekly' },
      { loc: `${origin}/servicios`, priority: '0.9', changefreq: 'weekly' },
      { loc: `${origin}/reservar`, priority: '0.9', changefreq: 'daily' },
      { loc: `${origin}/galeria`, priority: '0.7', changefreq: 'weekly' },
      { loc: `${origin}/academia`, priority: '0.7', changefreq: 'monthly' },
      { loc: `${origin}/blog`, priority: '0.8', changefreq: 'weekly' }
    ];
    for (const p of db.blogPosts.filter(p => p.published)) {
      urls.push({ loc: `${origin}/blog/${p.slug}`, priority: '0.7', changefreq: 'monthly', lastmod: (p.updatedAt || p.createdAt || '').slice(0, 10) });
    }
    for (const c of db.courses.filter(c => c.active)) {
      urls.push({ loc: `${origin}/academia/${courseSlug(c)}`, priority: '0.6', changefreq: 'monthly' });
    }
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u =>
      `  <url>\n    <loc>${escAttr(u.loc)}</loc>\n${u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>\n` : ''}    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
    ).join('\n')}\n</urlset>\n`;
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    res.end(xml);
    return true;
  }

  return false;
}

module.exports = { handleSeoRoutes, courseSlug, slugify };
