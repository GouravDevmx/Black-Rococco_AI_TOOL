# Black Rococo Functional Website MVP

This is a runnable functional MVP built from the uploaded Black Rococo HTML handoff.

**Quick links:** [`ARCHITECTURE.md`](ARCHITECTURE.md) — what to edit for any given fix/feature · [`docs/INVESTOR_DEMO.md`](docs/INVESTOR_DEMO.md) — demo script and pitch talking points

It includes:

- Fully responsive client website for mobile, tablet, and desktop
- Services and prices from a persistent data file
- 3-step booking flow: service → date/time → confirm
- Real slot conflict validation based on service duration
- Reserved appointment times are shown as unavailable/occupied in the booking calendar
- Date picker support beyond the quick 7-day chips
- Booking folio generation such as `BR-1003`
- WhatsApp confirmation deep link
- Floating WhatsApp chat button for clients
- Google Maps, Instagram, and TikTok links
- Admin login
- Responsive admin dashboard with today's agenda
- Admin notification center with unread count for every new appointment
- Google Calendar action links and optional Google Calendar webhook integration
- WhatsApp Admin alert links and optional WhatsApp automation webhook
- Client appointment reminder queue with manual WhatsApp links and optional automatic reminder webhook
- Appointment status flow: NUEVA → CONFIRMADA → EN CURSO → COMPLETADA
- Service price update and pause/active toggle
- Client CRM with full profile, preferences, history, past services, next appointment, favorite service, and total completed spend
- Client-side preference capture during booking: style, color, drink, preferred time, allergies/care notes, and appointment note
- Admin can edit client profile details directly from the Clientas tab
- Admin image upload from phone/computer, stored under `public/uploads`
- Post/caption + image upload management placeholder for Instagram/TikTok automation
- Uploaded images appear in the public gallery
- SEO basics: title/meta description, Open Graph tags, local business JSON-LD, robots.txt, sitemap.xml, manifest and favicon
- Responsive breakpoints for phones, tablets, laptops, and large desktop screens
- Optional booking, Google Calendar, WhatsApp Admin, and client reminder webhooks for Make, Zapier, n8n, Twilio, WhatsApp Cloud API, or custom automation
- Discounts & Promotions engine: admin-configurable promo codes, seasonal discounts, and flash sales, with automatic banner display and automatic price adjustment on the client booking flow
- Black Rococo Academy: a Courses & Workshops section on the client site, with an admin backend to list/price/pause courses and manage student registrations

## Run locally

```bash
cd black_rococo_functional_site
node server.js
```

Open:

```text
http://localhost:3000
```

Admin:

```text
Email: admin@blackrococo.mx
Password: rococo2026
```

Change admin credentials before showing to a real client:

```bash
ADMIN_EMAIL="owner@example.com" ADMIN_PASSWORD="your-strong-password" node server.js
```

## Project structure

```text
black_rococo_functional_site/
├── server.js                    # Thin bootstrap: static files, tenant resolution, route dispatch
├── package.json
├── data/db.json                 # Local-mode database (used when Supabase isn't configured)
├── lib/
│   ├── config.js                 # Env vars / feature flags, read once
│   ├── helpers.js                 # Generic string/date/HTTP utilities
│   ├── db.js                       # readDb()/writeDb() glue
│   ├── store.js                     # Supabase table read/write + atomic booking insert
│   ├── migrate.js                    # Data shape normalization/defaults
│   ├── tenant.js                      # Which salon does this request belong to?
│   ├── auth.js                         # Password hashing + signed sessions
│   ├── supabaseClient.js                # The Supabase client (null in local mode)
│   ├── uploads.js                        # Supabase Storage uploads
│   ├── multipart.js                       # multipart/form-data parsing
│   └── domains/                            # One file per feature — see ARCHITECTURE.md
│       ├── services.js, promotions.js, courses.js, media.js, clients.js,
│       ├── bookings.js, availability.js, notifications.js, posts.js,
│       ├── admin-auth.js, admin-dashboard.js, admin-uploads.js,
│       └── whatsapp.js, appointments.js, public-config.js
├── scripts/
│   ├── seed-services.js         # Starter service catalog for a new salon
│   └── create-admin.js          # Provision a salon's admin login
├── sql/schema.sql               # Postgres schema (constraints, unique slot index)
├── public/
│   ├── index.html, styles.css, app.js   # Client + admin single-page app
│   ├── uploads/                          # Local-mode uploaded files
│   ├── robots.txt, sitemap.xml
└── docs/
    ├── INVESTOR_DEMO.md          # Pitch framing + demo script
    └── INTEGRATIONS.md           # Webhook/automation integration notes
```

