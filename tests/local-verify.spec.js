// Local verification spec — mirrors game.spec.js but targets the local dev
// server (node scratch/server.js) so UNCOMMITTED changes are what gets tested.
// Skips itself when the server is not running, so `npx playwright test`
// stays green in live-site-only runs.
const { test, expect } = require('@playwright/test');
const path = require('path');

test('LUMINARY local QA sanity check', async ({ page }) => {
  test.setTimeout(60000);

  let serverUp = true;
  try {
    await page.request.get('http://localhost:8080', { timeout: 3000 });
  } catch {
    serverUp = false;
  }
  test.skip(!serverUp, 'Local dev server not running (node scratch/server.js)');
  const consoleErrors = [];

  page.on('pageerror', (exception) => {
    consoleErrors.push(`[Page Error] ${exception.stack || exception.message}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      // Ignore the resource error produced by our own font-request abort
      const url = (message.location() && message.location().url) || '';
      if (/fonts\.(googleapis|gstatic)\.com/.test(url)) return;
      consoleErrors.push(`[Console Error] ${message.text()}`);
    }
  });

  await page.addInitScript(() => {
    Element.prototype.requestPointerLock = function() {
      console.log('[Mock] PointerLock requested successfully.');
      return Promise.resolve();
    };
  });

  // Block external font fetches — headless sandbox can't reach Google Fonts
  // and document.fonts never settles, which stalls page.screenshot.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());

  await page.goto('http://localhost:8080', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await expect(page).toHaveTitle('LUMINARY — Flight Engine');

  const loader = page.locator('#loader');
  await expect(loader).toBeVisible();

  const launchBtn = page.locator('#start-btn');
  await expect(launchBtn).toBeVisible();
  await launchBtn.click();

  await expect(loader).toBeHidden({ timeout: 15000 });
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();

  await page.waitForTimeout(3000);
  try {
    await page.screenshot({ path: path.join(__dirname, '../artifacts/local_verification.png'), timeout: 20000 });
  } catch (err) {
    console.warn('Skipping screenshot (font load timeout).');
  }

  if (consoleErrors.length > 0) {
    console.error('Runtime exceptions caught:');
    consoleErrors.forEach((err) => console.error(err));
  }
  expect(consoleErrors.length).toBe(0);
});
