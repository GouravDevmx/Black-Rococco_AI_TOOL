const { getService } = require('./services');
const { minutesOfDay } = require('../helpers');
const { BUSINESS_TZ_OFFSET } = require('../config');

function appointmentDateTime(appt) {
  return new Date(`${appt.date}T${appt.time}:00${BUSINESS_TZ_OFFSET}`);
}

function endTimeForAppointment(db, appt) {
  const service = getService(db, appt.serviceId) || {};
  const start = minutesOfDay(appt.time);
  const end = start + Number(service.dur || 60);
  const hh = String(Math.floor(end / 60)).padStart(2, '0');
  const mm = String(end % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

// True if booking `serviceId` at `date`/`time` would overlap an existing,
// non-cancelled appointment. This is the friendly, fast pre-check shown in
// the UI; the actual guarantee against double-booking under concurrent
// requests is the database unique constraint (see lib/store.js,
// insertAppointmentAtomic) — this function alone is not sufficient for that.
function hasOverlap(db, date, time, serviceId, ignoreAppointmentId = null) {
  const service = getService(db, serviceId);
  if (!service) return true;
  const start = minutesOfDay(time);
  const end = start + Number(service.dur || 60);
  return db.appointments.some(appt => {
    if (ignoreAppointmentId && appt.id === ignoreAppointmentId) return false;
    if (appt.date !== date || appt.status === 'cancelled') return false;
    const other = getService(db, appt.serviceId);
    const otherStart = minutesOfDay(appt.time);
    const otherEnd = otherStart + Number(other?.dur || 60);
    return start < otherEnd && end > otherStart;
  });
}

// Only ever shows slots that are actually still bookable: not overlapping
// an existing appointment, AND not already in the past (comparing the
// slot's real timestamp in the business's timezone against right now —
// this naturally also covers "today, but the slot's time already passed"
// and "a past date entirely", not just a hardcoded "is it today" check).
function getAvailability(db, date, serviceId) {
  const times = db.settings.booking.times || [];
  const now = Date.now();
  return times
    .filter(time => new Date(`${date}T${time}:00${BUSINESS_TZ_OFFSET}`).getTime() > now)
    .map(time => {
      // hasOverlap() used to be called TWICE per slot here (once for `busy`,
      // once for `label`), doubling an already O(slots x appointments) scan.
      const busy = hasOverlap(db, date, time, serviceId);
      return { time, busy, label: busy ? 'Ocupado' : 'Disponible' };
    });
}

module.exports = { appointmentDateTime, endTimeForAppointment, hasOverlap, getAvailability };
