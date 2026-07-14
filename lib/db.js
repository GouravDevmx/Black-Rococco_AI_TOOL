const store = require('./store');
const { migrateDb } = require('./migrate');
const { DB_PATH } = require('./config');

// `only` restricts which collections are fetched (STORY 2.5). Omit it to load
// everything — correct, just wasteful. Anything not listed throws on access.
async function readDb(salonId, only) {
  // Order matters: read -> migrate -> guard -> snapshot.
  //   migrate normalizes every collection, so guards must come AFTER it.
  //   the snapshot must come after migrate too, or migrate's normalizations
  //   would look like user edits to the record-level diff.
  const db = store.installGuards(migrateDb(await store.readDb(salonId, DB_PATH, { only })));
  // Baseline AFTER migration, so migrate.js's normalizations aren't mistaken
  // for real user changes by the record-level diff in writeDb().
  if (salonId) store.takeSnapshot(db);
  return db;
}

async function writeDb(db, salonId) {
  await store.writeDb(db, salonId, DB_PATH);
}

module.exports = {
  readDb,
  writeDb,
  ALL_COLLECTION_KEYS: store.ALL_COLLECTION_KEYS,
  insertAppointmentAtomic: store.insertAppointmentAtomic,
  upsertClientAndGetId: store.upsertClientAndGetId,
  // Folds an out-of-band-persisted record into the read snapshot so the
  // record-level diff in writeDb() doesn't try to INSERT it a second time.
  markPersisted: store.markPersisted
};
