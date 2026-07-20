const { groupedServices } = require('./services');
const { activePromotions, publicPromotion } = require('./promotions');
const { REQUIRE_BOOKING_VERIFICATION } = require('./verify');
const { publicMedia } = require('./media');
const { publicStaff } = require('./staff');
const { publicSettings } = require('./posts');
const { publicBlogPosts } = require('./blogs');
const { json, todayYmd } = require('../helpers');

async function handlePublicRoutes({ req, res, pathname, db }) {
  if (req.method === 'GET' && pathname === '/api/config') {
    // Two promo channels, deliberately separate:
    //  - `promotions`: auto-apply, codeless — the client discounts prices with these.
    //  - `promoBanners`: EVERY active in-window promo (including code-based ones)
    //    for marketing display. A promo the admin configured must be visible
    //    to visitors even when it needs a code at checkout.
    const allActive = activePromotions(db).map(p => ({ ...publicPromotion(p), code: p.code || '' }));
    const promos = allActive.filter(p => p.autoApply && !p.code);
    json(res, 200, {
      settings: publicSettings(db),
      services: db.services.filter(s => s.active).sort((a, b) => (a.sort || 0) - (b.sort || 0)),
      groupedServices: groupedServices(db),
      promotions: promos,
      promoBanners: allActive,
      courses: db.courses.filter(c => c.active).sort((a, b) => (a.sort || 0) - (b.sort || 0)),
      media: publicMedia(db),
      staff: publicStaff(db),
      blogPosts: publicBlogPosts(db),
      salonConfig: db.settings.config || {},
      requireVerification: REQUIRE_BOOKING_VERIFICATION,
      today: todayYmd()
    });
    return true;
  }

  return false;
}

module.exports = { handlePublicRoutes };
