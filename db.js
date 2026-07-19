# Investor Demo Guide

A one-page pitch framing, a click-by-click demo script, and the technical
talking points to have ready for questions. Written to be read once before
a demo and glanced at during one.

---

## The pitch, in one breath

A booking + CRM + storefront platform for beauty businesses (nail salons,
makeup studios, lash bars, barbershops) — built so a salon owner can run
their entire client-facing presence and back-office operations from one
tool, with no other software needed. Live today with a working multi-tenant
backend: two independent pilot businesses (a nail salon and a makeup
studio) can run on the same infrastructure right now, each with their own
branding, services, clients, and admin login, completely isolated from
each other.

## The problem this solves

Small beauty businesses today are stitched together from: Instagram DMs for
booking, a paper book or a generic calendar app for scheduling, WhatsApp for
reminders, and nothing at all for client history/preferences (so "what
color did she get last time?" lives in someone's memory). They're
underserved by both ends of the market — generic scheduling tools (Calendly-
style) don't understand services/pricing/promos, and enterprise salon
software is expensive and built for big chains, not a solo studio.

## Who's using it right now

Two real pilot businesses, different verticals (nails, makeup), proving
the platform isn't just tailored to one salon's specific workflow.

---

## What it actually does

### For the client (the person booking)
- Browse services by category, see live pricing (including any active
  promotion), tap into a service for full details in a clean popup
- Book an appointment: pick a service, see real available time slots for a
  chosen date, fill in contact + preferences, confirm
- Optional promo code field at checkout — discounts apply automatically if
  eligible, or via a code
- Browse a photo/video gallery (masonry layout, category filters, full-
  screen lightbox viewer with swipe navigation)
- Browse and register interest in courses/workshops ("Black Rococo Academy")
- A homepage with an auto-scrolling "featured services" carousel and a
  real-photos carousel, both driven by what the salon uploads in admin

### For the salon owner (admin panel)
- **Agenda**: today's appointments, one-click status progression (new →
  confirmed → in progress → completed, or cancelled), running estimated/
  completed income for the day
- **Clientas (CRM)**: every client's full visit history, favorite service,
  total spend, preferences (style, color, drink, allergies) — captured
  once at booking, remembered forever
- **Servicios**: full CRUD on services — name, price, duration, category,
  photo, and a "featured" toggle that controls the homepage carousel
- **Promociones**: create percentage or fixed discounts, scope them to all
  services / a category / specific services, optional promo codes, date
  windows, usage limits — the storefront reflects these live
- **Academia**: manage courses/workshops with multi-photo galleries and
  track registrations
- **Galería**: upload photos or short videos, tag by category, choose
  whether each appears in the gallery, the homepage carousel, or both
- **Notificaciones**: every new booking raises admin notifications, with
  ready-to-send WhatsApp deep links and one-click Google Calendar event
  creation — no typing required
- **Publicar**: quick social-post logging that feeds the gallery

---

## Live demo script (~6–8 minutes)

**1. Cold open — the storefront (60 sec)**
Load the homepage. Point out: real-time "X horarios libres hoy" urgency
messaging, the auto-scrolling services carousel (let it scroll a moment,
hover to show it pauses), the promo banner if one's active.

**2. Book as a client (90 sec)**
Tap a service → shows full detail popup with live price. Go to Reservar →
pick a date → show real availability (already-booked slots greyed out) →
fill name/WhatsApp → optionally type a promo code and watch the price
update → confirm. Show the confirmation screen with the WhatsApp and
Calendar buttons.

**3. Switch to admin — the booking just appeared (60 sec)**
Open the admin panel, log in. Land on Agenda — the booking you just made is
there, in real time. Click through the status stages once.

**4. The CRM payoff (60 sec)**
Go to Clientas, open the client you just created. Show visit history,
preferences captured from the booking form, total spend tracker — "this is
the thing Instagram DMs can never give you."

**5. Promotions engine (60 sec)**
Go to Promociones, create a 15%-off promo scoped to one category, mark it
auto-apply. Flip back to the storefront (or a new tab) and refresh — the
discount is already showing on eligible services, no deploy, no code.

**6. The SaaS proof — two salons, one platform (90 sec, the closer)**
This is the moment to slow down. Open the same deployed app with
`?salon=nails` vs `?salon=makeup` (or two subdomains, if configured) side
by side. Show: completely different branding, services, and photos. Log
into one salon's admin, then try the same login on the other salon's admin
— **it's rejected**. Say plainly: "This isn't two copies of the app running
side by side — it's one platform, one shared database, with real
tenant-level security enforced at the database and session layer. Onboarding
salon #3 tomorrow is a database entry, not a new deployment."

**7. Close**
"What you just saw is running on a real Postgres database with the same
guarantee a bank statement gets — double-booking a slot is prevented at
the database level, not just checked in application code, which matters
the moment two front-desk staff or two browser tabs try to book the same
slot at once."

---

## Technical foundation talking points (for the "how real is this" questions)

- **Real multi-tenant architecture, not a fork-per-customer.** One
  deployment, N salons, each resolved per request and fully isolated —
  proven by tests showing a session issued for Salon A is cryptographically
  rejected on Salon B's admin routes.
- **Real database guarantees, not app-level promises.** The double-booking
  prevention is a Postgres unique constraint — the database itself refuses
  a conflicting insert, even under concurrent requests. This was verified
  directly: booking the same slot twice in immediate succession returns a
  clean rejection on the second attempt, not a race-condition bug.
- **Security posture**: Row Level Security enabled on every table with zero
  public/anon access — only the server (holding a secret key never exposed
  to any browser) can touch the data. Passwords are hashed (scrypt), never
  stored in plaintext. Admin sessions are cryptographically signed and
  scoped to one salon each.
- **Modular, maintainable codebase.** The backend is organized by feature
  (services, promotions, bookings, clients, media, etc.), each in its own
  file — the kind of structure that lets a team move fast on one feature
  without risking another, and lets a new engineer ramp up on one module at
  a time instead of reading a monolith.
- **Lean by design.** Runs on plain Node.js with a minimal dependency
  footprint (one library for the database connection) — fast to deploy
  cheaply, easy to audit, nothing exotic to hire against.
- **Deployable today.** Ships with a working deployment guide (Railway +
  Supabase), a real seed/onboarding script for adding a new salon, and a
  tested checklist for verifying a new tenant end-to-end.

## Honest "what's next" (have this ready, don't wait to be asked)

- No self-service salon signup yet — onboarding is founder-run via a script
  today. That's the natural next build once there's demand beyond a
  hands-on pilot.
- One admin login per salon today — multi-staff logins with different
  permissions (front desk vs. owner) is a scoped, well-understood next
  feature, not a re-architecture.
- No billing/subscription layer yet — the data and auth foundation this
  would sit on top of is already built and tested.
- No multi-staff scheduling yet (one shared calendar per salon) — a real
  roadmap item, most relevant once a salon has multiple technicians who
  need independent calendars.

Framing all of this as "deliberately deferred, not missed" is the accurate
story: every one of these is a scoped feature to build on a proven
foundation, not a gap that threatens the architecture.
