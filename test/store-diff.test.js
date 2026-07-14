// Tests for the record-level diff engine (EPIC 1 / STORY 1).
// Run: node test/store-diff.test.js

const assert = require('assert');
const { diffCollection, fingerprint } = require('../lib/store');

const FIELDS = [['id', 'id'], ['name', 'name'], ['active', 'active']];

function baselineOf(items) {
  const m = new Map();
  for (const i of items) m.set(i.id, fingerprint(i, FIELDS));
  return m;
}

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}\n        ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('\nrecord-level diff engine\n');

test('unchanged records produce zero writes', () => {
  const rows = [{ id: 'a', name: 'Uñas', active: true }, { id: 'b', name: 'Pies', active: true }];
  const d = diffCollection(baselineOf(rows), rows, FIELDS);
  assert.deepStrictEqual(d.inserts, []);
  assert.deepStrictEqual(d.updates, []);
  assert.deepStrictEqual(d.deletes, []);
});

test('only the modified record is updated', () => {
  const before = [{ id: 'a', name: 'Uñas', active: true }, { id: 'b', name: 'Pies', active: true }];
  const base = baselineOf(before);
  const after = [{ id: 'a', name: 'Uñas', active: true }, { id: 'b', name: 'Pies', active: false }];
  const d = diffCollection(base, after, FIELDS);
  assert.strictEqual(d.inserts.length, 0);
  assert.strictEqual(d.updates.length, 1);
  assert.strictEqual(d.updates[0].id, 'b');
  assert.strictEqual(d.deletes.length, 0);
});

test('only the new record is inserted', () => {
  const before = [{ id: 'a', name: 'Uñas', active: true }];
  const base = baselineOf(before);
  const after = [...before, { id: 'c', name: 'Nuevo', active: true }];
  const d = diffCollection(base, after, FIELDS);
  assert.strictEqual(d.updates.length, 0);
  assert.strictEqual(d.inserts.length, 1);
  assert.strictEqual(d.inserts[0].id, 'c');
  assert.strictEqual(d.deletes.length, 0);
});

test('only the removed record is deleted', () => {
  const before = [{ id: 'a', name: 'Uñas', active: true }, { id: 'b', name: 'Pies', active: true }];
  const base = baselineOf(before);
  const after = before.filter(r => r.id !== 'b');
  const d = diffCollection(base, after, FIELDS);
  assert.strictEqual(d.inserts.length, 0);
  assert.strictEqual(d.updates.length, 0);
  assert.deepStrictEqual(d.deletes, ['b']);
});

// THE REGRESSION THIS WHOLE REFACTOR EXISTS TO PREVENT.
// Old behaviour: request A's stale in-memory copy deleted row 'x' that
// request B had created in the meantime. The diff must never delete a row
// that was not in A's own baseline.
test('a stale request does NOT delete rows created concurrently by another request', () => {
  // Request A reads: [1, 2, 3]
  const aRead = [
    { id: '1', name: 'one', active: true },
    { id: '2', name: 'two', active: true },
    { id: '3', name: 'three', active: true }
  ];
  const aBaseline = baselineOf(aRead);

  // Meanwhile request B inserts row 'x' straight into the table.
  // Request A never saw it and its in-memory array still holds only [1,2,3].
  const aWrites = aRead;

  const d = diffCollection(aBaseline, aWrites, FIELDS);

  // Row 'x' must NOT appear in deletes — A's baseline never contained it.
  assert.ok(!d.deletes.includes('x'), 'stale request tried to delete a concurrently-created row');
  assert.deepStrictEqual(d.deletes, [], 'stale request should delete nothing at all');
});

test('records without an id are ignored (never written)', () => {
  const base = baselineOf([]);
  const d = diffCollection(base, [{ name: 'no id' }, { id: null, name: 'null id' }], FIELDS);
  assert.strictEqual(d.inserts.length, 0);
});

test('fingerprint is stable across key order', () => {
  const a = { id: '1', name: 'x', active: true };
  const b = { active: true, name: 'x', id: '1' };
  assert.strictEqual(fingerprint(a, FIELDS), fingerprint(b, FIELDS));
});

test('fingerprint distinguishes undefined from null', () => {
  const withNull = { id: '1', name: null, active: true };
  const withValue = { id: '1', name: 'x', active: true };
  assert.notStrictEqual(fingerprint(withNull, FIELDS), fingerprint(withValue, FIELDS));
});

test('deep field changes (arrays/objects) are detected', () => {
  const F = [['id', 'id'], ['imageUrls', 'image_urls']];
  const before = [{ id: 's1', imageUrls: ['a.jpg'] }];
  const base = new Map([['s1', fingerprint(before[0], F)]]);
  const after = [{ id: 's1', imageUrls: ['a.jpg', 'b.jpg'] }];
  const d = diffCollection(base, after, F);
  assert.strictEqual(d.updates.length, 1, 'adding an image to imageUrls must count as a change');
});

console.log(`\n${passed} passed\n`);
