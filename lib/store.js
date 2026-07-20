const fs = require('fs');
const supabase = require('./supabaseClient');

// ---------------------------------------------------------------------------
// RECORD-LEVEL PERSISTENCE ENGINE  (EPIC 1 / STORY 1)
//
// Previously this module did a "full collection sync" on every write: it
// upserted EVERY row of EVERY collection and deleted any row not present in
// the in-memory copy. Correct for one request in isolation, but it silently
// destroyed data under concurrency:
//
//   1. Request A reads the DB          (notifications = [1,2,3])
//   2. Request B creates notification 4 and writes
//   3. Request A writes its now-stale copy -> the sync sees row 4 in the
//      table but not in memory -> DELETES row 4.
//
// The fix: on read we take a SNAPSHOT of exactly what we saw. On write we
// DIFF current in-memory state against that baseline and emit only:
//
//   * INSERT  records that appeared since our read
//   * UPDATE  records whose fields actually differ
//   * DELETE  ONLY records that were in OUR baseline and were explicitly
//             removed during THIS request
//
// Because deletes are scoped to the baseline, a stale request can no longer
// delete rows it never knew existed. Row 4 above survives. Unchanged records
// produce zero writes.
//
// Route handlers are untouched: they still mutate the same plain JS object.
// The snapshot lives in a WeakMap keyed on that object, so it is collected
// with the request and never leaks.
// ---------------------------------------------------------------------------

const SNAPSHOTS = new WeakMap();

// Marks which collections a given db object actually loaded. Non-enumerable, so
// it never leaks into JSON or the diff.
const LOADED = Symbol('loadedCollections');

function rowToJs(row, fields) {
  const out = {};
  for (const [jsKey, sqlKey] of fields) out[jsKey] = row[sqlKey];
  return out;
}

function jsToRow(obj, fields, extra) {
  const out = { ...extra };
  for (const [jsKey, sqlKey] of fields) {
    // Omit undefined so Postgres applies the column default. An explicit null
    // is preserved on purpose — some columns (applied_promotion, start_date)
    // are genuinely nullable and mean something by being null.
    if (obj[jsKey] !== undefined) out[sqlKey] = obj[jsKey];
  }
  return out;
}

// Stable serialization used to answer "did this record actually change?".
// Key order is fixed by the field map, so it is deterministic.
function fingerprint(obj, fields) {
  const parts = [];
  for (const [jsKey] of fields) {
    parts.push(JSON.stringify(obj[jsKey] === undefined ? null : obj[jsKey]));
  }
  return parts.join('\u0001');
}

// ---------------------------------------------------------------------------
// Collection field maps (jsKey <-> sqlColumn). Must match sql/schema.sql.
// ---------------------------------------------------------------------------

const SERVICE_FIELDS = [
  ['id', 'id'], ['cat', 'cat'], ['name', 'name'], ['desc', 'description'],
  ['price', 'price'], ['dur', 'duration_minutes'], ['imageUrl', 'image_url'],
  ['imageUrls', 'image_urls'], ['active', 'active'], ['sort', 'sort_order']
];

const CLIENT_FIELDS = [
  ['id', 'id'], ['name', 'name'], ['whatsapp', 'whatsapp'], ['email', 'email'],
  ['instagram', 'instagram'], ['birthday', 'birthday'], ['styleChoice', 'style_choice'],
  ['colorChoice', 'color_choice'], ['drinkChoice', 'drink_choice'],
  ['timePreference', 'time_preference'], ['notes', 'notes'], ['allergies', 'allergies'],
  ['depositOnFile', 'deposit_on_file'],
  ['createdAt', 'created_at'], ['updatedAt', 'updated_at']
];

const APPOINTMENT_FIELDS = [
  ['id', 'id'], ['clientId', 'client_id'], ['serviceId', 'service_id'],
  ['date', 'appt_date'], ['time', 'appt_time'], ['status', 'status'],
  ['preferencesSnapshot', 'preferences_snapshot'], ['finalPrice', 'final_price'],
  ['appliedPromotion', 'applied_promotion'], ['remindersSent', 'reminders_sent'],
  ['googleEventId', 'google_event_id'], ['createdAt', 'created_at']
];
// `folio` is derived from the DB-assigned `folio_number` (bigserial), not a
// real column — deliberately absent from the map so it is never written.

