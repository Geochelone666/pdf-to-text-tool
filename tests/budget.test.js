// Browser smoke tests for index.html (run: npm test).
// Uses Playwright's Chromium; no server is needed because the page is a single file.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.resolve(__dirname, '..', 'index.html');
let browser, page, errors;

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });
beforeEach(async () => {
  page = await browser.newPage();
  errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(PAGE);
});

// "CAD 3,495.00" / "-CAD 2,295.00" / "+CAD 5.00" -> number
const amount = async sel => {
  const text = (await page.textContent(sel)).trim();
  const value = Number(text.replace(/[^\d.]/g, ''));
  return text.startsWith('-') ? -value : value;
};
const fill = async (sel, value) => { await page.fill(sel, String(value)); };
const noNaN = async () => assert.doesNotMatch(await page.innerText('body'), /NaN|Infinity|undefined/);

test('default example: tuition per month and totals', async () => {
  // 8000 / 4 = 2000 + 700 + 450 + 100 + 65 + 80 + 100
  assert.equal(await amount('#total-expense'), 3495);
  assert.equal(await amount('#total-income'), 1200);
  assert.equal(await amount('#balance'), -2295);
  assert.match(await page.getAttribute('#balance-card', 'class'), /negative/);
  assert.equal(await page.locator('#tips li').count() >= 3, true);
  await noNaN();
  assert.deepEqual(errors, []);
});

test('tuition is rounded to cents and the breakdown sums to the total', async () => {
  await page.selectOption('#months', '3');
  assert.equal(await amount('#total-expense'), 4161.67); // 2666.67 + 1495
  const parts = await page.$$eval('#breakdown .chart-label span:last-child', els => els.map(e => e.textContent));
  const sum = parts.map(t => Number(t.replace(/[^\d.]/g, ''))).reduce((a, b) => a + b, 0);
  assert.equal(Math.round(sum * 100), 416167);
});

test('negative, empty and over-limit inputs are clamped and flagged', async () => {
  await fill('#rent', -500);
  await fill('#food', '');
  await fill('#other', 2e8);
  assert.notEqual((await page.textContent('#error')).trim(), '');
  // tuition 2000 + rent 0 + food 0 + transport 100 + phone 65 + insurance 80 + other 100,000,000
  assert.equal(await amount('#total-expense'), 100002245);
  await noNaN();
  await fill('#other', 100);
  await fill('#rent', 700);
  await fill('#food', 450);
  assert.equal((await page.textContent('#error')).trim(), '');
});

test('all-zero budget shows a balanced state without NaN shares', async () => {
  for (const id of ['tuition', 'rent', 'food', 'transport', 'phone', 'insurance', 'other']) await fill('#' + id, 0);
  await fill('.income-amount', 0);
  assert.equal(await amount('#total-expense'), 0);
  assert.equal(await amount('#balance'), 0);
  assert.match(await page.getAttribute('#balance-card', 'class'), /neutral/);
  assert.match(await page.getAttribute('#share', 'aria-label'), /0%/);
  await noNaN();
});

test('adding and removing income sources updates totals and labels', async () => {
  await page.click('#add-income');
  await page.locator('.income-amount').nth(1).fill('2295');
  assert.equal(await amount('#balance'), 0);
  await page.click('#add-income');
  await page.locator('.income-amount').nth(2).fill('10.5');
  assert.equal(await amount('#balance'), 10.5);
  // Remove the first row: remaining remove buttons are renumbered 1..n and focus is kept.
  await page.locator('.remove').first().click();
  assert.equal(await amount('#total-income'), 2305.5);
  const labels = await page.$$eval('.remove', els => els.map(e => e.getAttribute('aria-label')));
  assert.equal(labels.length, 2);
  labels.forEach((label, i) => assert.match(label, new RegExp(`\\b${i + 1}\\b`)));
  assert.equal(await page.evaluate(() => document.activeElement.id), 'add-income');
  assert.deepEqual(errors, []);
});

test('every form control has an accessible label', async () => {
  const unlabeled = await page.$$eval('input, select', els => els.filter(e => !e.labels?.length && !e.getAttribute('aria-label')).map(e => e.id));
  assert.deepEqual(unlabeled, []);
});

// WCAG AA contrast for every visible element with its own text (4.5:1, or 3:1 for large text).
// Elements with transparent text (gradient-clipped headings) are skipped.
async function lowContrast(page) {
  return page.evaluate(() => {
    const parse = c => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
    const mix = (c, base) => ({ r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a) });
    const lum = ({ r, g, b }) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const background = el => {
      const layers = [];
      for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.a > 0) { layers.push(c); if (c.a >= 1) break; } }
      return layers.reverse().reduce((base, c) => mix(c, base), { r: 255, g: 255, b: 255 });
    };
    const failures = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!el.getClientRects().length || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
      const cs = getComputedStyle(el), fg = parse(cs.color);
      if (fg.a === 0) continue;
      const bg = background(el), l1 = lum(mix(fg, bg)), l2 = lum(bg);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const size = parseFloat(cs.fontSize), large = size >= 24 || (size >= 18.66 && +cs.fontWeight >= 700);
      if (ratio < (large ? 3 : 4.5)) failures.push(`${ratio.toFixed(2)} ${el.tagName} "${el.textContent.trim().slice(0, 30)}"`);
    }
    return failures;
  });
}

