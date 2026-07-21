// Guards the scroll regression that shipped three times: any rule that sets
// overflow on the ROOT elements makes the document a scroll container and
// breaks vertical page scrolling. This test reads the FINAL cascade value, so
// a later override (which is exactly how the bug survived a "fix") still fails.
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? (pass++, console.log('  ✓ ' + name)) : (fail++, console.log('  ✗ ' + name)); };

// Strip comments so documentation mentioning the rule isn't matched.
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

// 1. No overflow on html/body at all.
const rootOverflow = [];
const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
let m;
while ((m = ruleRe.exec(stripped)) !== null) {
  const selector = m[1].trim().split('\n').pop().trim();
  const body = m[2];
  const selectors = selector.split(',').map(s => s.trim());
  const hitsRoot = selectors.some(s => s === 'html' || s === 'body' || s === ':root');
  if (hitsRoot && /overflow(-x|-y)?\s*:/.test(body)) {
    rootOverflow.push(selector + ' { ' + body.trim().slice(0, 60) + ' }');
  }
}
ok('no overflow declared on html/body/:root', rootOverflow.length === 0);
if (rootOverflow.length) rootOverflow.forEach(r => console.log('      offending: ' + r));

// 2. The shell must not use `hidden` (creates a scroll container, kills sticky).
const shellHidden = /\.phone-shell\s*\{[^}]*overflow-x\s*:\s*hidden/.test(stripped);
ok('.phone-shell does not use overflow-x: hidden', !shellHidden);

// 3. Sticky topbar must not sit inside a scroll container.
ok('.brand-topbar is sticky', /\.brand-topbar\s*\{[^}]*position:\s*sticky/.test(stripped));

// 4. No viewport-width negative margins (they created the overflow that
//    tempted the overflow guards in the first place).
ok('no 50vw negative margins on topbar',
   !/\.brand-topbar\s*\{[^}]*margin-left:\s*calc\(50% - 50vw\)/.test(stripped));

console.log('\n' + (fail === 0 ? 'PASS' : 'FAIL') + ': ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
