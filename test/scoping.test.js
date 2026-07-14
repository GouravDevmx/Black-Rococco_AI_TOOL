// STORY 2.5 — scoped reads must FAIL LOUDLY, never silently return [].
const assert = require('assert');
const store = require('../lib/store');

let pass = 0, fail = 0;
const t = (n, c) => { if (c) { console.log('  ok    ' + n); pass++; } else { console.log('  FAIL  ' + n); fail++; } };

console.log('\nscoped reads\n');

// Simulate a db that loaded only `services`.
function scopedDb(only) {
  const db = { services: [{ id: 's1' }], clients: [{ id: 'c1' }], appointments: [{ id: 'a1' }], media: [] };
  Object.defineProperty(db, Object.getOwnPropertySymbols(store.takeSnapshot) [0] || Symbol('x'), { value: 1 });
  return db;
}

// Use the real path: readDb in local mode with `only`
const fs = require('fs');
const tmp = '/tmp/scope-db.json';
fs.writeFileSync(tmp, JSON.stringify({
  settings: {}, services: [{ id: 's1', name: 'X' }], clients: [{ id: 'c1' }],
  appointments: [{ id: 'a1' }], promotions: [], courses: [], courseRegistrations: [],
  media: [], notifications: [], posts: [], staff: [], clientPhotos: [], counters: {}
}));

(async () => {
  const db = store.installGuards(await store.readDb(null, tmp, { only: ['services'] }));

  t('loaded collection is readable', Array.isArray(db.services) && db.services.length === 1);

  let threw = false;
  try { void db.appointments; } catch { threw = true; }
  t('UNLOADED collection THROWS (does not return [])', threw);

  let threw2 = false;
  try { void db.clients; } catch { threw2 = true; }
  t('unloaded clients throws', threw2);

  // The dangerous case this prevents: availability against [] would say
  // every slot is free.
  t('an unloaded collection never reads as an empty array', threw && threw2);

  // Writing must not destroy the collections we never loaded.
  store.takeSnapshot(db);
  db.services.push({ id: 's2', name: 'Y' });
  await store.writeDb(db, null, tmp);
  const onDisk = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  t('scoped write PRESERVES unloaded collections on disk', onDisk.clients.length === 1 && onDisk.appointments.length === 1);
  t('scoped write persists the loaded collection', onDisk.services.length === 2);

  // No `only` -> everything available
  const full = store.installGuards(await store.readDb(null, tmp, {}));
  let anyThrow = false;
  try { void full.appointments; void full.clients; void full.media; } catch { anyThrow = true; }
  t('unscoped read exposes every collection', !anyThrow);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
