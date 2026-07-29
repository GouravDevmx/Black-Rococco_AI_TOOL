// Guards the gallery conversion path.
//
// The gallery is the highest-intent screen in the app — she's looking at nail
// work and imagining it on herself. It previously ended on an Instagram link,
// which sent that intent to another platform instead of into a booking. These
// CTAs are the fix, and losing them again would be invisible to every other
// test while quietly costing bookings.
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n)); };

// Scope assertions to the gallery screen, not the whole file.
const gi = app.indexOf('function galleryScreen');
const gallery = app.slice(gi, app.indexOf('\nfunction masonryItem', gi));
const li = app.indexOf('function lightboxOverlay');
const lightbox = app.slice(li, app.indexOf('\nfunction promoAppliesToServiceClient', li));

console.log('gallery screen');
ok('gallery screen found', gi !== -1);
ok('sticky CTA while scrolling', /gallery-sticky-cta/.test(gallery));
ok('closing conversion card', /gallery-cta-card/.test(gallery));
ok('booking CTA present', /data-book-this-look/.test(gallery));
ok('instagram is no longer the only action',
   /data-book-this-look[\s\S]*instagramUrl/.test(gallery));

console.log('\nlightbox — peak intent');
ok('lightbox found', li !== -1);
ok('lightbox carries a booking CTA', /lightbox-cta/.test(lightbox) && /data-book-this-look/.test(lightbox));
ok('CTA passes the image category through', /data-book-this-look="\$\{esc\(item\.category/.test(lightbox));
ok('navigation arrows preserved', /data-lightbox-next/.test(lightbox));

console.log('\nhandler behaviour');
ok('handler exists', /target\.dataset\.bookThisLook !== undefined/.test(app));
ok('closes the lightbox before navigating', /state\.lightbox = null;/.test(app));
ok('matches gallery category to a service category',
   /String\(s\.cat \|\| ''\)\.toLowerCase\(\) === cat\.toLowerCase\(\)/.test(app));
ok('only matches ACTIVE services', /s\.active !== false && cat/.test(app));
ok('routes to the booking flow', /goClient\('reservar'\)/.test(app));

console.log('\nstyling / layering');
ok('lightbox CTA styled', /\.lightbox-cta\s*\{/.test(css));
ok('CTA does not block taps on the image', /pointer-events: none/.test(css) && /pointer-events: auto/.test(css));
ok('CTA lifts clear of a caption', /\.lightbox-caption ~ \.lightbox-cta/.test(css));
ok('sticky CTA clears the bottom nav', /\.gallery-sticky-cta[\s\S]{0,200}bottom: calc\(78px/.test(css));
ok('sticky CTA repositioned on desktop', /@media \(min-width: 900px\)[\s\S]{0,200}\.gallery-sticky-cta \{ bottom/.test(css));

console.log('\n' + (fail === 0 ? 'PASS' : 'FAIL') + ': ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
