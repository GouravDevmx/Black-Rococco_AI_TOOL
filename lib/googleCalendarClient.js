const https = require('https');
const {
  GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI
} = require('./config');

const OAUTH_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

function httpsJsonRequest({ hostname, path, method, headers, body }) {
  return new Promise((resolve, reject) => {
    const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const req = https.request({
      hostname,
      path,
      method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers
      }
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch { parsed = data; }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(parsed);
        } else {
          reject(new Error(`Google API ${method} ${path} -> ${res.statusCode}: ${JSON.stringify(parsed)}`));
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function buildAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: GOOGLE_OAUTH_REDIRECT_URI,
    response_type: 'code',
    scope: OAUTH_SCOPE,
    access_type: 'offline', // required to get a refresh_token
    prompt: 'consent', // forces Google to re-issue a refresh_token even on reconnect
    state
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function formBody(obj) {
  return new URLSearchParams(obj).toString();
}

async function exchangeCodeForTokens(code) {
  return httpsJsonRequest({
    hostname: 'oauth2.googleapis.com',
    path: '/token',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody({
      code,
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: GOOGLE_OAUTH_REDIRECT_URI,
      grant_type: 'authorization_code'
    })
  });
  // -> { access_token, refresh_token, expires_in, scope, token_type }
}

async function refreshAccessToken(refreshToken) {
  return httpsJsonRequest({
    hostname: 'oauth2.googleapis.com',
    path: '/token',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody({
      refresh_token: refreshToken,
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
      grant_type: 'refresh_token'
    })
  });
  // -> { access_token, expires_in, scope, token_type } (no new refresh_token)
}

async function getUserEmail(accessToken) {
  const info = await httpsJsonRequest({
    hostname: 'www.googleapis.com',
    path: '/oauth2/v2/userinfo',
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return info?.email || '';
}

async function insertEvent(accessToken, calendarId, eventBody) {
  return httpsJsonRequest({
    hostname: 'www.googleapis.com',
    path: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: eventBody
  });
}

async function patchEvent(accessToken, calendarId, eventId, eventBody) {
  return httpsJsonRequest({
    hostname: 'www.googleapis.com',
    path: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: eventBody
  });
}

async function deleteEvent(accessToken, calendarId, eventId) {
  try {
    await httpsJsonRequest({
      hostname: 'www.googleapis.com',
      path: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` }
    });
  } catch (err) {
    // Google returns 410 Gone if the event was already deleted (e.g.
    // manually removed from the calendar) — treat that as success, not an error.
    if (!String(err.message).includes('410')) throw err;
  }
}

module.exports = {
  buildAuthUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  getUserEmail,
  insertEvent,
  patchEvent,
  deleteEvent
};
