const { test, expect } = require('@playwright/test');
const path = require('path');

test('LUMINARY Visual & Sound QA Sanity Check', async ({ page }) => {
  test.setTimeout(60000); // 60s timeout for full city generation loading
  const consoleErrors = [];
  
  // 1. Listen for console errors or unhandled exceptions
  page.on('pageerror', (exception) => {
    consoleErrors.push(`[Page Error] ${exception.stack || exception.message}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(`[Console Error] ${message.text()}`);
    }
  });

  // Mock pointerLock to prevent headless browser crash/warnings
  await page.addInitScript(() => {
    Element.prototype.requestPointerLock = function() {
      console.log('[Mock] PointerLock requested successfully.');
      return Promise.resolve();
    };
  });

  // 2. Load the live Netlify application
  const targetUrl = 'https://luminary-flight.netlify.app';
  console.log(`Navigating to ${targetUrl}...`);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

  // 3. Verify page title
  await expect(page).toHaveTitle('LUMINARY — Flight Engine');

  // 4. Verify loader screen is present
  const loader = page.locator('#loader');
  await expect(loader).toBeVisible();

  const launchBtn = page.locator('#start-btn');
  await expect(launchBtn).toBeVisible();

  // 5. Take a screenshot of the loading screen
  await page.screenshot({ path: path.join(__dirname, '../artifacts/loading_screen.png') });
  console.log('Loading screen screenshot saved to artifacts/loading_screen.png');

  // 6. Launch the game (Click start button)
  console.log('Clicking LAUNCH button...');
  await launchBtn.click();

  // 7. Verify loader disappears and HUD elements show up
  await expect(loader).toBeHidden({ timeout: 15000 });
  const hud = page.locator('#hud');
  await expect(hud).toBeVisible();

  // 8. Verify the WebGL canvas is injected and rendering
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();

  // Give the scene a second to warm up and render
  await page.waitForTimeout(2000);

  // 9. Take a gameplay screenshot for visual validation
  await page.screenshot({ path: path.join(__dirname, '../artifacts/gameplay_verification.png') });
  console.log('Gameplay screenshot saved to artifacts/gameplay_verification.png');

  // 10. Fail the test if any console/WebGL exceptions were caught
  if (consoleErrors.length > 0) {
    console.error('Test failed due to runtime exceptions:');
    consoleErrors.forEach((err) => console.error(err));
    expect(consoleErrors.length).toBe(0);
  } else {
    console.log('✅ Visual QA complete! Zero runtime errors or WebGL exceptions caught.');
  }
});
