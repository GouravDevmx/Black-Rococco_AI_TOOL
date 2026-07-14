# Google Calendar auto-sync: setup guide

This connects the app directly to Google Calendar (no Zapier/Make in the
middle). Once set up, every new booking automatically creates a calendar
event, and cancelling an appointment automatically removes it.

## Part 1 — Google Cloud Console (one-time, ~15 minutes)

1. Go to **console.cloud.google.com** and sign in with the Google account
   whose calendar you want to block time on (this can be changed later by
   reconnecting with a different account).
2. Click the project dropdown (top left) → **New Project** → name it
   anything (e.g. "Black Rococo") → **Create**.
3. With that project selected, go to **APIs & Services → Library**, search
   for **Google Calendar API**, click it, click **Enable**.
4. Go to **APIs & Services → OAuth consent screen**.
   - User type: **External**
   - App name: "Black Rococo" (or anything)
   - User support email / developer contact: your email
   - Scopes: skip for now (click through)
   - **Test users**: add the exact Gmail address you'll use to connect
     the calendar. This is important — while the app is in "Testing" mode
     (the default, and totally fine to stay in for personal/single-business
     use), only accounts listed here can authorize it.
   - Save through to the summary page.
5. Go to **APIs & Services → Credentials → Create Credentials → OAuth
   client ID**.
   - Application type: **Web application**
   - Name: anything
   - **Authorized redirect URIs** → **Add URI** → enter exactly:
     ```
     https://your-actual-railway-url.up.railway.app/api/admin/google-calendar/callback
     ```
     (replace with your real deployed URL — check Railway's Settings →
     Networking for the exact domain)
   - Click **Create**
6. A popup shows your **Client ID** and **Client Secret** — copy both.

## Part 2 — Add to Railway

In your Railway service → **Variables**, add:

| Variable | Value |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | the Client ID from step 6 |
| `GOOGLE_OAUTH_CLIENT_SECRET` | the Client Secret from step 6 |

(`GOOGLE_OAUTH_REDIRECT_URI` doesn't need to be set separately — it's built
automatically from `SITE_URL`, which you should already have set.)

Save, let it redeploy.

## Part 3 — Connect it

1. Log into the admin panel
2. Go to the integrations area and click **"Conectar Google Calendar"**
3. You'll be sent to Google, asked to approve calendar access — sign in
   with the Gmail you added as a test user, approve it
4. You'll land back in the admin panel with a "connected" confirmation,
   showing which Google account is linked

From here on, every new booking creates a real event on that Google
Calendar automatically, and cancelling an appointment removes it.

## Troubleshooting

- **"Access blocked: this app's request is invalid"** — usually means the
  redirect URI in Google Cloud Console doesn't exactly match your real
  deployed URL (including `https://`, no trailing slash, exact path). Fix
  it in Credentials → your OAuth client → Authorized redirect URIs.
- **"Access blocked: has not completed verification"** — means you're
  trying to connect with a Gmail address that isn't in the Test users list
  from Part 1, step 4. Add it there.
- **Reconnecting with a different Google account** — just click "Conectar
  Google Calendar" again; it overwrites the previous connection.