const PROMOTION_FIELDS = [
  ['id', 'id'], ['code', 'code'], ['label', 'label'], ['title', 'title'], ['note', 'note'],
  ['type', 'discount_type'], ['value', 'value'], ['scope', 'scope'],
  ['categoryValue', 'category_value'], ['serviceIds', 'service_ids'],
  ['startDate', 'start_date'], ['endDate', 'end_date'], ['active', 'active'],
  ['autoApply', 'auto_apply'], ['usageLimit', 'usage_limit'], ['usageCount', 'usage_count'],
  ['imageUrl', 'image_url'],
  ['createdAt', 'created_at'], ['updatedAt', 'updated_at']
];

const COURSE_FIELDS = [
  ['id', 'id'], ['title', 'title'], ['description', 'description'], ['price', 'price'],
  ['duration', 'duration'], ['level', 'level'], ['imageUrls', 'image_urls'],
  ['capacity', 'capacity'], ['startDate', 'start_date'], ['active', 'active'],
  ['sort', 'sort_order'], ['createdAt', 'created_at'], ['updatedAt', 'updated_at']
];

const COURSE_REGISTRATION_FIELDS = [
  ['id', 'id'], ['courseId', 'course_id'], ['name', 'name'], ['whatsapp', 'whatsapp'],
  ['email', 'email'], ['notes', 'notes'], ['status', 'status'], ['createdAt', 'created_at']
];

const MEDIA_FIELDS = [
  ['id', 'id'], ['kind', 'kind'], ['url', 'url'], ['posterUrl', 'poster_url'],
  ['title', 'title'], ['description', 'description'], ['category', 'category'],
  ['order', 'sort_order'], ['showInCarousel', 'show_in_carousel'],
  ['showInGallery', 'show_in_gallery'], ['createdAt', 'created_at'], ['updatedAt', 'updated_at']
];

const NOTIFICATION_FIELDS = [
  ['id', 'id'], ['kind', 'kind'], ['channel', 'channel'], ['title', 'title'],
  ['message', 'message'], ['appointmentId', 'appointment_id'], ['status', 'status'],
  ['actionLabel', 'action_label'], ['actionUrl', 'action_url'], ['error', 'error'],
  ['unread', 'unread'], ['createdAt', 'created_at'], ['updatedAt', 'updated_at']
];

const STAFF_FIELDS = [
  ['id', 'id'], ['name', 'name'], ['role', 'role'], ['bio', 'bio'],
  ['photoUrl', 'photo_url'], ['instagram', 'instagram'], ['active', 'active'],
  ['sort', 'sort_order'], ['createdAt', 'created_at'], ['updatedAt', 'updated_at']
];

// Consultation / before-after photos. ADMIN ONLY — never exposed publicly.
const CLIENT_PHOTO_FIELDS = [
  ['id', 'id'], ['clientId', 'client_id'], ['appointmentId', 'appointment_id'],
  ['url', 'url'], ['note', 'note'], ['phase', 'phase'], ['createdAt', 'created_at']
];

const POST_FIELDS = [
  ['id', 'id'], ['caption', 'caption'], ['imageUrl', 'image_url'],
  ['targets', 'targets'], ['publishedAt', 'published_at']
];

const CLIENT_ACCOUNT_FIELDS = [
  ['id', 'id'], ['clientId', 'client_id'], ['whatsapp', 'whatsapp'],
  ['passwordHash', 'password_hash'], ['displayName', 'display_name'],
  ['createdAt', 'created_at'], ['updatedAt', 'updated_at']
];

const CHAT_MESSAGE_FIELDS = [
  ['id', 'id'], ['threadId', 'thread_id'], ['sender', 'sender'],
  ['name', 'name'], ['whatsapp', 'whatsapp'], ['text', 'text'], ['imageUrl', 'image_url'],
  ['readByAdmin', 'read_by_admin'], ['readByClient', 'read_by_client'],
  ['createdAt', 'created_at']
];

const BLOG_POST_FIELDS = [
  ['id', 'id'], ['title', 'title'], ['slug', 'slug'], ['excerpt', 'excerpt'],
  ['body', 'body'], ['coverImageUrl', 'cover_image_url'],
  ['published', 'published'], ['tags', 'tags'], ['author', 'author'],
  ['createdAt', 'created_at'], ['updatedAt', 'updated_at']
];

