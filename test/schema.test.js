// ===========================================================================
// STORY 1.2 — DATABASE STABILIZATION
//
// Proves the APPLICATION and the SQL SCHEMA agree, column for column.
//
// This is the highest-risk silent failure in the codebase. lib/store.js maps
// every JS field to a SQL column by hand. If a single mapping names a column
// that does not exist, nothing fails at startup and nothing fails in the local
// JSON mode — it only blows up in production, on the first write, as an opaque
// Supabase error. Migration 002 already shipped once with `text` ids against
// `uuid` columns and could not run at all.
//
// So: parse sql/schema.sql + every migration, build the real table shape, and
// assert that every column store.js writes actually exists, with a compatible
// type, and that every foreign key resolves.
//
//   node test/schema.test.js
// ===========================================================================

const fs = require('fs');
const path = require('path');
const store = require('../lib/store');

const SQL_DIR = path.join(__dirname, '..', 'sql');

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { console.log(`  ok    ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? ' -> ' + detail : ''}`); fail++; failures.push(name); }
};

// --- Load schema + migrations, in order -------------------------------------
function loadSql() {
  let sql = fs.readFileSync(path.join(SQL_DIR, 'schema.sql'), 'utf8');
  const migDir = path.join(SQL_DIR, 'migrations');
  if (fs.existsSync(migDir)) {
    for (const f of fs.readdirSync(migDir).sort()) {
      if (f.endsWith('.sql')) sql += '\n' + fs.readFileSync(path.join(migDir, f), 'utf8');
    }
  }
  return sql.replace(/--[^\n]*/g, ''); // strip comments
}

// --- Parse CREATE TABLE + ALTER TABLE ADD COLUMN ----------------------------
function parseTables(sql) {
  const tables = {};

  const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?(\w+)\s*\(([\s\S]*?)\n\s*\);/gi;
  let m;
  while ((m = createRe.exec(sql))) {
    const name = m[1];
    const body = m[2];
    const cols = {};
    const fks = [];

    for (let line of body.split('\n')) {
      line = line.trim().replace(/,$/, '');
      if (!line) continue;
      const lower = line.toLowerCase();

      // table-level constraints, not columns
      if (/^(primary\s+key|unique|check|constraint|foreign\s+key)\b/.test(lower)) continue;

      const colMatch = line.match(/^(\w+)\s+([a-z0-9_]+(?:\s*\[\s*\])?(?:\([^)]*\))?)/i);
      if (!colMatch) continue;

      const col = colMatch[1];
      const type = colMatch[2].toLowerCase();
      cols[col] = { type, notNull: /not\s+null/i.test(line), hasDefault: /default/i.test(line) };

      const fk = line.match(/references\s+(\w+)\s*\(\s*(\w+)\s*\)/i);
      if (fk) fks.push({ column: col, refTable: fk[1], refColumn: fk[2] });
    }
    tables[name] = { columns: cols, foreignKeys: fks };
  }

  const alterRe = /alter\s+table\s+(\w+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)\s+([a-z0-9_]+(?:\([^)]*\))?)/gi;
  while ((m = alterRe.exec(sql))) {
    const [, table, col, type] = m;
    if (tables[table]) tables[table].columns[col] = { type: type.toLowerCase(), notNull: false, hasDefault: true };
  }

  return tables;
}

const sql = loadSql();
const tables = parseTables(sql);

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║  STORY 1.2 — SCHEMA vs APPLICATION                        ║');
console.log('╚══════════════════════════════════════════════════════════╝');

console.log(`\n─── Tables found in SQL ${'─'.repeat(37)}`);
console.log('  ' + Object.keys(tables).sort().join(', ') + '\n');

// --- 1. Every collection store.js reads/writes must have a table ------------
console.log(`─── Every collection maps to a real table ${'─'.repeat(19)}`);
for (const c of store.COLLECTIONS) {
  ok(`table "${c.table}" exists (collection: ${c.key})`, !!tables[c.table]);
}

// --- 2. Every column store.js writes must exist in that table ---------------
console.log(`\n─── Every mapped column exists in SQL ${'─'.repeat(23)}`);
for (const c of store.COLLECTIONS) {
  const t = tables[c.table];
  if (!t) continue;
  const missing = c.fields
    .map(([, sqlCol]) => sqlCol)
    .filter(col => !t.columns[col]);
  ok(`${c.table}: all ${c.fields.length} mapped columns exist`,
     missing.length === 0,
     missing.length ? `MISSING: ${missing.join(', ')}` : '');
}

