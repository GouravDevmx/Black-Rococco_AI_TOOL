# Architecture & where to fix things

The codebase is split by feature so a bug report or change request can point
at **one file** instead of needing the whole project read into context.
`server.js` itself is a thin ~150-line bootstrap — it should almost never
need editing for a feature change.

## "I want to fix/change X" → edit this file

| If it's about... | Edit this file |
|---|---|
| Services list, prices, categories, featured/carousel toggle | `lib/domains/services.js` |
| Promo codes, discounts, auto-apply rules | `lib/domains/promotions.js` |
| Courses, Academy, course registrations | `lib/domains/courses.js` |
| Gallery photos/videos, carousel, categories | `lib/domains/media.js` |
| Client profiles, preferences, CRM stats | `lib/domains/clients.js` |
| Booking flow, available time slots, double-booking | `lib/domains/bookings.js` |
| Availability/overlap math specifically | `lib/domains/availability.js` |
| Admin notifications, webhook delivery, client reminders | `lib/domains/notifications.js` |
| Google Calendar auto-sync (connect, create/delete events) | `lib/domains/google-calendar.js`, `lib/googleCalendarClient.js` |
| WhatsApp message wording, Google Calendar links (manual/one-click) | `lib/domains/whatsapp.js` |
| What an appointment "looks like" in API responses | `lib/domains/appointments.js` |
| Admin dashboard numbers/aggregation | `lib/domains/admin-dashboard.js` |
| Admin login, sessions | `lib/domains/admin-auth.js` |
| File/photo uploads | `lib/domains/admin-uploads.js` |
| Legacy "Publicar" quick social post log | `lib/domains/posts.js` |
| Public `/api/config` response shape | `lib/domains/public-config.js` |
| Which salon this deployment serves (resolved once at boot) | `lib/tenant.js` |
| Supabase vs local-JSON storage switch | `lib/store.js` (Supabase queries), `lib/db.js` (glue), `lib/migrate.js` (shape normalization/defaults) |
| Password hashing, OAuth state signing | `lib/auth.js` |
| Env vars / feature flags | `lib/config.js` |
| Generic string/date/phone validation, JSON response helpers | `lib/helpers.js` |
| Client-side UI (any screen, any admin tab) | `public/app.js` (not yet split — see note below) |
| Visual styling | `public/styles.css` |

## Single-salon, not multi-tenant

This app serves **one salon** (Black Rococo). Earlier drafts explored a
multi-tenant architecture (many salons on one deployment, resolved per
request) — that was deliberately rolled back in favor of a simpler, more
robust single-salon design once real bugs surfaced under that complexity.
If multi-salon support is ever needed again, `lib/tenant.js`'s
`getSalonBySlug()` and the `salon_id` columns throughout `sql/schema.sql`
are still there as a foundation, but nothing in the current request path
resolves a salon per-request anymore — it's resolved once at server boot.

## How a request flows through the code

1. `server.js` receives the HTTP request and loads the (single, fixed)
   salon's data via `lib/db.js`.
2. It hands the request to whichever `lib/domains/*.js` module's
   `handlePublicRoutes` or `handleAdminRoutes` function claims it (each
   returns `true` if it handled the request, `false` to let the next module
   try — this is why `server.js` doesn't need per-route logic itself).
3. That module does its business logic (reading/mutating the in-memory
   `db` object using the same shape the app has always used) and writes
   the JSON response.
4. If anything changed, `lib/db.js`'s `writeDb()` persists it — to
   `data/db.json` locally, or to the real Supabase tables if configured.

## Cross-module dependencies (for when a fix touches more than one file)

Rough dependency order, lowest-level first — a file only needs to know
about files above it in this list:

```
helpers.js, config.js
  -> services.js
    -> availability.js, promotions.js
      -> clients.js
        -> whatsapp.js
          -> appointments.js
            -> notifications.js, admin-dashboard.js, bookings.js
```

`clients.js`'s `clientWithStats()` needs `appointments.js`'s
`publicAppointment()`, but `appointments.js` needs `clients.js`'s
`getClient()` — this one circular-looking dependency is resolved with a
lazy `require()` inside the function body (see the comment in
`clients.js`). You shouldn't need to introduce another one of these; if a
fix seems to need it, it's a sign the function belongs in a different file.

## What's NOT split yet, on purpose

`public/app.js` (~1800 lines) is still one file. Splitting a browser-side,
no-build-step, no-bundler SPA into modules would require either adding a
bundler (a real new dependency/build step) or juggling multiple `<script>`
tags with manually-managed load order and shared global state — both add
real complexity for a codebase that intentionally has zero build tooling.
If this becomes painful, the next step would be introducing esbuild (one
dev dependency, no runtime dependency) purely to bundle `public/app.js`
from multiple source files — worth doing once the frontend grows
significantly further, not before.
