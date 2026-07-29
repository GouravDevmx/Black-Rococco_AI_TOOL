// slot-holds.js — short-lived reservations of a time slot while a client
// fills in the booking form.
//
// THE PROBLEM THIS SOLVES
// Client A picks 10:00 and starts typing her name. Client B, whose page loaded
// a minute earlier, still sees 10:00 as free, picks it, fills the whole form,
// and only discovers the clash when she presses "confirmar". The database
// always rejected the double booking correctly — data was never at risk — but
// the second client wasted two minutes and hit an error, which is exactly the
// moment people give up and go to a competitor.
//
// THE FIX
// Selecting a slot places a HOLD on it for a few minutes. Held slots are shown
// as taken to everyone else, so a clash can't be started in the first place.
// The hold is released when the booking completes, when it expires, or when
// the client picks a different time.
//
// WHY IN MEMORY
// Holds are ephemeral by definition and expire in minutes. Persisting them
// would add write amplification on the hot booking path and a restart would
// leave rows to garbage-collect. If the process restarts, every hold simply
// lifts — which is the safe direction to fail: worst case we're back to
// today's behaviour, never a lost or blocked real booking.
//
// MULTI-INSTANCE NOTE
// This is per-process. On a single Railway instance (the current setup) that
// is the whole picture. If the app is ever scaled to several instances, holds
// must move to Postgres or Redis so they are shared — the database unique
// constraint still prevents double bookings either way, so scaling out
// degrades this back to "error at submit" rather than corrupting anything.

const HOLD_TTL_MS = 8 * 60 * 1000;   // long enough to fill the form, short
                                     // enough that an abandoned tab frees up
const MAX_HOLDS_PER_HOLDER = 3;      // stops one browser blanking the agenda

// key -> { holder, expiresAt }
const holds = new Map();

const keyOf = (date, time, area) => `${date}|${time}|${area}`;

function sweep() {
  const now = Date.now();
  for (const [k, v] of holds) if (v.expiresAt <= now) holds.delete(k);
}

/* Areas this holder currently occupies at a given date/time. */
function isHeldByOther(date, time, area, holder) {
  sweep();
  const h = holds.get(keyOf(date, time, area));
  return Boolean(h && h.holder !== holder);
}

/* Place holds for every area a visit needs. Returns false (holding nothing)
   if any area is already held by someone else, so a partial hold can never
   strand a slot. */
function hold(date, time, areas, holder) {
  sweep();
  if (!holder || !Array.isArray(areas) || !areas.length) return false;

  for (const area of areas) {
    if (isHeldByOther(date, time, area, holder)) return false;
  }
  const mine = [...holds.values()].filter(v => v.holder === holder).length;
  if (mine >= MAX_HOLDS_PER_HOLDER) releaseAllFor(holder);

  const expiresAt = Date.now() + HOLD_TTL_MS;
  for (const area of areas) holds.set(keyOf(date, time, area), { holder, expiresAt });
  return true;
}

function release(date, time, areas, holder) {
  for (const area of areas || []) {
    const k = keyOf(date, time, area);
    const h = holds.get(k);
    if (h && h.holder === holder) holds.delete(k);
  }
}

function releaseAllFor(holder) {
  for (const [k, v] of holds) if (v.holder === holder) holds.delete(k);
}

/* Areas held by someone OTHER than this holder at a given slot — used by the
   availability builder to grey the slot out. */
function heldAreasExcluding(date, time, holder) {
  sweep();
  const out = [];
  for (const [k, v] of holds) {
    const [d, t, area] = k.split('|');
    if (d === date && t === time && v.holder !== holder) out.push(area);
  }
  return out;
}

function stats() {
  sweep();
  return { active: holds.size };
}

module.exports = {
  hold, release, releaseAllFor, isHeldByOther, heldAreasExcluding, stats,
  HOLD_TTL_MS
};
