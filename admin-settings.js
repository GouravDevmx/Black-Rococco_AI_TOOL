const { publicAppointment } = require('./appointments');
const { clientWithStats } = require('./clients');
const { json, safeString, todayYmd } = require('../helpers');
const {
  GOOGLE_CALENDAR_WEBHOOK_URL, WHATSAPP_ADMIN_WEBHOOK_URL,
  CLIENT_REMINDER_WEBHOOK_URL, CLIENT_REMINDER_HOURS
} = require('../config');

function statsForDate(db, date) {
  const appointments = db.appointments
    .filter(a => a.date === date)
    .map(a => publicAppointment(db, a))
    .sort((a, b) => a.time.localeCompare(b.time));
  const estimatedIncome = appointments
    .filter(a => a.status !== 'cancelled')
    .reduce((sum, a) => sum + Number(a.servicePrice || 0), 0);
  const completedIncome = appointments
    .filter(a => a.status === 'completed')
    .reduce((sum, a) => sum + Number(a.servicePrice || 0), 0);
  return { appointments, estimatedIncome, completedIncome, count: appointments.length };
}

// The one big aggregation route the whole admin panel loads on open and
// after every mutation. If a number on the AGENDA overview looks wrong
// (income, counts), check statsForDate above; if a whole section of the
// admin panel is missing/stale, check what's included in the response below.
async function handleAdminRoutes({ req, res, pathname, url, db }) {
  if (req.method === 'GET' && pathname === '/api/admin/dashboard') {
    const date = safeString(url.searchParams.get('date') || todayYmd(), 20);
    const summary = statsForDate(db, date);
    json(res, 200, {
      date,
      ...summary,
      services: db.services.sort((a, b) => (a.sort || 0) - (b.sort || 0)),
      clients: db.clients.map(c => clientWithStats(db, c)).sort((a, b) => String(b.lastVisit || '').localeCompare(String(a.lastVisit || ''))),
      posts: db.posts.slice().sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
      notifications: db.notifications.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 80),
      unreadNotifications: db.notifications.filter(n => n.unread).length,
      promotions: db.promotions.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      courses: db.courses.slice().sort((a, b) => (a.sort || 0) - (b.sort || 0)),
      courseRegistrations: db.courseRegistrations.slice()
        .map(r => ({ ...r, courseTitle: db.courses.find(c => c.id === r.courseId)?.title || 'Curso eliminado' }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      media: db.media.slice().sort((a, b) => (a.order || 0) - (b.order || 0)),
      staff: (db.staff || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0)),
      // Consultation photos, grouped by client, so the client profile screen can
      // render them without an extra round-trip. Admin-only payload.
      clientPhotos: (db.clientPhotos || []).slice()
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))),
      aboutUs: db.settings.config?.aboutUs || { title: 'Sobre Nosotros', text: '', images: [] },
      featuredServiceIds: db.settings.featuredServiceIds || [],
      blogPosts: (db.blogPosts || []).slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      integrations: {
        googleCalendarConfigured: Boolean(GOOGLE_CALENDAR_WEBHOOK_URL),
        whatsappAdminConfigured: Boolean(WHATSAPP_ADMIN_WEBHOOK_URL),
        clientReminderConfigured: Boolean(CLIENT_REMINDER_WEBHOOK_URL),
        reminderHours: CLIENT_REMINDER_HOURS
      }
    });
    return true;
  }
  return false;
}

module.exports = { statsForDate, handleAdminRoutes };