// --- 3. salon_id must exist everywhere (every query filters on it) ----------
console.log(`\n─── salon_id present on every collection table ${'─'.repeat(14)}`);
for (const c of store.COLLECTIONS) {
  const t = tables[c.table];
  if (!t) continue;
  ok(`${c.table}.salon_id exists`, !!t.columns.salon_id);
}

// --- 4. Foreign keys must resolve, and types must match ---------------------
// This is what broke migration 002: a `text` column referencing a `uuid` one.
// Postgres rejects that outright ("key columns are of incompatible types").
console.log(`\n─── Foreign keys resolve, and types match ${'─'.repeat(19)}`);
let fkCount = 0;
for (const [tableName, t] of Object.entries(tables)) {
  for (const fk of t.foreignKeys) {
    fkCount++;
    const target = tables[fk.refTable];
    ok(`${tableName}.${fk.column} -> ${fk.refTable}.${fk.refColumn} (table exists)`, !!target);
    if (!target) continue;
    const targetCol = target.columns[fk.refColumn];
    ok(`  ${tableName}.${fk.column} -> column exists`, !!targetCol);
    if (!targetCol) continue;

    const base = s => s.replace(/\(.*\)/, '').trim();
    ok(`  ${tableName}.${fk.column} type matches ${fk.refTable}.${fk.refColumn}`,
       base(t.columns[fk.column].type) === base(targetCol.type),
       `${t.columns[fk.column].type} vs ${targetCol.type}`);
  }
}
ok(`found and validated ${fkCount} foreign keys`, fkCount > 0);

// --- 5. The index that makes double-booking impossible ---------------------
console.log(`\n─── Critical indexes ${'─'.repeat(40)}`);
const uniqueSlot = /create\s+unique\s+index\s+(?:if\s+not\s+exists\s+)?\w+\s+on\s+appointments\s*\([^)]*appt_date[^)]*appt_time[^)]*\)\s*where\s+status\s*<>\s*'cancelled'/is.test(sql);
ok('partial unique index on (salon_id, appt_date, appt_time) WHERE status <> cancelled', uniqueSlot);
ok('clients unique on (salon_id, whatsapp)', /unique\s*\(\s*salon_id\s*,\s*whatsapp\s*\)/i.test(sql));
ok('appointments has a folio_number sequence', /folio_number\s+bigserial/i.test(sql));

// --- 6. Ids are uuid + auto-generated (the migration-002 class of bug) ------
console.log(`\n─── Primary keys are uuid with a default ${'─'.repeat(20)}`);
for (const c of store.COLLECTIONS) {
  const t = tables[c.table];
  if (!t || !t.columns.id) continue;
  ok(`${c.table}.id is uuid`, t.columns.id.type.startsWith('uuid'), t.columns.id.type);
}

// --- 7. NOT NULL columns without a default must be written by the app -------
// Otherwise an INSERT that omits them fails at runtime, not at boot.
console.log(`\n─── NOT NULL columns are all writable by the app ${'─'.repeat(12)}`);
for (const c of store.COLLECTIONS) {
  const t = tables[c.table];
  if (!t) continue;
  const mapped = new Set(c.fields.map(([, col]) => col));
  mapped.add('salon_id'); // injected by store.js on every insert
  const unwritable = Object.entries(t.columns)
    .filter(([col, def]) => def.notNull && !def.hasDefault && !mapped.has(col))
    .map(([col]) => col);
  ok(`${c.table}: no NOT NULL column the app can't populate`,
     unwritable.length === 0,
     unwritable.length ? `UNWRITABLE: ${unwritable.join(', ')}` : '');
}

// --- Result -----------------------------------------------------------------
console.log(`\n${'═'.repeat(62)}`);
console.log(`  ${pass} passed, ${fail} failed`);
if (fail) {
  console.log('\n  SCHEMA MISMATCHES:');
  failures.forEach(f => console.log('   - ' + f));
}
console.log(`${'═'.repeat(62)}\n`);
process.exit(fail ? 1 : 0);
