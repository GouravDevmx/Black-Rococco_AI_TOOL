// Locks in the client-journey improvements: simple registration (no OTP
// bounce-out), the five-stage appointment flow, and the friendly notification
// centre. These are UX contracts — a refactor that silently reintroduces the
// OTP gate or drops a stage would pass every other test but hurt conversion.
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const cfg = fs.readFileSync(path.join(__dirname, '..', 'lib', 'config.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n)); };

console.log('registration');
ok('no client-side OTP generator', !/function generateOtp/.test(app));
ok('no send-OTP handler', !/data-client-send-otp/.test(app));
ok('no verify-OTP handler', !/data-client-verify-otp/.test(app));
ok('direct register button wired', /data-client-register/.test(app));
ok('register calls the API directly', /clientRegister\(\)/.test(app) && /'\/api\/client\/register'/.test(app));
ok('inline validation before network call', /Escribe tu WhatsApp a 10 d/.test(app));
ok('signup benefits shown', /auth-benefits/.test(app) && /auth-benefits/.test(css));

console.log('\nfive-stage appointment flow');
const STAGES = ['new', 'in_progress', 'pending_payment', 'confirmed', 'closed'];
ok('server STATUS_FLOW has all five stages',
   STAGES.every(s => new RegExp(`'${s}'`).test(cfg.match(/const STATUS_FLOW = \[[^\]]*\]/)[0])));
ok('server labels every stage', STAGES.every(s => new RegExp(`${s}:`).test(cfg)));
ok('legacy statuses still map (no broken old records)', /paid:/.test(cfg) && /cancelled:/.test(cfg));
ok('client statusLabel covers all five', STAGES.every(s => new RegExp(`${s}:`).test(app)));
ok('client cycle order matches server', /'new', 'in_progress', 'pending_payment', 'confirmed', 'closed'/.test(app));
ok('every stage has a badge colour', STAGES.every(s => new RegExp(`status-${s}`).test(css)));

console.log('\nnotification centre');
ok('filter pills present', /data-notif-filter/.test(app));
ok('filter state wired', /notifFilter/.test(app));
ok('cramped kanban board removed', !/class="kanban-board"/.test(app));
ok('cards show stage chips', /notif-stage-chip/.test(app) && /notif-stage-chip/.test(css));
ok('move actions still available', /data-move-appt/.test(app));

console.log('\n' + (fail === 0 ? 'PASS' : 'FAIL') + ': ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
