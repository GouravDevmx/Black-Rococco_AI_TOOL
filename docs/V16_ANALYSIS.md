# Black Rococo v16 — Full Homepage Configurability

## Problem Statement

The user-facing homepage had **~35 hardcoded Spanish strings** embedded directly in `app.js`.
Even though the admin panel (CONFIGURACIÓN tab) existed, the homepage content was not wired to it.
The admin could change brand name and contact info, but every headline, stat, testimonial,
differentiator, process step, and CTA button label was baked into the JavaScript and could not
be changed without a code deploy.

---

## Audit: What Was Hardcoded vs Configurable

### Previously Configurable (already working)
- Brand name, tagline, rating, social proof text, footer text → Admin > CONFIGURACIÓN > MARCA
- Contact info (address, WhatsApp, social URLs) → Admin > CONFIGURACIÓN > CONTACTO
- Booking times and confirmation note → Admin > CONFIGURACIÓN > HORARIOS
- Preference lists (colors, drinks, styles, categories) → Admin > CONFIGURACIÓN > LISTAS
- Hero images (with a sync bug) → Admin > CONFIGURACIÓN > FOTO PRINCIPAL
- About Us text and images → Admin > CONFIGURACIÓN > SOBRE NOSOTROS
- Services, promotions, courses, gallery, staff, posts → Dedicated admin tabs

### Previously Hardcoded (NOW configurable in v16)

| # | Section | Hardcoded Content | Admin Field |
|---|---------|-------------------|-------------|
| 1 | Hero eyebrow | "Estudio de uñas de lujo · Guadalajara" | hero.eyebrow |
| 2 | Hero headline | "Donde la elegancia se encuentra con el arte" | hero.headline |
| 3 | Hero paragraph | "Black Rococo es un atelier de uñas en Ciudad Granja..." | hero.lead |
| 4 | Hero CTA primary | "Reservar mi cita" | hero.ctaPrimary |
| 5 | Hero CTA secondary | "Ver nuestro trabajo" | hero.ctaSecondary |
| 6 | Trust pill 1 | "★ 4.9 en Google" | trustPills[0] |
| 7 | Trust pill 2 | "◇ Materiales premium" | trustPills[1] |
| 8 | Trust pill 3 | "✧ Técnicas certificadas" | trustPills[2] |
| 9 | Social proof eyebrow | "La confianza se gana" | socialProof.eyebrow |
| 10 | Stat: +500 Clientas | hardcoded figure + label | socialProof.stats[0] |
| 11 | Stat: 6 Años | hardcoded figure + label | socialProof.stats[1] |
| 12 | Stat: 3–4 Semanas | hardcoded figure + label | socialProof.stats[2] |
| 13 | Testimonial 1 | "La atención al detalle..." — María G. | testimonials[0] |
| 14 | Testimonial 2 | "Mis uñas para la boda..." — Ana L. | testimonials[1] |
| 15 | Testimonial 3 | "Después de probar varios..." — Sofía R. | testimonials[2] |
| 16 | Services section eyebrow | "Servicios insignia" | servicesSection.eyebrow |
| 17 | Services section title | "Tres técnicas que definen la casa" | servicesSection.title |
| 18 | Services section subtitle | "Cada servicio se realiza con instrumental..." | servicesSection.subtitle |
| 19 | Services CTA | "Ver la carta completa" | servicesSection.ctaText |
| 20 | Why Us eyebrow | "Por qué Black Rococo" | whyUs.eyebrow |
| 21 | Why Us title | "Lo que justifica el precio" | whyUs.title |
| 22 | Why Us lead text | "No competimos por precio..." | whyUs.lead |
| 23 | Why Us item 1 | "Técnica rusa en seco" + description | whyUs.items[0] |
| 24 | Why Us item 2 | "Esterilización verificable" + description | whyUs.items[1] |
| 25 | Why Us item 3 | "Duración real de 3 a 4 semanas" + description | whyUs.items[2] |
| 26 | Why Us item 4 | "Una clienta a la vez" + description | whyUs.items[3] |
| 27 | Experience eyebrow | "La experiencia" | experience.eyebrow |
| 28 | Experience title | "Cómo funciona" | experience.title |
| 29 | Experience step 1-4 | All 4 steps hardcoded | experience.steps[] |
| 30 | Gallery eyebrow | "El trabajo" | gallerySection.eyebrow |
| 31 | Gallery title | "Resultados reales, sin retoque" | gallerySection.title |
| 32 | Gallery CTA | "Ver la galería completa" | gallerySection.ctaText |
| 33 | Contact eyebrow | "Reserva" | contactCta.eyebrow |
| 34 | Contact title | "La agenda es limitada por diseño" | contactCta.title |
| 35 | Contact subtitle | "Atendemos a una clienta a la vez..." | contactCta.subtitle |
| 36 | Contact CTA primary | "Reservar mi cita" | contactCta.ctaPrimary |
| 37 | Contact CTA secondary | "Escribir por WhatsApp" | contactCta.ctaSecondary |
| 38 | Footer description | "Atelier de uñas en Ciudad Granja..." | footer.description |
| 39 | WhatsApp default msg | "Hola Black Rococo, quiero información..." | whatsappMessage |

---

## Files Changed

### `public/app.js` (+301 lines)
- Added `adminHomepageEditor()` — full WYSIWYG-style admin UI with collapsible accordion sections
- Added `saveHomepage()` — persists homepage config via API
- Rewired `homeScreen()` — every string now reads from `state.salonConfig.homepage.*` with a sensible fallback
- Rewired `testimonialCarousel()` — reads from config
- Rewired `whatsappChatUrl()` — reads default message from config
- Added input/click handlers for homepage editor (dot-path fields, flat item lists, nested item lists)
- Added `state.admin.homepageDraft` to admin state for draft editing

### `lib/domains/admin-settings.js` (+60 lines)
- Added `POST /api/admin/settings/homepage` endpoint
- Validates and sanitizes all fields with `safeString()`
- Stores in `db.settings.config.homepage` (same JSONB column, no migration needed)

### `public/styles.css` (+32 lines)
- Added `.config-section` accordion styles (details/summary pattern)

---

## Architecture

All homepage content is stored as a single JSON object at `db.settings.config.homepage`.
The public `/api/config` endpoint already returns `db.settings.config` as `salonConfig`,
so no additional endpoint changes were needed for the user-facing side.

The admin editor uses `<details>/<summary>` elements as a lightweight accordion — no extra JS.
Each section is collapsible so the admin isn't overwhelmed by 35+ fields at once.

Repeatable items (trust pills, testimonials, stats, why-us differentiators, process steps)
use a generic item-list pattern with add/remove buttons, so the admin can have 2 testimonials
or 10, 3 stats or 6, etc.

All fields have **fallback defaults** matching the current hardcoded content, so the site
looks identical on first deploy before the admin has configured anything.

---

## Hero Image Sync Bug (pre-existing)

The known bug where hero images can desync between `configDraft` and `salonConfig` still
exists in the same form. The hero images are edited against `state.salonConfig` directly
(not `configDraft`) because they involve async file uploads that need immediate feedback.
The homepage content editor uses its own `homepageDraft` (separate from `configDraft`)
to avoid the same issue.

---

## Deployment Notes

- No database migration needed — homepage config uses the existing `config` JSONB column
- The existing hardcoded text serves as fallback defaults, so the site works immediately
- Admin should visit CONFIGURACIÓN tab and populate the homepage fields to take ownership of all content