// The single registry driving read, diff and write. Adding a collection here
// is the only step needed to make it fully participate.
const COLLECTIONS = [
  { key: 'services',            table: 'services',             fields: SERVICE_FIELDS,             orderBy: 'sort_order' },
  { key: 'clients',             table: 'clients',              fields: CLIENT_FIELDS },
  { key: 'appointments',        table: 'appointments',         fields: APPOINTMENT_FIELDS },
  { key: 'promotions',          table: 'promotions',           fields: PROMOTION_FIELDS },
  { key: 'courses',             table: 'courses',              fields: COURSE_FIELDS,              orderBy: 'sort_order' },
  { key: 'courseRegistrations', table: 'course_registrations', fields: COURSE_REGISTRATION_FIELDS },
  { key: 'media',               table: 'media',                fields: MEDIA_FIELDS,               orderBy: 'sort_order' },
  { key: 'notifications',       table: 'notifications',        fields: NOTIFICATION_FIELDS },
  { key: 'posts',               table: 'posts',                fields: POST_FIELDS },
  { key: 'staff',               table: 'staff',                fields: STAFF_FIELDS,               orderBy: 'sort_order' },
  { key: 'clientPhotos',        table: 'client_photos',        fields: CLIENT_PHOTO_FIELDS },
  { key: 'clientAccounts',     table: 'client_accounts',      fields: CLIENT_ACCOUNT_FIELDS },
  { key: 'blogPosts',          table: 'blog_posts',           fields: BLOG_POST_FIELDS },
  { key: 'chatMessages',       table: 'chat_messages',        fields: CHAT_MESSAGE_FIELDS }
];

const COLLECTION_BY_KEY = Object.fromEntries(COLLECTIONS.map(c => [c.key, c]));

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

// Supabase caps every SELECT at 1000 rows by default — and it does so SILENTLY.
// No error, no warning: the query simply returns the first 1000 and the client
// has no idea it is looking at a fraction of the table.
//
// That is a CORRECTNESS bug, not a performance one. Past 1000 appointments,
// hasOverlap() would be checking availability against a partial set and would
// advertise booked slots as free. And because a query without an explicit
// ORDER BY gets an internal ctid sort, WHICH 1000 rows you get is arbitrary and
// reshuffles after a VACUUM — so the bug would be intermittent and unreproducible.
//
// Every read is therefore paginated to exhaustion, and every read is ordered.
const PAGE_SIZE = 1000;

async function fetchAllPages(table, salonId, orderBy) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from(table)
      .select('*')
      .eq('salon_id', salonId)
      .range(from, from + PAGE_SIZE - 1);

    // A stable sort is REQUIRED, not cosmetic: without it PostgREST orders by
    // ctid, so page 2 can repeat or skip rows that page 1 already returned.
    query = orderBy
      ? query.order(orderBy, { ascending: true }).order('id', { ascending: true })
      : query.order('id', { ascending: true });

    const { data, error } = await query;
    if (error) {
      // A table that hasn't been migrated yet must NOT take down every
      // request that happens to include it in its read scope (the admin
      // dashboard reads all collections, so one missing table used to 500
      // the entire admin). Treat "table missing" as an empty collection and
      // warn loudly so the operator knows to run the pending SQL migration.
      if (/could not find the table|does not exist/i.test(error.message)) {
        console.warn(`[store] Table "${table}" missing in Supabase — returning empty. Run the pending migration in sql/migrations/.`);
        return rows; // whatever was collected so far (normally empty)
      }
      throw new Error(`Supabase read failed (${table}): ${error.message}`);
    }

    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break; // last page
  }
  return rows;
}

async function fetchCollection(table, salonId, fields, orderBy) {
  const rows = await fetchAllPages(table, salonId, orderBy);
  return rows.map(row => rowToJs(row, fields));
}

async function fetchAppointments(salonId) {
  const rows = await fetchAllPages('appointments', salonId, 'appt_date');
  return rows.map(row => {
    const js = rowToJs(row, APPOINTMENT_FIELDS);
    js.folio = `BR-${row.folio_number}`;
    return js;
  });
}

