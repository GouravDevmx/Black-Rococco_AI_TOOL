// Guards the client-side desktop/tablet layer.
//
// The app is mobile-first with a 430px shell. Components added after the
// original responsive pass had no desktop rules, so on a laptop they rendered
// as a narrow ribbon in a sea of empty space. This test checks the breakpoints
// exist AND — more importantly — that the client rules stay scoped away from
// the admin panel, which has its own layout.
const fs = require('fs');
const path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n)); };

const i = css.indexOf('CLIENT-SIDE TABLET & DESKTOP LAYER');
ok('desktop layer exists', i !== -1);
const block = css.slice(i);
// Strip comments so prose mentioning a selector isn't mistaken for a rule.
const rules = block.replace(/\/\*[\s\S]*?\*\//g, '');

console.log('\nbreakpoints');
ok('tablet 720px', /@media \(min-width: 720px\)/.test(rules));
ok('desktop 1000px', /@media \(min-width: 1000px\)/.test(rules));
ok('wide 1280px', /@media \(min-width: 1280px\)/.test(rules));

console.log('\nlayout upgrades');
ok('modals become centred dialogs', /\.modal-overlay\s*\{[^}]*align-items:\s*center/.test(rules));
ok('service menu becomes a grid', /\.booking-step \.card-list[\s\S]{0,200}grid-template-columns/.test(rules));
ok('visit summary becomes a sidebar', /grid-area:\s*summary/.test(rules));
ok('time grid gains columns', /\.time-grid\s*\{\s*grid-template-columns:\s*repeat\((5|6|8)/.test(rules));
ok('carousels widen on desktop', /\.promo-slide\s*\{\s*flex-basis/.test(rules));
ok('hover affordances gated to pointer devices', /@media \(hover: hover\) and \(pointer: fine\)/.test(rules));

console.log('\nscoping — must not reach the admin panel');
ok('no .admin-screen RULES in the client layer', !/\.admin-screen\s*[,{]/.test(rules));
// The grid rules are scoped under .booking-step / .section-tight. Admin must
// never use those wrappers, or the client grid would reflow the admin lists.
const adminPart = app.slice(app.indexOf('function adminScreen'));
ok('admin never uses .booking-step', !/class="[^"]*booking-step/.test(adminPart));
ok('admin never uses .section-tight', !/class="[^"]*section-tight/.test(adminPart));

console.log('\nlayout hook');
ok('has-visit class applied when services selected', /booking-step \$\{\(state\.booking\.serviceIds \|\| \[\]\)\.length \? 'has-visit'/.test(app));

console.log('\n' + (fail === 0 ? 'PASS' : 'FAIL') + ': ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
