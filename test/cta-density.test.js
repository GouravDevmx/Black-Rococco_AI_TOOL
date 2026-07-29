// Guards homepage CTA coverage and its density setting.
//
// The page has nine sections. With only a hero CTA a visitor could scroll past
// team, about and blog without ever meeting a booking prompt. Density is a
// single admin choice rather than nine per-section toggles: nine decisions the
// salon has no conversion data for, and switching them all on causes CTA
// fatigue that LOWERS conversion.
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const migrate = fs.readFileSync(path.join(__dirname, '..', 'lib', 'migrate.js'), 'utf8');
const settings = fs.readFileSync(path.join(__dirname, '..', 'lib', 'domains', 'admin-settings.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n)); };

console.log('config model');
ok('migrate seeds cta defaults', /ctas = \{/.test(migrate));
ok('defaults to balanced', /\? ct\.density : 'balanced'/.test(migrate));
ok('density validated server-side', /\['minimal', 'balanced', 'high'\]\.includes\(inc\.density\)/.test(settings));

console.log('\nplacement map');
const m = app.match(/const CTA_PLACEMENTS = \{[\s\S]*?\};/);
ok('placement map exists', !!m);
const map = m ? m[0] : '';
ok('minimal = 2 placements', (map.match(/minimal:\s*\[(.*?)\]/)?.[1].split(',').length) === 2);
ok('balanced = 4 placements', (map.match(/balanced:\s*\[(.*?)\]/)?.[1].split(',').length) === 4);
ok('high = 6 placements', (map.match(/high:\s*\[(.*?)\]/)?.[1].split(',').length) === 6);
ok('blog/academy excluded from lower densities',
   !/minimal:\s*\[[^\]]*blog/.test(map) && !/balanced:\s*\[[^\]]*blog/.test(map));

console.log('\nEVERY placement key must actually be rendered on the homepage');
// This is the check that catches the real bug: a key listed in the map with no
// matching sectionCta() call in homeScreen silently yields fewer CTAs than the
// admin was promised.
const home = app.slice(app.indexOf('function homeScreen'), app.indexOf('\nfunction ', app.indexOf('function homeScreen') + 10));
const keys = [...new Set([...map.matchAll(/'([a-z]+)'/g)].map(x => x[1]))].filter(k => k !== 'minimal' && k !== 'balanced' && k !== 'high');
let missing = keys.filter(k => !home.includes(`sectionCta('${k}')`));
ok('no placement key is missing from homeScreen' + (missing.length ? ' → MISSING: ' + missing.join(', ') : ''), missing.length === 0);
console.log('   keys rendered:', keys.filter(k => home.includes(`sectionCta('${k}')`)).join(', '));

console.log('\nadmin UI');
ok('density selector', /name="cta_density"/.test(app));
ok('custom label field', /name="cta_label"/.test(app));
ok('optional note field', /name="cta_note"/.test(app));
ok('shows where CTAs will land', /ctaPlacementNames/.test(app));
ok('flat cta_* fields nested before save', /body\.ctas = \{/.test(app));
ok('loose cta_* keys stripped', /k\.startsWith\('cta_'\)\) delete body\[k\]/.test(app));

console.log('\nhero independence');
ok('hero CTA is separate from density', /hero-cta-row/.test(app));

console.log('\n' + (fail === 0 ? 'PASS' : 'FAIL') + ': ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