See **[`ARCHITECTURE.md`](ARCHITECTURE.md)** for a full map of "if you want to fix/change X, edit this file."

## Responsive layout support

The site now adapts automatically by screen size:

- Mobile: compact single-column layout with bottom navigation.
- Tablet: wider shell, bigger hero/gallery, 3-column gallery, 4-column time slots.
- Desktop/laptop: full-width website container, fixed top navigation, larger hero, multi-column service grids, 4-column gallery, and wider admin dashboard.
- Large desktop: expanded max-width layout while keeping readable spacing.

## Storage: local file vs. real database

By default (`npm install && npm start`, no env vars) this runs entirely on
`data/db.json` — zero setup, good for local dev and demos. Setting
`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` switches the exact same
codebase to a real, persistent Postgres backend — see
`docs/DEPLOYMENT.md` for the full walkthrough
and [`sql/schema.sql`](sql/schema.sql) for the schema.

## Client CRM and profile history

The Admin Panel now includes a richer **CLIENTAS** area. For each client the admin can see and edit:

- Name, WhatsApp, email, Instagram and birthday
- Preferred nail style
- Preferred color
- Preferred drink
- Preferred appointment time
- Allergies/care notes
- Internal notes
- Full appointment history
- Previous services summary
- Next appointment
- Last appointment
- Favorite service
- Completed-spend total

When a client books online, optional profile details are saved automatically and reused in the admin panel, Google Calendar notes, WhatsApp Admin alert, and client reminder message.

## Notification and automation webhooks

The Admin Panel now gets an unread notification immediately when any new agenda/booking is created. Google Calendar, WhatsApp Admin alerts, and client reminders are also prepared through webhooks because they require authenticated external accounts.

Set these environment variables in Render/Railway or locally:

```bash
SITE_URL="https://your-public-test-url.onrender.com"
GOOGLE_CALENDAR_WEBHOOK_URL="https://hook.make.com/google-calendar-flow"
WHATSAPP_ADMIN_WEBHOOK_URL="https://hook.make.com/admin-whatsapp-flow"
WHATSAPP_ADMIN_PHONE="5213326553522"
CLIENT_REMINDER_WEBHOOK_URL="https://hook.make.com/client-reminder-flow"
CLIENT_REMINDER_HOURS="24,2"
```

Current MVP behavior if webhooks are not configured:

- Admin Panel still shows notifications.
- Admin can manually click **Google Calendar** to add the event.
- Admin can manually click **WhatsApp Admin** to send herself the booking alert.
- Admin can manually click **Recordar clienta** to send a reminder message to the client.

When the webhook variables are configured, the server sends payloads like:

```json
{
  "event": "booking.created",
  "appointment": {
    "folio": "BR-1003",
    "clientName": "...",
    "clientWhatsapp": "...",
    "serviceName": "...",
    "date": "2026-07-03",
    "time": "17:00"
  },
  "calendar": {
    "title": "Black Rococo - Manicure ruso - Clienta",
    "start": "2026-07-03T17:00:00",
    "end": "2026-07-03T18:00:00",
    "timeZone": "America/Mexico_City"
  },
  "whatsapp": {
    "adminPhone": "5213326553522",
    "adminMessageUrl": "https://api.whatsapp.com/send/...",
    "clientReminderUrl": "https://api.whatsapp.com/send/..."
  }
}
```

Client reminders run every 10 minutes while the server is awake. For guaranteed production reminders, use a real database and external cron/scheduler.

## Services: full CRUD

Under **Admin → SERVICIOS** you can now, in addition to pausing/pricing:

- **Create** a brand-new service (name, category, description, price, duration, display order, optional photo)
- **Edit** any existing service's details, category, or photo
- **Delete** a service entirely

## Client-side service details

On the **SERVICIOS** screen, tapping a service opens a **detail modal** (photo if set, full description, duration, live promo-adjusted price, and a "Reservar este servicio" button). This keeps the list itself compact while still surfacing full details on demand.

## Black Rococo Academy: multiple photos per course

Courses now support **multiple photos**. In **Admin → ACADEMIA**, upload several images per course; each shows as a removable thumbnail while editing. On the client-facing Academia screen, courses with more than one photo render as a **swipeable-style carousel** (prev/next arrows + dot indicators) so visitors can browse every photo. The admin course list also shows thumbnails of all uploaded photos per course.

All images (service photos, course photos, gallery images) use fixed aspect-ratio containers with `object-fit: cover`, so any uploaded photo — portrait, landscape, or square — is automatically cropped and sized consistently without distorting or breaking the layout.

## Production mode (Supabase-backed)

This app can run in two modes:

