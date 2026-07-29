// Guards the hero price anchor and its admin configuration.
//
// A salon visitor's first question is "how much?". Answering it in the hero
// qualifies her instead of making her hunt — but not every salon wants to lead
// with price, so it's configurable rather than hardcoded.
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const settings = fs.readFileSync(path.join(__dirname, '..', 'lib', 'domains', 'admin-settings.js'), 'utf8');
const migrate = fs.readFileSync(path.join(__dirname, '..', 'lib', 'migrate.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n)); };

console.log('config model');
ok('migrate seeds priceAnchor defaults', /priceAnchor = \{/.test(migrate));
ok('defaults to enabled', /enabled: pa\.enabled !== false/.test(migrate));
ok('mode is auto unless manual', /mode: pa\.mode === 'manual' \? 'manual' : 'auto'/.test(migrate));
// The code uses a ternary with a .trim() check, which is stronger than `||`
// because it also rejects a whitespace-only label.
ok('label falls back to "Desde" (rejects blank/whitespace)',
   /pa\.label\.trim\(\) \? pa\.label : 'Desde'/.test(migrate));

console.log('\nadmin save endpoint');
ok('brand endpoint accepts priceAnchor', /priceAnchor: \(\(\) => \{/.test(settings));
ok('manualPrice is clamped non-negative', /Math\.max\(0, Math\.round\(Number\(inc\.manualPrice\)/.test(settings));
ok('mode is validated server-side', /inc\.mode === 'manual' \? 'manual' : 'auto'/.test(settings));

console.log('\nclient rendering');
ok('hero reads config, not hardcoded', /state\.config\?\.brand\?\.priceAnchor/.test(app));
ok('respects the off switch', /if \(cfg && cfg\.enabled === false\) return '';/.test(app));
ok('auto mode uses cheapest ACTIVE service', /filter\(s => s\.active !== false\)/.test(app));
ok('never renders a zero price', /if \(!amount\) return '';/.test(app));
ok('anchor is rendered inside the hero', /heroPriceAnchor\(\)/.test(app));

console.log('\nadmin UI');
ok('enable toggle present', /name="pa_enabled"/.test(app));
ok('mode selector present', /name="pa_mode"/.test(app));
ok('manual price field present', /name="pa_manualPrice"/.test(app));
ok('label + note fields present', /name="pa_label"/.test(app) && /name="pa_note"/.test(app));
ok('live preview shown to the admin', /price-anchor-preview/.test(app));
ok('flat pa_* fields nested before saving', /body\.priceAnchor = \{/.test(app));
ok('loose pa_* keys stripped from the payload', /k\.startsWith\('pa_'\)\) delete body\[k\]/.test(app));

console.log('\n' + (fail === 0 ? 'PASS' : 'FAIL') + ': ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
