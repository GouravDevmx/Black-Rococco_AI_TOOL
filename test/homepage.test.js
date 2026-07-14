// Renders the real homepage in a DOM and asserts it is not blank.
const { JSDOM } = require('jsdom');
const fs = require('fs');

const html = fs.readFileSync(__dirname + '/../public/index.html','utf8').replace('<!--SEO_HEAD-->','').replace('<!--SEO_BODY-->','');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
const { window } = dom;

// stub what the app needs
window.IntersectionObserver = class {
  constructor(cb){ this.cb = cb; }
  observe(el){ this.cb([{ isIntersecting: true, target: el }]); }
  unobserve(){}
};
window.matchMedia = () => ({ matches: false, addEventListener(){}, removeEventListener(){} });
window.fetch = async () => ({ ok:true, json: async () => ({}) });

const CONFIG = {
  settings: {
    brand: { name:'BLACK ROCOCO', rating:'4.9', footer:'© Black Rococo' },
    contact: { address1:'Calzada de los Pirules 260', address2:'Ciudad Granja, Zapopan',
      hours1:'Lun–Sáb 10:00–19:00', whatsappNumber:'3326553522',
      instagramUrl:'https://instagram.com/x', mapsUrl:'https://maps.google.com/x' },
    booking: { times:['10:00','11:00'], confirmNote:'' },
    featuredServiceIds: []
  },
  services: [
    { id:'s1', name:'Manicure Ruso', desc:'Técnica en seco.', price:350, dur:60, active:true, cat:'MANOS', imageUrls:['/a.jpg','/b.jpg'] },
    { id:'s2', name:'Poligel', desc:'Resistencia y ligereza.', price:450, dur:90, active:true, cat:'MANOS', imageUrls:['/c.jpg'] },
    { id:'s3', name:'Pedicure Spa', desc:'Ritual completo.', price:400, dur:75, active:true, cat:'PIES', imageUrls:[] }
  ],
  groupedServices: {},
  media: { gallery:[{id:'m1',url:'/g1.jpg',title:'Nail art'},{id:'m2',url:'/g2.jpg',title:''}], carousel:[{id:'m1',url:'/g1.jpg'}] },
  promotions: [], courses: [], staff: [{ id:'t1', name:'Ana', role:'Nail Artist', photoUrl:'/ana.jpg', bio:'Experta.' }],
  salonConfig: { heroImages:[{url:'/h1.jpg',title:'Hero',subtitle:'Sub'}], aboutUs:{ title:'', text:'Texto.', images:[] },
                 colors:[], bebidas:[], estilos:[], serviceCategories:[], galleryCategories:[] }
};

const src = fs.readFileSync(__dirname + '/../public/app.js','utf8');
window.eval(src.replace(/const api = [\s\S]*?\}\);/, 'const api = async () => (' + JSON.stringify(CONFIG) + ');'));

setTimeout(() => {
  const doc = window.document;
  const app = doc.getElementById('app');
  const text = app.textContent.replace(/\s+/g,' ').trim();
  let pass=0, fail=0;
  const t=(n,c)=>{ if(c){console.log('  ok    '+n);pass++;} else {console.log('  FAIL  '+n);fail++;} };

  console.log('\nhomepage renders\n');
  t('page is NOT blank', text.length > 200);
  t('hero headline present', !!doc.querySelector('.h1'));
  t('trust pills render', doc.querySelectorAll('.trust-pill').length === 3);
  t('stats render', doc.querySelectorAll('.stat').length === 4);
  t('3 service cards', doc.querySelectorAll('.svc-card').length === 3);
  t('service price shown', text.includes('350'));
  t('why list (4 points)', doc.querySelectorAll('.why-list li').length === 4);
  t('review carousel', doc.querySelectorAll('.review-card').length === 3);
  t('gallery tiles', doc.querySelectorAll('.ig-tile').length >= 2);
  t('steps (4)', doc.querySelectorAll('.step').length === 4);
  t('team card', doc.querySelectorAll('.team-card').length === 1);
  t('footer', !!doc.querySelector('.lux-footer'));
  t('WhatsApp FAB', !!doc.querySelector('.wa-fab'));
  t('bottom nav intact', !!doc.querySelector('.bottom-nav'));

  console.log('\nTHE BLANK-PAGE RISK\n');
  const fu = doc.querySelectorAll('.fade-up');
  const vis = doc.querySelectorAll('.fade-up.vis');
  t(`fade-up elements exist (${fu.length})`, fu.length > 0);
  t(`ALL fade-up revealed (${vis.length}/${fu.length}) — page would be blank otherwise`, fu.length === vis.length);

  console.log('\nfunctionality preserved\n');
  t('booking CTA wired', !!doc.querySelector('[data-tab="reservar"]'));
  t('service book buttons', doc.querySelectorAll('[data-book]').length >= 3);
  t('carousels initialised', doc.querySelectorAll('.auto-carousel').length > 0);
  t('images have alt text', [...doc.querySelectorAll('.ig-tile img')].every(i=>i.getAttribute('alt')));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail?1:0);
}, 300);