// Records exactly what we read, so writeDb can diff against it.
// Installs the throwing getters. Called by db.js AFTER migrateDb() has run:
// migrate legitimately normalizes every collection, so guarding before it would
// trip on migrate's own bookkeeping rather than on a route's real mistake.
function installGuards(db) {
  const loadedSet = db[LOADED];
  if (!loadedSet) return db; // nothing was scoped
  const only = [...loadedSet];
  for (const key of ALL_COLLECTION_KEYS) {
    if (loadedSet.has(key)) continue;
    if (!db[HIDDEN]) Object.defineProperty(db, HIDDEN, { value: {}, enumerable: false });
    if (db[HIDDEN][key] === undefined) db[HIDDEN][key] = db[key];
    delete db[key];
    guardUnloaded(db, key, only);
  }
  return db;
}

function isLoaded(db, key) {
  // Local JSON mode has no LOADED marker: everything is present.
  const set = db[LOADED];
  return set ? set.has(key) : true;
}

function takeSnapshot(db) {
  const collections = {};
  for (const { key, fields } of COLLECTIONS) {
    // Skip collections this request never read. Snapshotting one would give it
    // an EMPTY baseline; writeDb would then diff [] against [] and — worse, if
    // anything were ever appended — treat the entire table as deleted.
    if (!isLoaded(db, key)) continue;

    const map = new Map();
    for (const item of db[key] || []) {
      if (item && item.id !== undefined && item.id !== null) {
        map.set(item.id, fingerprint(item, fields));
      }
    }
    collections[key] = map;
  }
  SNAPSHOTS.set(db, { collections, settings: JSON.stringify(db.settings || {}) });
}

// Folds an already-persisted record into the baseline so the diff does NOT
// insert it a second time. Required for rows written out-of-band by
// insertAppointmentAtomic / upsertClientAndGetId, which hit Postgres directly
// before writeDb ever runs.
function markPersisted(db, collectionKey, record) {
  const snapshot = SNAPSHOTS.get(db);
  const meta = COLLECTION_BY_KEY[collectionKey];
  if (!snapshot || !meta || !record || record.id === undefined || record.id === null) return;
  const baseline = snapshot.collections[collectionKey];
  if (!baseline) return; // collection wasn't loaded on this request
  baseline.set(record.id, fingerprint(record, meta.fields));
}

function readLocalFile(dbPath) {
  return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
}

function writeLocalFile(dbPath, db) {
  // Restore any collection this route did not load. They are behind throwing
  // getters, so JSON.stringify would omit them and the write would DELETE them
  // from the file. Put the untouched originals back first.
  const out = { ...db };
  const hidden = db[HIDDEN];
  if (hidden) for (const [key, value] of Object.entries(hidden)) out[key] = value;

  const tmp = `${dbPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
  fs.renameSync(tmp, dbPath);
}

// ---------------------------------------------------------------------------
// SCOPED READS  (STORY 2.5)
//
// readDb() used to load ALL ELEVEN collections on EVERY request. At the target
// scale in Story 2.8 (10k bookings / 5k clients / 100k images) that is ~156,000
// rows and ~58 MB pulled from Postgres to answer ANY request — including
// `PATCH /api/admin/services/:id`, which needs precisely one table (100% waste),
// and the public homepage, which never touches appointments or clients at all.
//
// A route now declares the collections it needs. Anything it did not ask for is
// installed as a THROWING getter rather than an empty array — because an empty
// array is the dangerous outcome: availability checked against `[]` would
// cheerfully report every slot as free. A missing collection must fail loudly,
// and the 157-test regression suite is what proves each route's list is right.
// ---------------------------------------------------------------------------
// Collections a scoped route did not load are stashed here so writeLocalFile()
// can write them back untouched instead of dropping them from the file.
const HIDDEN = Symbol('hiddenCollections');

function guardUnloaded(db, key, loaded) {
  Object.defineProperty(db, key, {
    configurable: true,
    enumerable: false,
    get() {
      throw new Error(
        `db.${key} was accessed but NOT loaded for this route. ` +
        `Loaded: [${loaded.join(', ')}]. Add '${key}' to the route's collection list ` +
        `in server.js (ROUTE_COLLECTIONS). Returning an empty array here would ` +
        `silently produce wrong answers, so this throws instead.`
      );
    },
    set(value) {
      Object.defineProperty(db, key, { value, writable: true, enumerable: true, configurable: true });
    }
  });
}

