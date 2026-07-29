const { getService } = require('./services');
const slotHolds = require('../slot-holds');
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

// Which specialist area a service needs. Defaults to 'hands' so a salon that
// hasn't tagged its menu still behaves exactly as it did before.
function serviceArea(service) {
  return ['hands', 'feet', 'both'].includes(service?.area) ? service.area : 'hands';
}

// How many people can work this area at once. With one manicurist and one
// pedicurist, a hands booking and a feet booking at the same time do NOT
// collide — they're different people. Staff tagged 'both' can cover either.
function capacityForArea(db, area) {
  const staff = (db.staff || []).filter(s => s.active !== false);
  if (!staff.length) return 1; // no staff configured yet: behave as a single chair
  const n = staff.filter(s => s.area === area || s.area === 'both').length;
  return Math.max(n, 1);
}

// True if booking `serviceId` at `date`/`time` would overlap existing
// appointments BEYOND the capacity of the specialists who can perform it.
// This is the friendly, fast pre-check shown in the UI; the actual guarantee
// against double-booking under concurrent requests is the database unique
// constraint (see lib/store.js, insertAppointmentAtomic).
function hasOverlap(db, date, time, serviceId, ignoreAppointmentId = null) {
  const service = getService(db, serviceId);
  if (!service) return true;
  const area = serviceArea(service);
  const start = minutesOfDay(time);
  const end = start + Number(service.dur || 60);

  // Count only appointments that compete for the SAME specialist(s).
  const competing = db.appointments.filter(appt => {
    if (ignoreAppointmentId && appt.id === ignoreAppointmentId) return false;
    if (appt.date !== date || ['cancelled', 'deleted'].includes(appt.status)) return false;
    const other = getService(db, appt.serviceId);
    const otherArea = serviceArea(other);
    // 'both' competes with everything; otherwise only the same area collides.
    if (!(otherArea === area || otherArea === 'both' || area === 'both')) return false;
    const otherStart = minutesOfDay(appt.time);
    const otherEnd = otherStart + Number(other?.dur || 60);
    return start < otherEnd && end > otherStart;
  });

  return competing.length >= capacityForArea(db, area);
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

/* =========================================================================
   MULTI-SERVICE SCHEDULING
   =========================================================================
   A visit can contain several services. How long it takes depends on WHO
   performs them:

     • Services in DIFFERENT areas run in PARALLEL — the manicurist works on
       hands while the pedicurist works on feet. A 60-min manicure plus a
       60-min pedicure is a 60-minute visit, not 120.
     • Services in the SAME area run BACK-TO-BACK — one person can't do two
       pairs of hands at once. Manicure (60) + nail art (30) = 90 minutes.

   So the visit length is the LONGEST area's total, and a slot only works if
   EVERY area involved has a free specialist for that area's whole run.
   ========================================================================= */

// Group services by the specialist area that performs them, summing durations
// within each area (sequential) — the per-area totals then run in parallel.
function planVisit(db, serviceIds) {
  const byArea = new Map();
  for (const id of serviceIds) {
    const svc = getService(db, id);
    if (!svc) continue;
    const area = serviceArea(svc);
    const entry = byArea.get(area) || { area, services: [], minutes: 0 };
    entry.services.push(svc);
    entry.minutes += Number(svc.dur || 60);
    byArea.set(area, entry);
  }
  const areas = [...byArea.values()];
  return {
    areas,
    // Whole-visit length = the longest single area (others finish sooner).
    totalMinutes: areas.reduce((max, a) => Math.max(max, a.minutes), 0),
    // Sum of what the client pays for, regardless of overlap.
    serviceCount: areas.reduce((n, a) => n + a.services.length, 0)
  };
}

// Can this whole visit start at `time` on `date`? Every area must have a free
// specialist for its full run, counted against that area's staff capacity.
function canScheduleVisit(db, date, time, serviceIds, ignoreGroupId = null) {
  const plan = planVisit(db, serviceIds);
  if (!plan.areas.length) return false;
  const start = minutesOfDay(time);

  for (const areaPlan of plan.areas) {
    const areaStart = start;
    const areaEnd = start + areaPlan.minutes;

    const competing = db.appointments.filter(appt => {
      if (ignoreGroupId && appt.groupId && appt.groupId === ignoreGroupId) return false;
      if (appt.date !== date || ['cancelled', 'deleted'].includes(appt.status)) return false;
      const other = getService(db, appt.serviceId);
      const otherArea = serviceArea(other);
      if (!(otherArea === areaPlan.area || otherArea === 'both' || areaPlan.area === 'both')) return false;
      const oStart = minutesOfDay(appt.time);
      const oEnd = oStart + Number(other?.dur || 60);
      return areaStart < oEnd && areaEnd > oStart;
    });

    // Count DISTINCT concurrent clients, not rows: a client already booked for
    // two same-area services occupies one specialist, not two.
    const concurrentClients = new Set(competing.map(a => a.groupId || a.id)).size;
    if (concurrentClients >= capacityForArea(db, areaPlan.area)) return false;
  }
  return true;
}

// Pick which staff member performs each area of the visit — the least-loaded
// qualified person that day, so work spreads instead of piling on one person.
function assignStaffForVisit(db, date, serviceIds) {
  const plan = planVisit(db, serviceIds);
  const assignment = {};
  for (const areaPlan of plan.areas) {
    const candidates = (db.staff || []).filter(s =>
      s.active !== false && (s.area === areaPlan.area || s.area === 'both'));
    if (!candidates.length) { assignment[areaPlan.area] = null; continue; }
    const loadOf = st => db.appointments.filter(a =>
      a.date === date && a.staffId === st.id && !['cancelled', 'deleted'].includes(a.status)).length;
    candidates.sort((a, b) => loadOf(a) - loadOf(b));
    assignment[areaPlan.area] = candidates[0].id;
  }
  return assignment;
}

// Availability for a whole visit (one or many services).
// `holder` identifies the browser asking, so a client always still sees the
// slot SHE is holding as available — only other people see it as taken.
function getVisitAvailability(db, date, serviceIds, holder = null) {
  const times = db.settings.booking.times || [];
  const now = Date.now();
  const plan = planVisit(db, serviceIds);
  const neededAreas = plan.areas.map(a => a.area);

  return times
    .filter(time => new Date(`${date}T${time}:00${BUSINESS_TZ_OFFSET}`).getTime() > now)
    .map(time => {
      // Someone else is mid-checkout on an area this visit needs.
      const heldElsewhere = slotHolds.heldAreasExcluding(date, time, holder);
      const blockedByHold = heldElsewhere.some(a =>
        neededAreas.includes(a) || a === 'both' || neededAreas.includes('both'));
      if (blockedByHold) return { time, busy: true, label: 'Apartado' };

      const free = canScheduleVisit(db, date, time, serviceIds);
      return { time, busy: !free, label: free ? 'Disponible' : 'Ocupado' };
    });
}

module.exports = {
  appointmentDateTime, endTimeForAppointment, hasOverlap, getAvailability,
  serviceArea, capacityForArea,
  planVisit, canScheduleVisit, assignStaffForVisit, getVisitAvailability
};
