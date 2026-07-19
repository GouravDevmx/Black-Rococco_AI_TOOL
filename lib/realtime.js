/*
  Realtime hub — Server-Sent Events.

  One GET /api/events stream per open browser tab. Every completed writeDb()
  broadcasts a `data` event; the client reacts by re-fetching what it shows,
  so admin edits appear on the public site (and vice versa) without a manual
  refresh. The chat domain broadcasts `chat` events for instant messaging.

  SSE over long-lived HTTP works through Railway/most proxies without any
  extra infra (unlike WebSockets, no upgrade handshake to configure), and the
  browser's EventSource reconnects automatically after drops.
*/
const clients = new Set();
let dataVersion = Date.now();

function addClient(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // disable proxy buffering
  });
  res.write(`event: hello\ndata: {"v":${dataVersion}}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

function broadcast(event, payload) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try { res.write(msg); } catch { clients.delete(res); }
  }
}

function broadcastDataChanged() {
  dataVersion = Date.now();
  broadcast('data', { v: dataVersion });
}

// Heartbeat keeps proxies from timing out idle streams.
const beat = setInterval(() => {
  for (const res of clients) {
    try { res.write(':hb\n\n'); } catch { clients.delete(res); }
  }
}, 25000);
beat.unref?.();

module.exports = { addClient, broadcast, broadcastDataChanged };
