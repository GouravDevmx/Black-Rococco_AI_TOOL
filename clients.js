const { writeDb } = require('../db');
const { json, readBody, safeString, generateId } = require('../helpers');
const { USE_SUPABASE } = require('../config');

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120) || 'post';
}

// Public data: only published posts, body stripped for listing
function publicBlogPosts(db) {
  return db.blogPosts
    .filter(p => p.published)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(p => ({
      id: p.id,
      title: p.title,
      slug: p.slug,
      excerpt: p.excerpt,
      coverImageUrl: p.coverImageUrl,
      tags: p.tags,
      author: p.author,
      createdAt: p.createdAt
    }));
}

// Public routes: GET /api/blogs, GET /api/blogs/:id
async function handlePublicRoutes({ req, res, pathname, db }) {
  if (req.method === 'GET' && pathname === '/api/blogs') {
    json(res, 200, { posts: publicBlogPosts(db) });
    return true;
  }

  const singleMatch = pathname.match(/^\/api\/blogs\/([^/]+)$/);
  if (req.method === 'GET' && singleMatch) {
    const id = singleMatch[1];
    const post = db.blogPosts.find(p => (p.id === id || p.slug === id) && p.published);
    if (!post) { json(res, 404, { error: 'Entrada no encontrada.' }); return true; }
    json(res, 200, { post });
    return true;
  }

  return false;
}

// Admin routes: full CRUD
async function handleAdminRoutes({ req, res, pathname, db, salonId }) {
  // POST /api/admin/blogs — create
  if (req.method === 'POST' && pathname === '/api/admin/blogs') {
    const body = await readBody(req);
    const title = safeString(body.title, 300);
    if (!title) { json(res, 400, { error: 'El título es obligatorio.' }); return true; }

    db.counters.blogPost += 1;
    const now = new Date().toISOString();
    const slug = slugify(title) + '-' + Date.now().toString(36);
    const post = {
      id: generateId(USE_SUPABASE, 'blog', db.counters.blogPost),
      title,
      slug,
      excerpt: safeString(body.excerpt, 500),
      body: safeString(body.body, 50000),
      coverImageUrl: safeString(body.coverImageUrl, 1000),
      published: body.published === true,
      tags: Array.isArray(body.tags) ? body.tags.map(t => safeString(t, 60)).filter(Boolean).slice(0, 10) : [],
      author: safeString(body.author, 120) || 'Black Rococo',
      createdAt: now,
      updatedAt: now
    };
    db.blogPosts.push(post);
    await writeDb(db, salonId);
    json(res, 201, { post });
    return true;
  }

  // PUT /api/admin/blogs/:id — update
  const updateMatch = pathname.match(/^\/api\/admin\/blogs\/([^/]+)$/);
  if (req.method === 'PUT' && updateMatch) {
    const post = db.blogPosts.find(p => p.id === updateMatch[1]);
    if (!post) { json(res, 404, { error: 'Entrada no encontrada.' }); return true; }

    const body = await readBody(req);
    if (body.title !== undefined) post.title = safeString(body.title, 300);
    if (body.excerpt !== undefined) post.excerpt = safeString(body.excerpt, 500);
    if (body.body !== undefined) post.body = safeString(body.body, 50000);
    if (body.coverImageUrl !== undefined) post.coverImageUrl = safeString(body.coverImageUrl, 1000);
    if (body.published !== undefined) post.published = body.published === true;
    if (body.tags !== undefined) post.tags = Array.isArray(body.tags) ? body.tags.map(t => safeString(t, 60)).filter(Boolean).slice(0, 10) : [];
    if (body.author !== undefined) post.author = safeString(body.author, 120) || 'Black Rococo';
    post.updatedAt = new Date().toISOString();

    await writeDb(db, salonId);
    json(res, 200, { post });
    return true;
  }

  // DELETE /api/admin/blogs/:id
  const deleteMatch = pathname.match(/^\/api\/admin\/blogs\/([^/]+)$/);
  if (req.method === 'DELETE' && deleteMatch) {
    const idx = db.blogPosts.findIndex(p => p.id === deleteMatch[1]);
    if (idx === -1) { json(res, 404, { error: 'Entrada no encontrada.' }); return true; }
    db.blogPosts.splice(idx, 1);
    await writeDb(db, salonId);
    json(res, 200, { ok: true });
    return true;
  }

  // PATCH /api/admin/blogs/:id/publish — toggle publish
  const publishMatch = pathname.match(/^\/api\/admin\/blogs\/([^/]+)\/publish$/);
  if (req.method === 'PATCH' && publishMatch) {
    const post = db.blogPosts.find(p => p.id === publishMatch[1]);
    if (!post) { json(res, 404, { error: 'Entrada no encontrada.' }); return true; }
    const body = await readBody(req);
    post.published = body.published === true;
    post.updatedAt = new Date().toISOString();
    await writeDb(db, salonId);
    json(res, 200, { post });
    return true;
  }

  return false;
}

module.exports = { handlePublicRoutes, handleAdminRoutes, publicBlogPosts };
