// Guards the "two clients, one hour" failure: client A starts checkout on
// 10:00, client B's stale page still offers 10:00, B fills the whole form and
// only then gets an error. The database always rejected the double booking —
// data was never at risk — but the second client wasted her time, which is
// where people abandon. Holds make the slot disappear for B up front.
const holds = require('../lib/slot-holds');
let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n)); };

const D = '2026-12-01', T = '10:00';
holds.releaseAllFor('A'); holds.releaseAllFor('B');

console.log('basic hold semantics');
ok('A can hold a free slot', holds.hold(D, T, ['hands'], 'A') === true);
ok('slot reads as held for B', holds.isHeldByOther(D, T, 'hands', 'B') === true);
ok('slot does NOT read as held for A herself', holds.isHeldByOther(D, T, 'hands', 'A') === false);
ok('B cannot hold the same area', holds.hold(D, T, ['hands'], 'B') === false);

console.log('\nindependent specialists');
ok('B can still hold FEET at the same time', holds.hold(D, T, ['feet'], 'B') === true);
ok('feet held for A now', holds.isHeldByOther(D, T, 'feet', 'A') === true);

console.log('\nrelease');
holds.releaseAllFor('A');
ok('A releasing frees hands', holds.isHeldByOther(D, T, 'hands', 'B') === false);
ok("A's release did not touch B's feet hold", holds.isHeldByOther(D, T, 'feet', 'A') === true);
holds.releaseAllFor('B');
ok('B releasing frees feet', holds.isHeldByOther(D, T, 'feet', 'A') === false);

console.log('\npartial-hold safety');
// A multi-area visit must hold ALL its areas or none — a partial hold would
// strand one specialist while the visit can never actually be booked.
holds.hold(D, T, ['feet'], 'B');
ok('combo hold refused when one area is taken', holds.hold(D, T, ['hands', 'feet'], 'A') === false);
ok('refused combo left hands FREE (no partial hold)', holds.isHeldByOther(D, T, 'hands', 'A') === false);
holds.releaseAllFor('B');

console.log('\nmoving between times');
holds.hold(D, '11:00', ['hands'], 'A');
holds.releaseAllFor('A');            // what the server does before re-holding
holds.hold(D, '12:00', ['hands'], 'A');
ok('old time freed when client picks another', holds.isHeldByOther(D, '11:00', 'hands', 'B') === false);
ok('new time held', holds.isHeldByOther(D, '12:00', 'hands', 'B') === true);
holds.releaseAllFor('A');

console.log('\n' + (fail === 0 ? 'PASS' : 'FAIL') + ': ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