test('text colours meet WCAG AA contrast', async () => {
  assert.deepEqual(await lowContrast(page), []);
  await page.fill('#rent', '-1'); // error + negative balance styles
  assert.deepEqual(await lowContrast(page), []);
});

test('edge cases: many incomes, unicode names, tiny and huge amounts', async () => {
  for (let i = 0; i < 40; i++) await page.click('#add-income');
  const amounts = page.locator('.income-amount');
  assert.equal(await amounts.count(), 41);
  await page.locator('.income-row input[type=text]').nth(1).fill('奖学金 🎓 Bourse d’études <b>x</b>');
  for (let i = 1; i < 41; i++) await amounts.nth(i).fill('0.01');
  assert.equal(await amount('#total-income'), 1200.4); // 1200 + 40 x 0.01, no float drift
  assert.equal(await page.locator('#incomes b').count(), 0); // names are text, not markup
  await amounts.nth(0).fill('100000000');
  for (const id of ['tuition', 'rent', 'food', 'transport', 'phone', 'insurance', 'other']) await fill('#' + id, 100000000);
  assert.equal(await amount('#total-expense'), 625000000); // 1e8 / 4 + 6 x 1e8
  await noNaN();
  await fill('#rent', '1e5'); // exponent notation is a valid number input
  assert.equal(await page.$eval('#rent', e => e.validity.valid), true);
  await fill('#rent', '0.005'); // finer than a cent: flagged, still rounded
  assert.notEqual((await page.textContent('#error')).trim(), '');
  await noNaN();
  assert.deepEqual(errors, []);
});


test('tuition 2.01 divided over six months rounds half a cent upward', async () => {
  await page.locator('#tuition').fill('2.01');
  await page.locator('#months').selectOption('6');
  assert.match(await page.locator('#tuition-note').textContent(), /= CAD\s*0\.34/);
  assert.equal(await amount('#total-expense'), 1495.34);
});

test('one-time costs: default example, add/remove rows, amortization tip', async () => {
  // Default example row: 1500, monthly balance untouched.
  assert.equal(await amount('#total-once'), 1500);
  assert.equal(await amount('#balance'), -2295);
  await page.click('#add-once');
  assert.match(await page.evaluate(() => document.activeElement.id), /^once-name-/);
  await page.locator('.once-amount').nth(1).fill('500');
  assert.equal(await amount('#total-once'), 2000);
  // Amortization tip: 2000 over the selected 4 months -> 500 per month.
  const tips = await page.$$eval('#tips li', els => els.map(e => e.textContent));
  assert.ok(tips.some(t => /一次性支出共 CAD\s*2,000\.00/.test(t) && /每月预留 CAD\s*500\.00/.test(t)), JSON.stringify(tips));
  // Remove the first row: total updates, buttons renumbered, focus kept on the add button.
  await page.locator('#once-items .remove-once').first().click();
  assert.equal(await amount('#total-once'), 500);
  const labels = await page.$$eval('#once-items .remove-once', els => els.map(e => e.getAttribute('aria-label')));
  assert.equal(labels.length, 1);
  labels.forEach((label, i) => assert.match(label, new RegExp(`\\b${i + 1}\\b`)));
  assert.equal(await page.evaluate(() => document.activeElement.id), 'add-once');
  // Clearing all one-time rows removes the tip and shows a zero total without NaN.
  await page.locator('#once-items .remove-once').first().click();
  assert.equal(await amount('#total-once'), 0);
  const tipsAfter = await page.$$eval('#tips li', els => els.map(e => e.textContent));
  assert.ok(!tipsAfter.some(t => t.includes('一次性支出共')), JSON.stringify(tipsAfter));
  await noNaN();
  assert.deepEqual(errors, []);
});

test('semester overview: months selector and one-time costs feed the estimate', async () => {
  // Default: once 1500 + 3495 x 4 = 15480; income 1200 x 4 = 4800.
  assert.match(await page.textContent('#semester-title'), /4 个月/);
  assert.equal(await amount('#sem-expense'), 15480);
  assert.equal(await amount('#sem-income'), 4800);
  assert.equal(await amount('#sem-balance'), -10680);
  assert.match(await page.getAttribute('#sem-balance-card', 'class'), /negative/);
  // Switching to 3 months: tuition 2666.67 + 1495 = 4161.67/month -> 1500 + 12485.01
  await page.selectOption('#months', '3');
  assert.match(await page.textContent('#semester-title'), /3 个月/);
  assert.equal(await amount('#sem-expense'), 13985.01);
  assert.equal(await amount('#sem-income'), 3600);
  // Removing the only one-time row drops it from the semester total.
  await page.locator('#once-items .remove-once').first().click();
  assert.equal(await amount('#sem-expense'), 12485.01);
  // A balanced semester shows the neutral style.
  await page.selectOption('#months', '4');
  await page.locator('.income-amount').first().fill('3495');
  assert.equal(await amount('#sem-balance'), 0);
  assert.match(await page.getAttribute('#sem-balance-card', 'class'), /neutral/);
  await noNaN();
  assert.deepEqual(errors, []);
});
