/*
  Chat domain — lightweight client <-> salon messaging.

  Identity: each visitor gets a `br_chat_thread` cookie (random id) on their
  first message. Logged-in clients could later be linked by account, but the
  cookie keeps it zero-friction for guests, which is what a "chat with us"
  bubble needs.

  Realtime: every stored message broadcasts a `chat` SSE event; the client
  widget and the admin panel both refresh from it, and the admin UI shows a
  popup for messages it hasn't seen.

  Routes:
    public  POST /api/chat/messages   { text, name? }  (sets thread cookie)
    public  GET  /api/chat/messages                    (own thread)
    admin   GET  /api/admin/chats                      (threads + unread)
    admin   GET  /api/admin/chats/:threadId            (full thread, marks read)
    admin   POST /api/admin/chats/:threadId/reply      { text }
*/
const crypto = require('crypto');
const { writeDb } = require('../db');
const { json, readBody, safeString, generateId } = require('../helpers');
const { USE_SUPABASE } = require('../config');
const realtime = require('../realtime');

const IS_PRODUCTION = process.env.NODE_ENV === 'production' || Boolean(process.env.RAILWAY_ENVIRONMENT);

function parseCookies(req) {
  const cookie = req.headers.cookie || '';
  return Object.fromEntries(
    cookie.split(';').map(v => v.trim()).filter(Boolean)
      .map(v => { const i = v.indexOf('='); return [decodeURIComponent(v.slice(0, i)), decodeURIComponent(v.slice(i + 1))]; })
  );
}

function threadCookie(id) {
  const parts = [
    `br_chat_thread=${encodeURIComponent(id)}`,
    'Path=/', 'HttpOnly', 'SameSite=Lax',
    `Max-Age=${60 * 60 * 24 * 90}` // 90 days
  ];
  if (IS_PRODUCTION) parts.push('Secure');
  return parts.join('; ');
}

function threadIdFrom(req) {
  return parseCookies(req).br_chat_thread || null;
}

const MAX_MESSAGES_PER_THREAD = 500;

async function handlePublicRoutes({ req, res, pathname, db, salonId }) {
  // POST /api/chat/messages — visitor sends a message
  if (req.method === 'POST' && pathname === '/api/chat/messages') {
    const body = await readBody(req);
    const text = safeString(body.text, 2000).trim();
    if (!text) return json(res, 400, { error: 'Escribe un mensaje.' }), true;

    let threadId = threadIdFrom(req);
    const isNewThread = !threadId || !db.chatMessages.some(m => m.threadId === threadId);
    if (!threadId) threadId = crypto.randomBytes(12).toString('hex');

    db.counters.chatMessage += 1;
    const msg = {
      id: generateId(USE_SUPABASE, 'chm', db.counters.chatMessage),
      threadId,
      sender: 'client',
      name: safeString(body.name, 120) || 'Visitante',
      text,
      readByAdmin: false,
      readByClient: true,
      createdAt: new Date().toISOString()
    };
    db.chatMessages.push(msg);
    // Cap runaway threads.
    const threadMsgs = db.chatMessages.filter(m => m.threadId === threadId);
    if (threadMsgs.length > MAX_MESSAGES_PER_THREAD) {
      const excess = new Set(threadMsgs.slice(0, threadMsgs.length - MAX_MESSAGES_PER_THREAD).map(m => m.id));
      db.chatMessages = db.chatMessages.filter(m => !excess.has(m.id));
    }
    await writeDb(db, salonId);
    realtime.broadcast('chat', { threadId, from: 'client', newThread: isNewThread, name: msg.name });

    json(res, 201, { ok: true, message: msg }, { 'Set-Cookie': threadCookie(threadId) });
    return true;
  }

  // GET /api/chat/messages — visitor reads own thread
  if (req.method === 'GET' && pathname === '/api/chat/messages') {
    const threadId = threadIdFrom(req);
    if (!threadId) return json(res, 200, { messages: [] }), true;
    const messages = db.chatMessages
      .filter(m => m.threadId === threadId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    // Reading marks admin replies as seen by the client.
    let dirty = false;
    for (const m of messages) {
      if (m.sender === 'admin' && !m.readByClient) { m.readByClient = true; dirty = true; }
    }
    if (dirty) await writeDb(db, salonId);
    json(res, 200, { messages });
    return true;
  }

  return false;
}

async function handleAdminRoutes({ req, res, pathname, db, salonId }) {
  // GET /api/admin/chats — thread list with last message + unread count
  if (req.method === 'GET' && pathname === '/api/admin/chats') {
    const byThread = new Map();
    for (const m of db.chatMessages) {
      if (!byThread.has(m.threadId)) byThread.set(m.threadId, []);
      byThread.get(m.threadId).push(m);
    }
    const threads = [...byThread.entries()].map(([threadId, msgs]) => {
      msgs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const last = msgs[msgs.length - 1];
      const clientMsg = msgs.find(m => m.sender === 'client');
      return {
        threadId,
        name: clientMsg?.name || 'Visitante',
        lastText: last.text,
        lastAt: last.createdAt,
        lastSender: last.sender,
        unread: msgs.filter(m => m.sender === 'client' && !m.readByAdmin).length,
        total: msgs.length
      };
    }).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    json(res, 200, { threads, totalUnread: threads.reduce((s, t) => s + t.unread, 0) });
    return true;
  }

  // GET /api/admin/chats/:threadId — full thread; marks client msgs read
  const threadMatch = pathname.match(/^\/api\/admin\/chats\/([^/]+)$/);
  if (req.method === 'GET' && threadMatch) {
    const threadId = threadMatch[1];
    const messages = db.chatMessages
      .filter(m => m.threadId === threadId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    let dirty = false;
    for (const m of messages) {
      if (m.sender === 'client' && !m.readByAdmin) { m.readByAdmin = true; dirty = true; }
    }
    if (dirty) await writeDb(db, salonId);
    json(res, 200, { messages });
    return true;
  }

  // POST /api/admin/chats/:threadId/reply
  const replyMatch = pathname.match(/^\/api\/admin\/chats\/([^/]+)\/reply$/);
  if (req.method === 'POST' && replyMatch) {
    const threadId = replyMatch[1];
    const body = await readBody(req);
    const text = safeString(body.text, 2000).trim();
    if (!text) return json(res, 400, { error: 'Escribe un mensaje.' }), true;
    if (!db.chatMessages.some(m => m.threadId === threadId)) {
      return json(res, 404, { error: 'Conversación no encontrada.' }), true;
    }
    db.counters.chatMessage += 1;
    const msg = {
      id: generateId(USE_SUPABASE, 'chm', db.counters.chatMessage),
      threadId,
      sender: 'admin',
      name: 'Black Rococo',
      text,
      readByAdmin: true,
      readByClient: false,
      createdAt: new Date().toISOString()
    };
    db.chatMessages.push(msg);
    await writeDb(db, salonId);
    realtime.broadcast('chat', { threadId, from: 'admin' });
    json(res, 201, { ok: true, message: msg });
    return true;
  }

  return false;
}

module.exports = { handlePublicRoutes, handleAdminRoutes };