- **Local/demo mode** (default): stores everything in `data/db.json`. No setup needed — this is what you get with `npm install && npm start`.
- **Production mode**: set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` and the same codebase persists to Postgres instead of the local JSON file. This is a **single-salon product**: the one salon is resolved once at boot from `SALON_SLUG`, never per request. Double-booking is made structurally impossible by a database-level partial unique index on `(salon_id, appt_date, appt_time) WHERE status <> 'cancelled'`.

This is a **single-salon product**. The salon is resolved once at boot from `SALON_SLUG`; no request can select a different one. Run `sql/schema.sql`, then every file in `sql/migrations/` in order, then deploy to Railway with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set.

The schema is in `sql/schema.sql` (fully normalized tables, not a JSON blob — real foreign keys, indexes, and a unique index enforcing the double-booking guarantee). RLS is enabled on every table with no policies granted, so only your server's service-role key can read/write anything.

## Interactive Gallery, Carousel & Lightbox (media library)

A dedicated **media library** now powers all visual sections of the site (replacing the old static gallery list). Existing photos from the previous gallery settings and uploaded posts are automatically migrated in on first run — nothing is lost.

- **Admin → GALERÍA**: upload a photo, GIF, or short video (MP4/WEBM, up to 25 MB) with a title/caption, short description, category tag (e.g. "Manicure Ruso", "Poligel"), numeric display order, and independent toggles for **"Mostrar en carrusel de inicio"** and **"Mostrar en galería"** — so the same item can appear in one, the other, or both.
- **Homepage carousel ("Resultados reales")**: pulls from items flagged `showInCarousel`.
- **Gallery screen**: pulls from items flagged `showInGallery`, with **category filter chips**, a **CSS masonry grid** (variable-height photos, no forced cropping, tight gaps), and a **"Cargar más"** button instead of a hard cutoff (chosen over silent infinite-scroll for predictability).
- **Lightbox**: clicking any gallery or carousel photo/video opens a full-screen viewer with next/prev arrows, a counter, swipe-to-navigate on touch, and Escape/arrow-key support on desktop.
- **Hover/tap captions**: gallery tiles and service cards reveal a title + short description overlay on hover (desktop); on touch devices, since there's no true hover, the caption shows as a persistent bottom label and tapping opens the full lightbox/detail view instead.
- **"Servicios destacados" auto-carousel**: the homepage featured-services section is now a continuously auto-scrolling, looping strip (pauses on hover/touch, swipeable). Which services appear here is controlled by a new **"Destacado"** checkbox on each service in Admin → SERVICIOS (or the quick "Destacar" button in the list).

All of this is vanilla CSS/JS — no new dependencies were added; the server still requires zero npm packages.

## Discounts & Promotions engine

Under **Admin → PROMOCIONES** you can create:

- **Percentage or fixed-amount discounts**
- Scoped to **all services**, a **category** (MANOS/PIES/EXTRAS), or **specific services**
- **Auto-apply** promos (no code needed) automatically show as a homepage/booking banner and adjust the displayed and charged price
- **Code-based** promos (e.g. `VERANO15`) that clients type in at checkout — leave "Auto-aplicar" unchecked and set a code
- Optional **start/end dates** and a **usage limit** (0 = unlimited)

The booking API validates the promo server-side, computes the discount, and stores the original price, discount amount, and final price on the appointment, so admin reports and the client CRM always reflect what was actually charged.

## Black Rococo Academy (Courses & Workshops)

Under **Admin → ACADEMIA** you can create and manage courses (title, description, price, duration, level, capacity, next start date, optional photo). Active courses appear in a new **ACADEMIA** tab on the client site, where visitors can register interest in a course. Registrations show up in the same admin tab with WhatsApp follow-up links and confirm/cancel actions, and also raise an admin panel notification like a new booking does.

## What to connect next

1. Supabase Auth for admin accounts.
2. Supabase Postgres for services, appointments, clients, posts and settings.
3. Supabase Storage or Cloudinary for gallery and post images. Local uploads work for the demo but are not ideal for multi-admin production hosting.
4. WhatsApp Cloud API or Twilio WhatsApp for automatic admin alerts and client reminders.
5. Google Maps embed or Place ID link for location.
6. Meta/Instagram API or Make/Zapier if automatic publishing is required.
7. Vercel/Render/Fly.io deployment with environment variables.
8. External cron/scheduler for reminders if using free hosting that can sleep.


## Deploy for public testing

This version is deployment-ready for Render and Railway. Files added:

- `render.yaml`
- `railway.json`
- `Procfile`
- `.env.example`
- `DEPLOYMENT.md`

For the easiest public testing link, upload the project to GitHub and deploy it as a Render Web Service with:

- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/api/health`

The server uses `process.env.PORT`, so it works with cloud platforms.