const COLLECTION_LOADERS = {
  services:            id => fetchCollection('services', id, SERVICE_FIELDS, 'sort_order'),
  clients:             id => fetchCollection('clients', id, CLIENT_FIELDS),
  appointments:        id => fetchAppointments(id),
  promotions:          id => fetchCollection('promotions', id, PROMOTION_FIELDS),
  courses:             id => fetchCollection('courses', id, COURSE_FIELDS, 'sort_order'),
  courseRegistrations: id => fetchCollection('course_registrations', id, COURSE_REGISTRATION_FIELDS),
  media:               id => fetchCollection('media', id, MEDIA_FIELDS, 'sort_order'),
  notifications:       id => fetchCollection('notifications', id, NOTIFICATION_FIELDS),
  posts:               id => fetchCollection('posts', id, POST_FIELDS),
  staff:               id => fetchCollection('staff', id, STAFF_FIELDS, 'sort_order'),
  clientPhotos:        id => fetchCollection('client_photos', id, CLIENT_PHOTO_FIELDS),
  clientAccounts:     id => fetchCollection('client_accounts', id, CLIENT_ACCOUNT_FIELDS),
  blogPosts:          id => fetchCollection('blog_posts', id, BLOG_POST_FIELDS),
  chatMessages:       id => fetchCollection('chat_messages', id, CHAT_MESSAGE_FIELDS)
};

const ALL_COLLECTION_KEYS = Object.keys(COLLECTION_LOADERS);

function resolveOnly(options) {
  return Array.isArray(options.only) && options.only.length
    ? options.only.filter(k => COLLECTION_LOADERS[k])
    : ALL_COLLECTION_KEYS;
}

async function readDb(salonId, dbPath, options = {}) {
  const only = resolveOnly(options);

  // Local JSON mode reads the whole file (there is no per-table query to skip),
  // but it applies the SAME guards. That is deliberate: it means the regression
  // suite — which runs in this mode — actually exercises every route's
  // collection list. Without it a wrong list would sail through the tests and
  // only explode in production, which is exactly the class of bug this is
  // meant to prevent.
  if (!salonId) {
    const db = readLocalFile(dbPath);
    // Stash the collections this route didn't ask for, so writeLocalFile can put
    // them back, and mark what was loaded. Guards are installed later — see
    // installGuards() — because migrate.js legitimately normalizes everything.
    Object.defineProperty(db, LOADED, { value: new Set(only), enumerable: false });
    Object.defineProperty(db, HIDDEN, { value: {}, enumerable: false });
    for (const key of ALL_COLLECTION_KEYS) {
      if (!db[LOADED].has(key)) db[HIDDEN][key] = db[key];
    }
    return db;
  }

  let { data: salonRow, error: salonErr } = await supabase
    .from('salons').select('*').eq('id', salonId).maybeSingle();
  if (salonErr) throw new Error(`Supabase read failed (salons): ${salonErr.message}`);

  if (!salonRow) {
    // Self-heal: the salon row this process resolved at boot no longer exists
    // under that UUID. That happens when schema/seed SQL is re-run in Supabase
    // while the server is live — the row is recreated with a NEW id. Without
    // this, every request 500s until a manual redeploy. Re-resolve by slug.
    const slug = process.env.SALON_SLUG || 'black-rococo';
    console.warn(`[store] Salon row ${salonId} not found — re-resolving by slug "${slug}" (was the seed SQL re-run?)`);
    const { data: bySlug, error: slugErr } = await supabase
      .from('salons').select('*').eq('slug', slug).eq('active', true)
      .order('created_at', { ascending: true }).limit(1);
    if (slugErr) throw new Error(`Supabase read failed (salons): ${slugErr.message}`);
    if (!bySlug || !bySlug.length) {
      throw new Error(`Supabase read failed (salons): no salon row exists with id ${salonId} or slug "${slug}". Re-run sql/schema.sql seed, or fix SALON_SLUG.`);
    }
    salonRow = bySlug[0];
    // Update the shared reference so THIS and all future requests (including
    // writes) use the new id without a restart.
    require('./salonRef').set(salonRow.id);
    salonId = salonRow.id;
  }

  const loaded = await Promise.all(only.map(key => COLLECTION_LOADERS[key](salonId)));
  const collections = {};
  only.forEach((key, i) => { collections[key] = loaded[i]; });

  const {
    services = [], clients = [], appointments = [], promotions = [], courses = [],
    courseRegistrations = [], media = [], notifications = [], posts = [],
    staff = [], clientPhotos = [], clientAccounts = [], blogPosts = [], chatMessages = []
  } = collections;

  const db = {
    settings: {
      brand: salonRow.brand || {},
      contact: salonRow.contact || {},
      booking: salonRow.booking || {},
      featuredServiceIds: salonRow.featured_service_ids || [],
      promo: { enabled: false, label: '', title: '', note: '' },
      googleCalendarIntegration: salonRow.google_calendar || {},
      // BUGFIX: this was previously loaded as `salonConfig`, but every domain
      // module (and migrate.js) reads and writes `config`. The mismatch meant
      // `settings.config` came back undefined on every Supabase read, so
      // migrate.js rebuilt it from defaults — wiping heroImages and the custom
      // colour/drink/category lists on every single page load. Saves appeared
      // to work, then the data vanished on refresh.
      config: salonRow.salon_config || {},
      notifications: {
        adminPanel: true,
        googleCalendar: 'webhook',
        whatsappAdmin: 'webhook',
        clientReminders: [24, 2]
      }
    },
    services, clients, appointments, promotions, courses,
    courseRegistrations, media, notifications, posts, staff, clientPhotos,
    clientAccounts, blogPosts, chatMessages,
    counters: { appointment: 1000, client: 1000, post: 1000, notification: 1000, promotion: 1000, course: 1000, registration: 1000, service: 1000, media: 1000, staff: 1000, clientPhoto: 1000 }
  };

  // Remember exactly what this request loaded. writeDb() diffs ONLY these —
  // a collection we never read has no baseline, so diffing it would compare
  // against an empty map and delete the entire table.
  Object.defineProperty(db, LOADED, { value: new Set(only), enumerable: false });

  // NOTE: the snapshot is deliberately NOT taken here. migrate.js normalizes
  // the db right after this returns, and those normalizations would otherwise
  // register as phantom "changes" on every request. db.js calls takeSnapshot()
  // once migration is done, so the baseline reflects the true post-migrate state.
  return db;
}

