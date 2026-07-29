// Guards the hero call-to-action.
//
// The booking button used to live in a .cta-row BELOW the hero, so on a phone
// a full-height hero image pushed it off the first screen — the moment of
// highest intent had no way to act. It now sits inside the hero overlay.
// A refactor that moves it back out would silently cost bookings without
// breaking anything a normal test would notice.
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n)); };

// Isolate the hero markup so we're asserting about the hero, not the page.
const hi = app.indexOf('<!-- 1. HERO -->');
const hero = app.slice(hi, app.indexOf('<!-- 2. SERVICES', hi));
ok('hero block found', hi !== -1 && hero.length > 0);

console.log('\nCTA placement');
ok('booking CTA is INSIDE the hero', /hero-cta-row/.test(hero) && /data-tab="reservar"/.test(hero));
ok('secondary services CTA present', /data-tab="servicios"/.test(hero));
ok('CTAs sit in the hero overlay (over the image)', /hero-overlay[\s\S]*hero-cta-row/.test(hero));
ok('no stale duplicate .cta-row below the hero', !/class="section-tight cta-row"/.test(app));

console.log('\nprice anchor');
ok('anchor helper exists', /function heroPriceAnchor/.test(app));
ok('anchor rendered in hero', /heroPriceAnchor\(\)/.test(hero));
// Guard is now `!amount`, which is broader than the old `!prices.length`:
// it also catches a manual price of 0, not just an empty service list.
ok('anchor hides when there is no real price (no "Desde $0")',
   /if \(!amount\) return '';/.test(app));

console.log('\nstyling');
ok('hero CTA styles exist', /\.hero-cta-row\s*\{/.test(css));
ok('secondary button styled for dark hero', /\.btn-ghost-light\s*\{/.test(css));
ok('CTAs go side-by-side on wider screens', /@media \(min-width: 560px\)[\s\S]{0,400}\.hero-cta-row \{ flex-direction: row/.test(css));
ok('short phones keep CTA above the fold', /@media \(max-height: 720px\)[\s\S]{0,200}\.hero \{ min-height/.test(css));

console.log('\nmust not break the hero carousel');
ok('caption hooks still present', /data-hero-title/.test(hero) && /data-hero-subtitle/.test(hero));
ok('hero still uses autoCarousel', /autoCarousel\(/.test(hero));
ok('CTAs are outside the caption elements (swap cannot wipe them)',
   !/data-hero-title[^>]*>[\s\S]*hero-cta-row[\s\S]*<\/div>\s*<div class="hero-subtitle"/.test(hero));

console.log('\n' + (fail === 0 ? 'PASS' : 'FAIL') + ': ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
