# Full Functionality Reference

Everything the platform does today, organized the way a user guide would be:
by who's using it (client vs. salon owner/staff) and by screen/section. Use
this as the source material for a formatted manual — the structure below
(section → sub-feature → behavior) maps directly to how a help doc's table
of contents would look.

---

## Part 1 — Client-Facing Website

### 1.1 Homepage
- Hero section with the salon's name, tagline, and headline
- "X horarios libres hoy" live urgency indicator (counts real open slots for today)
- **Resultados reales** — a horizontally scrolling photo/video carousel of the salon's work (admin-controlled; shows a friendly placeholder if the salon hasn't uploaded anything yet)
- **Servicios destacados** — an auto-scrolling, continuously looping carousel of the salon's chosen "featured" services, each showing a photo (if set), name, description, and live price; pauses on hover/touch
- Active promotion banner (shows automatically if the salon has an auto-apply promotion running)
- "Black Rococo Academy" teaser card linking to the Courses section (only shown if at least one course exists)
- Address, hours, map link, Instagram/TikTok links
- Bottom navigation: Inicio, Servicios, Reservar, Academia, Galería

### 1.2 Services (Servicios)
- Full list of active services grouped by category
- Tapping a service opens a popup with: photo (if set), full description, duration, current price — including any live discount — and a "Reservar este servicio" button
- Prices show a strikethrough original price + discounted price when a promotion applies

### 1.3 Booking flow (Reservar)
- **Step 1 — choose a service**: same list as the Services screen
- **Step 2 — choose date & time**: calendar date picker plus quick day chips; time slots shown as available/occupied based on real existing bookings and the service's duration (no manual conflict-checking needed)
- **Step 3 — confirm**: name, WhatsApp number, optional style/color/drink/time preferences, optional allergy/care notes, optional promo code field (price updates live if valid)
- On submit: the appointment is created, a folio (e.g. `BR-1003`) is generated, and the client sees a confirmation screen with:
  - A pre-filled WhatsApp message to send the salon confirming the booking
  - A "add to Google Calendar" link with all details pre-filled
  - The final price (showing the discount applied, if any)
- Double-booking a slot is rejected with a clear message, even if two people try at the same instant (enforced at the database level in SaaS mode)

### 1.4 Galería (Gallery)
- Masonry-style photo/video grid — natural image proportions, no forced cropping
- Category filter chips (e.g. "Manicure Ruso", "Poligel") when the salon has tagged photos
- "Cargar más" (load more) instead of an arbitrary cutoff
- Tap any photo/video to open a full-screen viewer with next/prev arrows, a counter, and swipe navigation on touch devices
- Hover (desktop) or persistent label (touch) shows each photo's title/caption

### 1.5 Academia (Courses/Workshops)
- List of active courses: title, description, price, duration, level, capacity, next start date, and a photo carousel if the salon uploaded multiple photos
- "Inscribirme" opens a short registration form (name, WhatsApp, optional email/notes)
- On submit: a pre-filled WhatsApp message to confirm the registration, plus a note that the salon will follow up

---

## Part 2 — Admin Panel (Salon Owner / Staff)

Reached via the same site URL with `#admin` appended. Requires login.

### 2.1 Login
- Email + password
- In multi-tenant (SaaS) mode: each salon has its own login, completely isolated — a login for one salon cannot access another salon's admin panel, even by mistake
- Session persists for a set period, then requires logging in again

### 2.2 Agenda (today's appointments)
- Every appointment for the selected date: client name, service, time, status, price
- One-click status progression: Nueva → Confirmada → En curso → Completada (or Cancelada at any point)
- Running totals for the day: estimated income (all non-cancelled bookings) and completed income (only finished appointments)
- Per-appointment quick actions: open WhatsApp with a pre-filled message to the client, add to Google Calendar, view client preferences captured at booking

