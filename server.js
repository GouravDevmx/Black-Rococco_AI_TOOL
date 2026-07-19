// P0-1 regression: the weekly agenda must not shift by a day in the evening,
// and must not jump to next week on a Sunday.
process.env.TZ = 'America/Mexico_City'; // Guadalajara, UTC-6

const assert = require('assert');
const fs = require('fs');

const src = fs.readFileSync(__dirname + '/../public/app.js', 'utf8');
const start = src.indexOf('function ymdLocal');
const end = src.indexOf('\nfunction ', src.indexOf('function startOfWeekLocal') + 10);
const helpers = src.slice(start, end);
const { ymdLocal, startOfWeekLocal } = new Function(helpers + '; return { ymdLocal, startOfWeekLocal };')();

let pass = 0, fail = 0;
const t = (n, c) => { if (c) { console.log('  ok  ' + n); pass++; } else { console.log('  FAIL  ' + n); fail++; } };

console.log('\nweekly agenda dates (TZ=America/Mexico_City, UTC-6)\n');

// THE BUG: after 18:00 local, toISOString() rolls to tomorrow in UTC.
const evening = new Date(2026, 6, 13, 21, 30); // Mon 13 Jul 2026, 21:30 local
t('9:30pm Monday still reads as Monday the 13th', ymdLocal(evening) === '2026-07-13');
t('  (old toISOString would have said the 14th)', evening.toISOString().slice(0, 10) === '2026-07-14');

const lateNight = new Date(2026, 6, 13, 23, 59);
t('11:59pm still the 13th', ymdLocal(lateNight) === '2026-07-13');

const midnight = new Date(2026, 6, 14, 0, 1);
t('12:01am is the 14th', ymdLocal(midnight) === '2026-07-14');

console.log('\nweek start (Monday), evenings included\n');
// Mon 13 -> Sun 19 July 2026
for (const [label, d] of [
  ['Monday morning', new Date(2026, 6, 13, 9, 0)],
  ['Monday 9:30pm', new Date(2026, 6, 13, 21, 30)],
  ['Wednesday 8pm', new Date(2026, 6, 15, 20, 0)],
  ['Saturday 11pm', new Date(2026, 6, 18, 23, 0)],
  ['SUNDAY 10pm', new Date(2026, 6, 19, 22, 0)]
]) {
  t(`${label} -> week starts Mon 2026-07-13`, ymdLocal(startOfWeekLocal(d)) === '2026-07-13');
}

// THE SECOND BUG: on Sunday, the old `getDate() - getDay() + 1` returned TOMORROW.
const sunday = new Date(2026, 6, 19, 22, 0);
const week = [];
const sw = startOfWeekLocal(sunday);
for (let i = 0; i < 7; i++) { const d = new Date(sw); d.setDate(sw.getDate() + i); week.push(ymdLocal(d)); }
t('Sunday appears INSIDE its own week grid', week.includes('2026-07-19'));
t('week is Mon..Sun', week[0] === '2026-07-13' && week[6] === '2026-07-19');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
