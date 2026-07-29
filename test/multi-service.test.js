// Locks in the multi-service visit scheduling rules. These are the "expert"
// behaviours that are easy to break in a refactor and expensive to get wrong:
// double-booking a specialist, or quoting 2 hours for a visit that takes 1.
const { planVisit, canScheduleVisit, capacityForArea, serviceArea } = require('../lib/domains/availability');
let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n)); };

const db = {
  settings: { booking: { times: ['10:00', '11:00', '12:00'] } },
  staff: [
    { id: 'st_h', name: 'Manos', area: 'hands', active: true },
    { id: 'st_f', name: 'Pies',  area: 'feet',  active: true }
  ],
  services: [
    { id: 'mani', name: 'Mani', dur: 60, area: 'hands' },
    { id: 'pedi', name: 'Pedi', dur: 60, area: 'feet'  },
    { id: 'art',  name: 'Art',  dur: 30, area: 'hands' }
  ],
  appointments: []
};

console.log('duration planning');
ok('single service = its own duration', planVisit(db, ['mani']).totalMinutes === 60);
ok('different areas run in PARALLEL (60+60 = 60)', planVisit(db, ['mani', 'pedi']).totalMinutes === 60);
ok('same area runs SEQUENTIAL (60+30 = 90)', planVisit(db, ['mani', 'art']).totalMinutes === 90);
ok('parallel visit reports 2 areas', planVisit(db, ['mani', 'pedi']).areas.length === 2);
ok('sequential visit reports 1 area', planVisit(db, ['mani', 'art']).areas.length === 1);

console.log('\ncapacity');
ok('one specialist per area', capacityForArea(db, 'hands') === 1 && capacityForArea(db, 'feet') === 1);
ok('service area resolves', serviceArea(db.services[1]) === 'feet');

console.log('\nscheduling against existing bookings');
ok('empty agenda: combo fits', canScheduleVisit(db, '2026-10-05', '10:00', ['mani', 'pedi']));

// One client already taking the hands specialist at 10:00
db.appointments.push({ id: 'a1', groupId: 'g1', date: '2026-10-05', time: '10:00', serviceId: 'mani', status: 'new' });
ok('hands now full at 10:00', !canScheduleVisit(db, '2026-10-05', '10:00', ['mani']));
ok('feet still free at 10:00', canScheduleVisit(db, '2026-10-05', '10:00', ['pedi']));
ok('combo blocked (hands leg unavailable)', !canScheduleVisit(db, '2026-10-05', '10:00', ['mani', 'pedi']));
ok('later slot still fine', canScheduleVisit(db, '2026-10-05', '12:00', ['mani', 'pedi']));

// A multi-service client occupies ONE specialist per area, not two.
db.appointments.length = 0;
db.appointments.push(
  { id: 'b1', groupId: 'g2', date: '2026-10-06', time: '10:00', serviceId: 'mani', status: 'new' },
  { id: 'b2', groupId: 'g2', date: '2026-10-06', time: '11:00', serviceId: 'art',  status: 'new' }
);
ok('same-group sequential counts as one client', !canScheduleVisit(db, '2026-10-06', '10:00', ['mani']));
ok('cancelled bookings free the slot',
   (db.appointments.forEach(a => { a.status = 'deleted'; }),
    canScheduleVisit(db, '2026-10-06', '10:00', ['mani'])));

console.log('\n' + (fail === 0 ? 'PASS' : 'FAIL') + ': ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
