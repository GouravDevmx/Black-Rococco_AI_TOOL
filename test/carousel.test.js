const { JSDOM } = require('jsdom');
const fs = require('fs');

const dom = new JSDOM(`<!DOCTYPE html><body><div id="app"></div></body>`, { pretendToBeVisual: true });
global.window = dom.window; global.document = dom.window.document;
global.state = { config: { brand: { heroTitle: 'HT', heroSubtitle: 'HS' } }, heroSlide: 0 };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// load just the engine
const src = fs.readFileSync(__dirname + '/../public/app.js','utf8');
const start = src.indexOf('const CAROUSEL_INTERVAL_MS');
const end = src.indexOf('function socialIconSvg');
const code = src.slice(start, end);
const ctx = new Function('esc','state','document','window', code + `
  return { autoCarousel, carouselGo, carouselAdvance, startCarouselTicker, CAROUSEL_INTERVAL_MS };`);
const C = ctx(esc, global.state, document, dom.window);

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { console.log('  ok  ' + name); pass++; } else { console.log('  FAIL ' + name); fail++; } };

console.log('\ninterval');
t('is 3000ms', C.CAROUSEL_INTERVAL_MS === 3000);

console.log('\nservice card with 3 images');
document.getElementById('app').innerHTML = C.autoCarousel(['/1.jpg','/2.jpg','/3.jpg'], { alt:'Ruso', className:'ac-fill' });
const el = document.querySelector('.auto-carousel');
t('renders all 3 slides (not just the first)', document.querySelectorAll('.ac-slide').length === 3);
t('renders 3 dots', document.querySelectorAll('.ac-dot').length === 3);
t('autoplay enabled', el.hasAttribute('data-ac-autoplay'));
t('slide 1 starts active', document.querySelectorAll('.ac-slide')[0].classList.contains('active'));

console.log('\nadvancing (the thing that was impossible on mobile)');
C.carouselAdvance(el, 1);
const slides = [...document.querySelectorAll('.ac-slide')];
t('slide 2 now active', slides[1].classList.contains('active'));
t('slide 1 no longer active', !slides[0].classList.contains('active'));
t('dot 2 synced', document.querySelectorAll('.ac-dot')[1].classList.contains('active'));
C.carouselAdvance(el, 1);
t('slide 3 active', slides[2].classList.contains('active'));
C.carouselAdvance(el, 1);
t('wraps back to slide 1', slides[0].classList.contains('active'));
C.carouselAdvance(el, -1);
t('backwards wraps to slide 3', slides[2].classList.contains('active'));

console.log('\njump via dot');
C.carouselGo(el, 1);
t('jumps to slide 2', slides[1].classList.contains('active'));

console.log('\nsingle image');
document.getElementById('app').innerHTML = C.autoCarousel(['/only.jpg'], {});
t('1 slide', document.querySelectorAll('.ac-slide').length === 1);
t('no dots', document.querySelectorAll('.ac-dot').length === 0);
t('no autoplay', !document.querySelector('.auto-carousel').hasAttribute('data-ac-autoplay'));

console.log('\nmodal (arrows + counter)');
document.getElementById('app').innerHTML = C.autoCarousel(['/1.jpg','/2.jpg','/3.jpg'], { arrows:true, counter:true });
const m = document.querySelector('.auto-carousel');
t('has arrows', !!document.querySelector('[data-ac-next]'));
t('counter reads 1 / 3', document.querySelector('.ac-counter').textContent === '1 / 3');
C.carouselAdvance(m, 1);
t('counter updates to 2 / 3', document.querySelector('.ac-counter').textContent === '2 / 3');

console.log('\nhero captions');
document.getElementById('app').innerHTML =
  C.autoCarousel(['/1.jpg','/2.jpg'], { captions:[{title:'Uno',subtitle:'A'},{title:'Dos',subtitle:'B'}] }) +
  '<div data-hero-title></div><div data-hero-subtitle></div>';
const h = document.querySelector('.auto-carousel');
C.carouselGo(h, 1);
t('hero caption swaps in place', document.querySelector('[data-hero-title]').textContent === 'Dos');
t('hero state index tracked', global.state.heroSlide === 1);

console.log('\nsafety');
t('empty list -> no markup', C.autoCarousel([]) === '');
t('nulls filtered', (C.autoCarousel(['/a.jpg', null, '']).match(/ac-slide/g)||[]).length === 1);
t('alt is escaped', !C.autoCarousel(['/a.jpg'], { alt:'"><script>' }).includes('<script>'));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
