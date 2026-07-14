const { groupedServices } = require('./services');
const { activePromotions, publicPromotion } = require('./promotions');
const { publicMedia } = require('./media');
const { publicStaff } = require('./staff');
const { publicSettings } = require('./posts');
const { json, todayYmd } = require('../helpers');

async function handlePublicRoutes({ req, res, pathname, db }) {
  if (req.method === 'GET' && pathname === '/api/config') {
    const promos = activePromotions(db).filter(p => p.autoApply && !p.code).map(publicPromotion);
    json(res, 200, {
      settings: publicSettings(db),
      services: db.services.filter(s => s.active).sort((a, b) => (a.sort || 0) - (b.sort || 0)),
      groupedServices: groupedServices(db),
      promotions: promos,
      courses: db.courses.filter(c => c.active).sort((a, b) => (a.sort || 0) - (b.sort || 0)),
      media: publicMedia(db),
      staff: publicStaff(db),
      // NOTE: client consultation photos are deliberately NOT included here.
      // They are photos of identifiable clients and are admin-only by design.
      // salonConfig carries aboutUs (title/text/images) for the public site.
      salonConfig: db.settings.config || {},
      today: todayYmd()
    });
    return true;
  }

  return false;
}

module.exports = { handlePublicRoutes };
