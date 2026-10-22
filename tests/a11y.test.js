// Real-Chromium checks: axe-core WCAG 2.1 A/AA scan, no console errors, no horizontal
// overflow at a 375px phone width. Run: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');

const PAGE = 'file://' + path.resolve(__dirname, '..', 'index.html');
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

async function open(width) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(PAGE);
  return { page, errors };
}

async function axe(page, label) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
  assert.deepEqual(violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`), [], label);
}

async function noOverflow(page, label) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  assert.ok(scrollWidth <= clientWidth, `${label}: page is ${scrollWidth}px wide in a ${clientWidth}px viewport`);
}

for (const width of [375, 1280]) {
  test(`budget page at ${width}px: axe clean, no overflow, interaction works`, async () => {
    const { page, errors } = await open(width);
    await axe(page, 'initial'); await noOverflow(page, 'initial');
    await page.click('#add-income');
    await page.locator('.income-amount').nth(1).fill('999999.99');
    await page.fill('#rent', '-5'); // error message + negative balance styles
    assert.match(await page.textContent('#balance'), /CAD/);
    await axe(page, 'after input'); await noOverflow(page, 'after input');
    assert.deepEqual(errors, []);
  });
}
