/**
 * FortunaTrade v2 — browser verification harness.
 * Captures screenshots of every view and reports console/page errors.
 * Run with:  node docs/verify-ui.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.FT_BASE || 'http://127.0.0.1:3030';
const OUT = 'docs/screenshots';

const browser = await chromium.launch();
const errors = [];

// ─── Desktop ───────────────────────────────────────────────────────────────
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('requestfailed', r => errors.push('REQFAIL: ' + r.url()));

await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
await page.screenshot({ path: `${OUT}/01-dashboard.png`, fullPage: true });

const tiles = await page.$$eval('#stat-tiles .stat', els =>
  els.map(e => e.querySelector('.stat__label').textContent + ' = ' + e.querySelector('.stat__value').textContent));
console.log('STAT TILES');
tiles.forEach(t => console.log('  ' + t));

console.log('position rows:', (await page.$$eval('#positions-body tr', r => r.length)),
            '| mover rows:', (await page.$$eval('#movers-body tr', r => r.length)),
            '| ticker items:', (await page.$$('.ticker__item')).length);

const meters = await page.$$eval('#risk-meters .meter-row', els =>
  els.map(e => e.querySelector('.meter-row__label').textContent + ': ' + e.querySelector('.meter-row__value').textContent.trim()));
console.log('RISK METERS');
meters.forEach(m => console.log('  ' + m));
console.log('risk verdict:', await page.textContent('#risk-verdict'));
console.log('vix:', await page.textContent('#vix-value'), await page.textContent('#vix-label'),
            '| session:', await page.textContent('#market-session'));

// ─── Every view ────────────────────────────────────────────────────────────
const views = ['markets', 'portfolio', 'orders', 'screener', 'agents', 'options', 'risk', 'architecture', 'data'];
for (const v of views) {
  await page.click(`.nav__item[data-view="${v}"]`);
  await page.waitForTimeout(400);
  const info = await page.$eval(`.view[data-view="${v}"]`, e => [e.hidden, e.innerHTML.length]);
  console.log(`view ${v.padEnd(13)} hidden=${info[0]} htmlLen=${info[1]}`);
  await page.screenshot({ path: `${OUT}/view-${v}.png` });
}

// ─── Options calculator interaction ────────────────────────────────────────
await page.click('.nav__item[data-view="options"]');
await page.waitForTimeout(300);
const before = await page.textContent('#opt-out');
await page.fill('#opt-s', '120');
await page.fill('#opt-k', '110');
await page.fill('#opt-t', '60');
await page.waitForTimeout(300);
const after = await page.textContent('#opt-out');
console.log('options calculator recalculates:', before !== after);
await page.screenshot({ path: `${OUT}/view-options-live.png` });

// ─── Mobile ────────────────────────────────────────────────────────────────
const mob = await browser.newPage({ viewport: { width: 390, height: 844 } });
mob.on('pageerror', e => errors.push('MOBILE PAGEERROR: ' + e.message));
await mob.goto(BASE + '/', { waitUntil: 'networkidle' });
await mob.waitForTimeout(1200);
await mob.screenshot({ path: `${OUT}/02-mobile.png`, fullPage: true });
console.log('mobile nav off-canvas transform:', await mob.$eval('#nav', e => getComputedStyle(e).transform));
await mob.click('#hamburger');
await mob.waitForTimeout(400);
console.log('mobile nav opened transform     :', await mob.$eval('#nav', e => getComputedStyle(e).transform));
await mob.screenshot({ path: `${OUT}/03-mobile-nav.png` });

console.log('\n' + (errors.length ? 'ISSUES:\n' + errors.join('\n') : 'NO CONSOLE / PAGE ERRORS'));
await browser.close();
