// Guards that every content section still routes its images through a carousel
// component. A refactor that accidentally drops autoCarousel/scroll-track from
// a section would slip past unit tests but break the client UX — this catches
// it by asserting the render functions still reference the carousel helpers.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n)); };

// Helper: slice a function body by name so assertions are scoped.
function fn(name) {
  const i = src.indexOf('function ' + name);
  if (i === -1) return '';
  // crude but effective: read up to the next top-level "function " at col 0
  const rest = src.slice(i + 10);
  const next = rest.search(/\nfunction /);
  return next === -1 ? rest : rest.slice(0, next);
}

ok('promoCarousel uses horizontal scroll track', /data-scroll-track/.test(fn('promoCarousel')));
ok('promo track auto-scrolls', /data-scroll-autoplay/.test(fn('promoCarousel')));
ok('featuredServicesCarousel uses scroll track', /data-scroll-track/.test(fn('featuredServicesCarousel')));
ok('serviceButton renders a carousel for images', /autoCarousel\(/.test(fn('serviceButton')));
ok('courseImageCarousel uses autoCarousel', /autoCarousel\(/.test(fn('courseImageCarousel')));
ok('homeScreen gallery uses scroll track', /data-scroll-track/.test(fn('homeScreen')));
ok('homeScreen hero uses autoCarousel', /autoCarousel\(/.test(fn('homeScreen')));

// Every <img> rendered by autoCarousel must carry the onerror fallback.
ok('autoCarousel images have onerror fallback', /onerror="\$\{IMG_FALLBACK\}"/.test(fn('autoCarousel')));

// The generic nav + arrow handlers must exist.
ok('ac arrow handler wired', /data-ac-next|data-ac-prev/.test(src) && /carouselAdvance/.test(src));
ok('ac dot handler wired', /dataset\.acGo/.test(src));
ok('scroll-track nav handler wired', /data-scroll-nav/.test(src));

// Tickers must be cleared before restart (no interval leak on re-render).
ok('vertical ticker cleared before restart', /clearInterval\(carouselTicker\)/.test(src));
ok('horizontal drift cancelled before restart', /cancelAnimationFrame\(scrollTrackRAF\)/.test(src));
ok('horizontal drift is smooth (RAF, not interval jumps)', /requestAnimationFrame/.test(src) && /is-auto-drifting/.test(src));

console.log('\n' + (fail === 0 ? 'PASS' : 'FAIL') + ': ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
