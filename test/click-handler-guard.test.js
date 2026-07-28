// Guards the temporal-dead-zone bug where a click-handler branch was inserted
// above the `const target = ...` declaration, which throws on the FIRST click
// and silently breaks the entire app. We assert that no `target.` usage inside
// the click listener appears before `const target` is declared.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n)); };

const start = src.indexOf("app.addEventListener('click'");
ok('click listener found', start !== -1);
// End the scan at the next top-level addEventListener to stay within this handler.
const end = src.indexOf("app.addEventListener('change'", start);
const body = src.slice(start, end === -1 ? start + 8000 : end);

const declIdx = body.indexOf('const target = event.target.closest');
ok('`const target` declaration present', declIdx !== -1);

// Any bare `target.` (not event.target / clientAuth.target etc.) before decl = TDZ bug.
const beforeDecl = body.slice(0, declIdx);
const tdz = /(^|[^.\w])target\.\w/.test(beforeDecl.replace(/event\.target/g, 'event_target'));
ok('no `target.` used before it is declared (no TDZ)', !tdz);

console.log('\n' + (fail === 0 ? 'PASS' : 'FAIL') + ': ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
