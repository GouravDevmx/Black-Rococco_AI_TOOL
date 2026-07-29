const { publicAppointment } = require('./appointments');
const { clientWithStats } = require('./clients');
const { json, safeString, todayYmd } = require('../helpers');
const {
  GOOGLE_CALENDAR_WEBHOOK_URL, WHATSAPP_ADMIN_WEBHOOK_URL,
  CLIENT_REMINDER_WEBHOOK_URL, CLIENT_REMINDER_HOURS, BIRTHDAY_WEBHOOK_URL
} = require('../config');

function statsForDate(db, date) {
  const appointments = db.appointments
    .filter(a => a.date === date)
    .map(a => publicAppointment(db, a))
    .sort((a, b) => a.time.localeCompare(b.time));
  const estimatedIncome = appointments
    .filter(a => !['cancelled', 'deleted'].includes(a.status))
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
      // Reminder config so the RECORDATORIOS screen can edit it in place.
      settings: { reminders: db.settings.reminders || {} },
      blogPosts: (db.blogPosts || []).slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      // Reminder effectiveness — the number that tells the salon whether
      // reminders are worth their cost.
      reminderStats: (() => {
        const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const recent = db.appointments.filter(a => new Date(a.createdAt).getTime() >= since);
        const sent = recent.filter(a => Object.keys(a.remindersSent || {}).length > 0).length;
        const confirmed = recent.filter(a => a.clientConfirmedAt).length;
        const missingContact = db.clients.filter(c => String(c.whatsapp || '').replace(/\D/g, '').length < 10).length;
        return {
          sent, confirmed,
          rate: sent ? Math.round((confirmed / sent) * 100) + '%' : '0%',
          missingContact
        };
      })(),
      integrations: {
        googleCalendarConfigured: Boolean(GOOGLE_CALENDAR_WEBHOOK_URL),
        whatsappAdminConfigured: Boolean(WHATSAPP_ADMIN_WEBHOOK_URL),
        clientReminderConfigured: Boolean(CLIENT_REMINDER_WEBHOOK_URL),
        birthdayConfigured: Boolean(BIRTHDAY_WEBHOOK_URL),
        reminderHours: CLIENT_REMINDER_HOURS
      }
    });
    return true;
  }
  return false;
}

module.exports = { statsForDate, handleAdminRoutes };
