# Production Integrations Plan

## 1. Database and Auth

Recommended: Supabase.

Use Supabase for:

- Admin authentication
- Services table
- Appointments table
- Clients table
- Posts table
- Notifications table
- Settings table
- Image storage

The MVP currently uses `data/db.json`. Replace the read/write functions in `server.js` with Supabase client calls before real production use.

## 2. Admin notifications

Current MVP behavior:

- Every new booking creates unread notifications in the Admin Panel.
- Admin sees notification status for:
  - New booking
  - Google Calendar integration
  - WhatsApp Admin integration
  - Client reminder integration
- Admin can mark one notification or all notifications as read.
- Admin agenda rows include quick actions:
  - WhatsApp Admin
  - Google Calendar
  - Recordar clienta

Relevant API routes:

```text
GET  /api/admin/dashboard
PATCH /api/admin/notifications/:id/read
POST /api/admin/notifications/read-all
```

## 3. Google Calendar

Current MVP behavior:

- Every booking generates a Google Calendar pre-filled event link.
- If `GOOGLE_CALENDAR_WEBHOOK_URL` is configured, the backend sends the booking payload to that webhook.

Recommended no-code setup:

1. Create a Make/Zapier/n8n webhook.
2. Connect the webhook to Google Calendar → Create Event.
3. Add the webhook URL as `GOOGLE_CALENDAR_WEBHOOK_URL` in Render/Railway.
4. Map these fields from the payload:
   - `calendar.title`
   - `calendar.start`
   - `calendar.end`
   - `calendar.timeZone`
   - `calendar.location`
   - `calendar.description`

Direct Google Calendar API is also possible, but it requires OAuth/service-account setup and should not be hardcoded into this MVP.

## 4. WhatsApp Admin alert

Current MVP behavior:

- Admin agenda and notification rows include a one-click WhatsApp alert link.
- If `WHATSAPP_ADMIN_WEBHOOK_URL` is configured, the backend sends the booking payload to that webhook.

Recommended no-code setup:

1. Create a Make/Zapier/n8n webhook.
2. Connect it to Twilio WhatsApp or WhatsApp Cloud API.
3. Set:

```bash
WHATSAPP_ADMIN_WEBHOOK_URL=https://hook.make.com/xxxxx
WHATSAPP_ADMIN_PHONE=5213326553522
```

Important: fully automatic WhatsApp messages require an approved WhatsApp Business sender/template or a provider such as Twilio.

## 5. Client appointment reminders

Current MVP behavior:

- Reminder checks run every 10 minutes while the server is running.
- Default reminder schedule: 24 hours and 2 hours before the appointment.
- If `CLIENT_REMINDER_WEBHOOK_URL` is configured, the backend sends reminder payloads to that webhook.
- If it is not configured, the Admin Panel shows a manual WhatsApp reminder action.

Configure:

```bash
CLIENT_REMINDER_WEBHOOK_URL=https://hook.make.com/yyyyy
CLIENT_REMINDER_HOURS=24,2
```

Recommended no-code setup:

1. Webhook receives `client.reminder.24h` or `client.reminder.2h`.
2. Make/Zapier/n8n sends a WhatsApp template to the client.
3. Use payload values:
   - `appointment.clientName`
   - `appointment.clientWhatsapp`
   - `appointment.serviceName`
   - `appointment.date`
   - `appointment.time`
   - `calendar.location`

Production note: on free hosting, servers can sleep. For guaranteed reminders, use a real database + external scheduler/cron such as Make scheduler, GitHub Actions cron, Supabase Edge Functions cron, or Render cron job.

## 6. WhatsApp confirmation

Current MVP behavior:

- After booking, the client sees a WhatsApp button with a pre-filled confirmation message.

Production options:

### Option A — Simple and cheap
Keep the current WhatsApp deep link. The client taps the button and sends the message manually.

### Option B — Automated
Use WhatsApp Cloud API or Twilio WhatsApp.

Flow:

1. Client creates booking.
2. Backend validates slot.
3. Backend creates appointment.
4. Backend sends approved WhatsApp template to client.
5. Backend sends admin notification.

## 7. Google Maps

Current MVP behavior:

- Direct Google Maps link from the config.

Production enhancement:

- Use a Google Maps Place ID link.
- Optional embed on the location section.

## 8. Instagram / TikTok

Current MVP behavior:

- Social links open Instagram and TikTok.
- Admin can save post/caption ideas and upload images.

Production options:

- Manual workflow: admin copies caption and posts from phone.
- Semi-automated workflow: Make/Zapier/n8n watches new post records and sends reminders.
- Full automation: Meta Graph API for Instagram Business publishing. TikTok posting requires a supported API/app review depending on account type and region.

## 9. Payments or deposits

The salon currently uses deposits. Add this after the booking MVP works.

Recommended options in Mexico:

- Mercado Pago payment link
- Stripe Mexico
- Manual transfer proof upload

Flow:

1. Client picks service and time.
2. Client pays deposit.
3. Booking is created as `new` or `pending_payment`.
4. Admin confirms once payment is received.

## 10. Deployment

Fastest deployment choices:

- Render or Railway for this Node MVP
- Vercel if converted to Next.js
- Supabase for database/storage/auth

Minimum production environment variables:

```bash
ADMIN_EMAIL=...
ADMIN_PASSWORD=...
SITE_URL=...
GOOGLE_CALENDAR_WEBHOOK_URL=...
WHATSAPP_ADMIN_WEBHOOK_URL=...
WHATSAPP_ADMIN_PHONE=...
CLIENT_REMINDER_WEBHOOK_URL=...
CLIENT_REMINDER_HOURS=24,2
```

Use stronger session/auth before public launch.


## Client CRM data included in automation payloads

Version v6 adds client preference data to the appointment payloads so Make/Zapier/n8n/WhatsApp Cloud API can use it in messages and Google Calendar event descriptions.

Client profile fields:

- `clientEmail`
- `clientInstagram`
- `clientPreferences.styleChoice`
- `clientPreferences.colorChoice`
- `clientPreferences.drinkChoice`
- `clientPreferences.timePreference`
- `clientPreferences.allergies`
- `clientPreferences.notes`

Recommended production usage:

1. Send `clientPreferences` into Google Calendar event description.
2. Use `drinkChoice` and `timePreference` in staff preparation workflows.
3. Use `allergies` and `notes` only in internal/admin notifications, not public marketing messages.
4. Store all CRM fields in Supabase/Postgres and protect them with admin-only RLS.
