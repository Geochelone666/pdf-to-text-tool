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