### 2.3 Notificaciones
- A feed of everything that's happened: new bookings, course registrations, and (if configured) webhook delivery status for Google Calendar / WhatsApp / client reminder integrations
- Mark one or all as read
- If a webhook integration isn't configured yet, notifications say so explicitly and offer a manual fallback link instead of failing silently

### 2.4 Servicios (Services)
- Full list with price, duration, category, active/paused toggle
- Create/edit a service: name, category (free text, autocompletes from existing categories), description, price, duration, display order, optional photo
- Delete a service
- "Destacado" toggle — controls whether it appears in the homepage's auto-scrolling carousel (independent of active/paused status)

### 2.5 Promociones (Promotions)
- Create a discount: percentage or fixed amount
- Scope it to all services, one category, or specific services
- Optional promo code (leave blank for "auto-apply," shown as a banner and reflected in prices automatically) or set a code clients must type at checkout
- Optional start/end date window and a usage limit (0 = unlimited)
- Edit or delete any promotion; toggle active/inactive without deleting
- Usage count tracked automatically as clients book with it

### 2.6 Clientas (CRM)
- Every client who has ever booked, searchable, sorted by most recent visit
- Per-client profile: full visit history, next upcoming appointment, last completed appointment, total lifetime spend, favorite service (most-booked), and every preference captured at booking (style, color, drink, time preference, allergies, notes)
- Edit a client's profile directly (name, WhatsApp, email, Instagram, birthday, preferences)
- Duplicate-WhatsApp protection — can't save a profile with a phone number already used by another client

### 2.7 Academia (Courses admin)
- Create/edit/delete courses: title, description, price, duration, level, capacity, next start date, up to 12 photos per course (upload multiple, remove individually, preview before saving)
- Toggle active/inactive
- View every registration with the registrant's contact info and notes, plus a one-click WhatsApp follow-up link
- Update a registration's status: new / confirmed / cancelled

### 2.8 Galería (Media admin)
- Upload a photo, GIF, or short video (up to 25MB for video)
- Set title/caption, description, category tag, numeric display order
- Two independent toggles: show in the homepage carousel, show in the public gallery (an item can be in one, the other, both, or neither)
- Edit or delete any item; the admin list shows thumbnails of everything at a glance

### 2.9 Publicar (legacy quick post log)
- A simple caption + photo + target-platform (Instagram/TikTok) log, mainly kept for backward compatibility with the gallery's fallback display

---

## Part 3 — Behind the Scenes (worth knowing, not necessarily in the manual)

### 3.1 Multi-tenancy
- One deployed app can serve any number of salons
- Each request is matched to a salon by subdomain, a `?salon=slug` URL parameter, or an `X-Salon-Slug` header
- Every piece of data (services, clients, bookings, promotions, courses, media, notifications) is fully isolated per salon

### 3.2 Automations (all optional, all degrade gracefully if unset)
- **Google Calendar**: either a one-click "add to calendar" link (always available) or a fully automatic event creation via a configured webhook (Make/Zapier/n8n/custom)
- **WhatsApp to admin**: either a one-click pre-filled message link (always available) or fully automatic delivery via a configured webhook
- **Client reminders**: scheduled automatically at 24h and 2h before an appointment (configurable), either as a manual one-click WhatsApp link or fully automatic via webhook
- **Generic booking webhook**: fires a full JSON payload of every new booking to any URL you configure, for custom integrations

### 3.3 Security
- Passwords are hashed (never stored in plain text)
- Admin sessions are cryptographically signed and scoped to one salon each
- All database access happens through a trusted server-side key — no direct public access to the database is possible
- A real database constraint (not just app logic) makes it structurally impossible to double-book the same slot

### 3.4 What doesn't exist yet (don't document these as available)
- Payment processing / deposits
- Multiple staff logins per salon (one login per salon today)
- Multi-technician scheduling (one shared calendar per salon)
- Self-service salon signup (currently provisioned manually)
- Password reset flow (a new password currently requires re-running the admin-creation script)