// ---------------------------------------------------------------------------
// Write — record-level diff
// ---------------------------------------------------------------------------

// Computes exactly what changed for one collection. Pure, no I/O, unit-testable.
function diffCollection(baseline, items, fields) {
  const inserts = [];
  const updates = [];
  const seen = new Set();

  for (const item of items || []) {
    if (!item || item.id === undefined || item.id === null) continue;
    seen.add(item.id);
    const current = fingerprint(item, fields);
    if (!baseline.has(item.id)) inserts.push(item);
    else if (baseline.get(item.id) !== current) updates.push(item);
    // identical fingerprint -> unchanged -> no write at all
  }

  // Deletes are scoped to OUR baseline only. Rows another concurrent request
  // created after we read are invisible here, so we can never delete them.
  // This is the race-condition fix.
  const deletes = [];
  for (const id of baseline.keys()) {
    if (!seen.has(id)) deletes.push(id);
  }

  return { inserts, updates, deletes };
}

async function applyCollectionDiff(meta, salonId, diff) {
  const { table, fields } = meta;

  if (diff.deletes.length) {
    const { error } = await supabase
      .from(table).delete().eq('salon_id', salonId).in('id', diff.deletes);
    if (error) throw new Error(`Supabase delete failed (${table}): ${error.message}`);
  }

  if (diff.inserts.length) {
    const rows = diff.inserts.map(item => jsToRow(item, fields, { salon_id: salonId }));
    const { error } = await supabase.from(table).insert(rows);
    if (error) throw new Error(`Supabase insert failed (${table}): ${error.message}`);
  }

  // Updated one at a time, scoped by id + salon_id, so we only ever touch the
  // specific rows this request actually modified.
  for (const item of diff.updates) {
    const row = jsToRow(item, fields, {});
    delete row.id; // never rewrite the primary key
    const { error } = await supabase
      .from(table).update(row).eq('salon_id', salonId).eq('id', item.id);
    if (error) throw new Error(`Supabase update failed (${table}): ${error.message}`);
  }
}

