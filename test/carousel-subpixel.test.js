// Regression guard for the sub-pixel rounding bug that froze the auto-drift in
// real browsers while passing every jsdom test.
//
// Browsers round element.scrollLeft to whole (device) pixels. The drift moves
// ~0.47px per frame at 60fps, so an implementation that reads scrollLeft back
// and adds a sub-pixel delta rounds to the same value forever and never moves.
// jsdom stores scrollLeft as a plain float, so it can't reproduce this — we
// simulate the rounding here instead.
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n)); };

// --- simulate a browser scroll box that rounds, like Safari/Firefox do ---
function makeTrack() {
  let stored = 0;
  return {
    scrollWidth: 1400, clientWidth: 320,
    children: [{}, {}, {}],
    classList: { add() {}, remove() {} },
    get scrollLeft() { return stored; },
    set scrollLeft(v) { stored = Math.round(v); } // <-- the browser behaviour
  };
}

const SPEED = 28;      // px per second, matches the app
const DT = 1 / 60;     // one frame at 60fps

// BROKEN approach (what shipped before): accumulate off the rounded readback.
(() => {
  const t = makeTrack();
  for (let i = 0; i < 120; i++) t.scrollLeft = t.scrollLeft + SPEED * DT;
  ok('naive readback accumulation FREEZES (documents the bug)', t.scrollLeft === 0);
})();

// FIXED approach: keep an authoritative float, write it out each frame.
(() => {
  const t = makeTrack();
  let driftPos = 0;
  for (let i = 0; i < 120; i++) { driftPos += SPEED * DT; t.scrollLeft = driftPos; }
  // 120 frames @ 60fps = 2s => ~56px
  ok('float accumulator moves (~56px in 2s)', t.scrollLeft >= 50 && t.scrollLeft <= 62);
})();

// --- the shipped source must use the float accumulator, not a readback ---
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const start = src.indexOf('function startScrollTrackTicker');
const body = src.slice(start, start + 2600);
ok('drift keeps its own float position', /_driftPos/.test(body));
ok('drift does NOT accumulate off scrollLeft readback',
   !/=\s*track\.scrollLeft\s*\+\s*SCROLL_SPEED/.test(body));
ok('accumulator is written out to scrollLeft', /scrollLeft\s*=\s*track\._driftPos/.test(body));
ok('accumulator resyncs after a manual scroll', /_driftPos\s*=\s*t\.scrollLeft/.test(src));

console.log('\n' + (fail === 0 ? 'PASS' : 'FAIL') + ': ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
