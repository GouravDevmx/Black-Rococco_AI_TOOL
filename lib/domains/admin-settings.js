const { writeDb } = require('../db');
const { json, readBody, safeString } = require('../helpers');

// Only overwrite a field the request ACTUALLY sent.
//
// This used to be written as `tagline: safeString(body.tagline, 200)`. When
// `body.tagline` was absent, safeString(undefined) returns '' — so the field was
// explicitly overwritten with an empty string, and the `...db.settings.brand`
// spread above it was defeated. A save that omitted any field silently WIPED it.
// It only appeared to work because the admin forms happened to post every field.
// Any malformed request, or any field added to the model later, would erase data.
function patch(body, key, current, max) {
  return Object.prototype.hasOwnProperty.call(body, key)
    ? safeString(body[key], max)
    : (current || '');
}

// Handles all of Admin → CONFIGURACIÓN saves.
// Each section (brand, contact, booking, config lists, hero images) is saved
// independently via the sub-path, so a failed save in one section never
// overwrites another.
async function handleAdminRoutes({ req, res, pathname, db, salonId }) {
  if (req.method === 'POST' && pathname === '/api/admin/settings/brand') {
    const body = await readBody(req);
    const brand = db.settings.brand || {};
    db.settings.brand = {
      ...brand,
      // The salon must always have a name; an empty one would break the header.
      name: safeString(body.name, 100) || brand.name,
      tagline: patch(body, 'tagline', brand.tagline, 200),
      heroTitle: patch(body, 'heroTitle', brand.heroTitle, 200),
      heroSubtitle: patch(body, 'heroSubtitle', brand.heroSubtitle, 200),
      specialties: patch(body, 'specialties', brand.specialties, 200),
      rating: patch(body, 'rating', brand.rating, 10),
      socialProof: patch(body, 'socialProof', brand.socialProof, 200),
      footer: patch(body, 'footer', brand.footer, 200)
    };
    await writeDb(db, salonId);
    json(res, 200, { ok: true, brand: db.settings.brand });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/admin/settings/contact') {
    const body = await readBody(req);
    const contact = db.settings.contact || {};
    const nextWhatsapp = patch(body, 'whatsappNumber', contact.whatsappNumber, 30);
    db.settings.contact = {
      ...contact,
      address1: patch(body, 'address1', contact.address1, 200),
      address2: patch(body, 'address2', contact.address2, 200),
      hours1: patch(body, 'hours1', contact.hours1, 100),
      hours2: patch(body, 'hours2', contact.hours2, 100),
      whatsappNumber: nextWhatsapp,
      whatsappUrl: nextWhatsapp
        ? `https://api.whatsapp.com/send/?phone=${nextWhatsapp.replace(/\D/g, '')}`
        : (contact.whatsappUrl || ''),
      mapsUrl: patch(body, 'mapsUrl', contact.mapsUrl, 500),
      instagramUrl: patch(body, 'instagramUrl', contact.instagramUrl, 500),
      instagramHandle: patch(body, 'instagramHandle', contact.instagramHandle, 80),
      tiktokUrl: patch(body, 'tiktokUrl', contact.tiktokUrl, 500),
      // Was referenced by the homepage social section but never persisted here,
      // so the Facebook link was stuck on a hardcoded URL and could not be changed.
      facebookUrl: patch(body, 'facebookUrl', contact.facebookUrl, 500)
    };
    await writeDb(db, salonId);
    json(res, 200, { ok: true, contact: db.settings.contact });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/admin/settings/booking') {
    const body = await readBody(req);
    const booking = db.settings.booking || {};
    db.settings.booking = {
      ...booking,
      times: Array.isArray(body.times)
        ? body.times.filter(t => /^\d{2}:\d{2}$/.test(t)).slice(0, 24)
        : booking.times,
      confirmNote: patch(body, 'confirmNote', booking.confirmNote, 600)
    };
    await writeDb(db, salonId);
    json(res, 200, { ok: true, booking: db.settings.booking });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/admin/settings/config') {
    const body = await readBody(req);
    const parseList = (v) => Array.isArray(v) ? v.map(s => safeString(s, 80)).filter(Boolean) : (typeof v === 'string' ? v.split(',').map(s => s.trim()).filter(Boolean) : null);
    db.settings.config = {
      ...db.settings.config,
      whatsappNumber: safeString(body.whatsappNumber, 30) || db.settings.config.whatsappNumber,
      colors: parseList(body.colors) || db.settings.config.colors,
      bebidas: parseList(body.bebidas) || db.settings.config.bebidas,
      estilos: parseList(body.estilos) || db.settings.config.estilos,
      serviceCategories: parseList(body.serviceCategories) || db.settings.config.serviceCategories,
      galleryCategories: parseList(body.galleryCategories) || db.settings.config.galleryCategories
    };
    // Keep contact.whatsappNumber in sync
    if (body.whatsappNumber) db.settings.contact = { ...db.settings.contact, whatsappNumber: db.settings.config.whatsappNumber };
    await writeDb(db, salonId);
    json(res, 200, { ok: true, config: db.settings.config });
    return true;
  }

  // About Us: title, text and up to 6 images. Lives in the salon_config JSONB
  // column, so it needs no schema migration.
  if (req.method === 'POST' && pathname === '/api/admin/settings/about-us') {
    const body = await readBody(req);
    const images = Array.isArray(body.images)
      ? body.images.map(url => safeString(url, 1000)).filter(Boolean).slice(0, 6)
      : [];
    db.settings.config = {
      ...db.settings.config,
      aboutUs: {
        title: safeString(body.title, 120) || 'Sobre Nosotros',
        text: safeString(body.text, 2000),
        images
      }
    };
    await writeDb(db, salonId);
    json(res, 200, { ok: true, aboutUs: db.settings.config.aboutUs });
    return true;
  }

  // ── Homepage content: every user-facing section on the landing page ──
  // Stored as db.settings.config.homepage so the public /api/config endpoint
  // returns it inside salonConfig without any schema migration.
  if (req.method === 'POST' && pathname === '/api/admin/settings/homepage') {
    const body = await readBody(req);
    const s = (v, max = 300) => safeString(v, max);
    const arr = (v, mapFn) => Array.isArray(v) ? v.slice(0, 20).map(mapFn).filter(Boolean) : null;

    const hero = body.hero || {};
    const socialProof = body.socialProof || {};
    const servicesSection = body.servicesSection || {};
    const whyUs = body.whyUs || {};
    const experience = body.experience || {};
    const gallery = body.gallerySection || {};
    const contactCta = body.contactCta || {};
    const footer = body.footer || {};

    db.settings.config = {
      ...db.settings.config,
      homepage: {
        hero: {
          eyebrow: s(hero.eyebrow, 200),
          headline: s(hero.headline, 300),
          lead: s(hero.lead, 600),
          ctaPrimary: s(hero.ctaPrimary, 60),
          ctaSecondary: s(hero.ctaSecondary, 60)
        },
        trustPills: arr(body.trustPills, p => ({
          icon: s(p.icon, 4),
          text: s(p.text, 100)
        })) || (db.settings.config?.homepage?.trustPills || []),
        socialProof: {
          eyebrow: s(socialProof.eyebrow, 120),
          stats: arr(socialProof.stats, st => ({
            figure: s(st.figure, 20),
            label: s(st.label, 80)
          })) || (db.settings.config?.homepage?.socialProof?.stats || [])
        },
        testimonials: arr(body.testimonials, t => ({
          text: s(t.text, 500),
          author: s(t.author, 60),
          role: s(t.role, 60)
        })) || (db.settings.config?.homepage?.testimonials || []),
        servicesSection: {
          eyebrow: s(servicesSection.eyebrow, 120),
          title: s(servicesSection.title, 200),
          subtitle: s(servicesSection.subtitle, 400),
          ctaText: s(servicesSection.ctaText, 60)
        },
        whyUs: {
          eyebrow: s(whyUs.eyebrow, 120),
          title: s(whyUs.title, 200),
          lead: s(whyUs.lead, 600),
          ctaText: s(whyUs.ctaText, 60),
          items: arr(whyUs.items, it => ({
            title: s(it.title, 120),
            text: s(it.text, 400)
          })) || (db.settings.config?.homepage?.whyUs?.items || [])
        },
        experience: {
          eyebrow: s(experience.eyebrow, 120),
          title: s(experience.title, 200),
          steps: arr(experience.steps, st => ({
            num: s(st.num, 4),
            name: s(st.name, 40),
            text: s(st.text, 300)
          })) || (db.settings.config?.homepage?.experience?.steps || [])
        },
        gallerySection: {
          eyebrow: s(gallery.eyebrow, 120),
          title: s(gallery.title, 200),
          ctaText: s(gallery.ctaText, 60)
        },
        contactCta: {
          eyebrow: s(contactCta.eyebrow, 120),
          title: s(contactCta.title, 200),
          subtitle: s(contactCta.subtitle, 300),
          ctaPrimary: s(contactCta.ctaPrimary, 60),
          ctaSecondary: s(contactCta.ctaSecondary, 60)
        },
        footer: {
          description: s(footer.description, 400)
        },
        whatsappMessage: s(body.whatsappMessage, 300)
      }
    };
    await writeDb(db, salonId);
    json(res, 200, { ok: true, homepage: db.settings.config.homepage });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/admin/settings/hero-images') {
    const body = await readBody(req);
    const images = Array.isArray(body.images) ? body.images.slice(0, 10).map(img => ({
      url: safeString(img.url, 1000),
      title: safeString(img.title, 200),
      subtitle: safeString(img.subtitle, 200)
    })).filter(img => img.url) : [];
    db.settings.config = { ...db.settings.config, heroImages: images };
    await writeDb(db, salonId);
    json(res, 200, { ok: true, heroImages: images });
    return true;
  }

  return false;
}

module.exports = { handleAdminRoutes };