async function writeDb(db, salonId, dbPath) {
  if (!salonId) return writeLocalFile(dbPath, db);

  const snapshot = SNAPSHOTS.get(db);
  if (!snapshot) {
    // A db object that didn't come from readDb. Fail loudly rather than
    // silently reverting to destructive full-sync behaviour.
    throw new Error('writeDb called with a db object that has no read snapshot.');
  }

  const work = [];

  // Settings live on the single `salons` row. Only write it if it changed.
  const settingsNow = JSON.stringify(db.settings || {});
  if (settingsNow !== snapshot.settings) {
    work.push(
      supabase.from('salons').update({
        brand: db.settings.brand,
        contact: db.settings.contact,
        booking: db.settings.booking,
        featured_service_ids: db.settings.featuredServiceIds || [],
        google_calendar: db.settings.googleCalendarIntegration || {},
        salon_config: db.settings.config || {}
      }).eq('id', salonId).then(({ error }) => {
        if (error) throw new Error(`Supabase write failed (salons): ${error.message}`);
      })
    );
  }

  for (const meta of COLLECTIONS) {
    // Never write a collection we did not read. Without this guard a scoped
    // route (which loads, say, only `services`) would diff every other
    // collection against a missing baseline and could wipe it.
    const baseline = snapshot.collections[meta.key];
    if (!baseline || !isLoaded(db, meta.key)) continue;

    const diff = diffCollection(baseline, db[meta.key], meta.fields);
    if (!diff.inserts.length && !diff.updates.length && !diff.deletes.length) continue;
    work.push(applyCollectionDiff(meta, salonId, diff));
  }

  await Promise.all(work);

  // Re-baseline so a second writeDb() in the same request doesn't replay work.
  takeSnapshot(db);
}

// ---------------------------------------------------------------------------
// Out-of-band writes needing a REAL database guarantee, bypassing the
// read-modify-write cycle above.
// ---------------------------------------------------------------------------

// A brand-new client must exist in the database BEFORE the appointment that
// references it is inserted, or Postgres correctly rejects the appointment (a
// foreign key can't point at a row that isn't there yet). Upserts on
// (salon_id, whatsapp) rather than id, so two simultaneous requests from the
// same new number merge into one client instead of erroring, and returns
// whichever id actually won.
async function upsertClientAndGetId(salonId, client) {
  if (!salonId) return client.id; // local JSON mode: nothing to persist early
  const row = jsToRow(client, CLIENT_FIELDS, { salon_id: salonId });
  const { data, error } = await supabase
    .from('clients').upsert(row, { onConflict: 'salon_id,whatsapp' }).select().single();
  if (error) throw new Error(`Supabase client upsert failed: ${error.message}`);
  return data.id;
}

// sql/schema.sql has a partial unique index on (salon_id, appt_date, appt_time)
// WHERE status <> 'cancelled', so Postgres itself rejects a double-booked slot
// even under fully concurrent requests — a guarantee an app-level
// "check then insert" can never provide.
async function insertAppointmentAtomic(salonId, appt) {
  const row = jsToRow(appt, APPOINTMENT_FIELDS, { salon_id: salonId });
  delete row.id; // let Postgres generate it

  const { data, error } = await supabase
    .from('appointments').insert(row).select().single();

  if (error) {
    if (error.code === '23505') return { conflict: true }; // unique_violation
    throw new Error(`Supabase booking insert failed: ${error.message}`);
  }

  const inserted = rowToJs(data, APPOINTMENT_FIELDS);
  inserted.folio = `BR-${data.folio_number}`;
  return { row: inserted };
}

// True if this request loaded `key`. Used by migrate.js so it only normalizes
// collections that are actually present — touching an unloaded one would trip
// the guard.
function isCollectionLoaded(db, key) {
  return isLoaded(db, key);
}

module.exports = {
  readDb,
  writeDb,
  takeSnapshot,
  installGuards,
  ALL_COLLECTION_KEYS,
  isCollectionLoaded,
  insertAppointmentAtomic,
  upsertClientAndGetId,
  markPersisted,
  // exported for tests
  diffCollection,
  fingerprint,
  rowToJs,
  jsToRow,
  COLLECTIONS,
  SERVICE_FIELDS, CLIENT_FIELDS, APPOINTMENT_FIELDS, PROMOTION_FIELDS,
  COURSE_FIELDS, COURSE_REGISTRATION_FIELDS, MEDIA_FIELDS,
  NOTIFICATION_FIELDS, POST_FIELDS, STAFF_FIELDS, CLIENT_PHOTO_FIELDS,
  CLIENT_ACCOUNT_FIELDS, BLOG_POST_FIELDS, CHAT_MESSAGE_FIELDS
};
