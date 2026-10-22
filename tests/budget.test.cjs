const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

let browser, page;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { if (browser) await browser.close(); });
beforeEach(async () => {
  if (page) await page.close();
  page = await browser.newPage();
  await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
});
const amount = async selector => Number((await page.locator(selector).textContent()).replace(/[^\d.\-]/g, ''));

test('tuition half-cent rounds up after conversion to integer cents', async () => {
  await page.locator('#tuition').fill('2.01');
  await page.locator('#months').selectOption('6');
  assert.match(await page.locator('#tuition-note').textContent(), /= CAD\s*0\.34/);
  assert.equal(await amount('#total-expense'), 1495.34);
});

test('monthly breakdown sums to the total and balance', async () => {
  const values = await page.locator('#breakdown .chart-label span:last-child').allTextContents();
  const cents = values.reduce((sum, value) => sum + Math.round(Number(value.replace(/[^\d.]/g, '')) * 100), 0);
  assert.equal(cents, Math.round(await amount('#total-expense') * 100));
  assert.equal(await amount('#balance'), -2295);
});

test('income rows are added and removed without losing existing amounts', async () => {
  await page.locator('#add-income').click();
  await page.locator('.income-amount').last().fill('0.29');
  assert.equal(await amount('#total-income'), 1200.29);
  await page.locator('.remove').last().click();
  assert.equal(await amount('#total-income'), 1200);
});

test('zero expenses produce a finite zero-share chart', async () => {
  for (const input of await page.locator('#expenses input').all()) await input.fill('0');
  assert.equal(await amount('#total-expense'), 0);
  assert.equal(await page.locator('#share').getAttribute('aria-label'), '暂无支出，各类别占比为 0%');
});

test('negative and oversized inputs follow the visible clamping policy', async () => {
  await page.locator('#rent').fill('-1');
  assert.equal(await amount('#total-expense'), 2795);
  assert.notEqual(await page.locator('#error').textContent(), '');
  await page.locator('#rent').fill('100000001');
  assert.equal(await amount('#total-expense'), 100002795);
});
