import { expect, test, type Page } from '@playwright/test';
import { ADMIN, ADMIN_STATE, SELLER, SELLER_STATE, STOREFRONT } from './support/env';

/** Waits until the live status reports the worker heartbeat (it starts with the stack). */
async function expectAllComponentsUp(page: Page) {
  await expect(page.getByTestId('overall-status')).toHaveText('All systems operational', {
    timeout: 20_000,
  });
  for (const name of ['database', 'redis', 'storage', 'worker']) {
    await expect(page.getByTestId(`component-${name}`)).toContainText('Up');
  }
}

test.describe('Storefront', () => {
  test('home page renders and links to live status @responsive', async ({ page }) => {
    await page.goto(STOREFRONT);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('trusted sellers');
    await page.getByRole('link', { name: 'System status' }).click();
    await expect(page).toHaveURL(`${STOREFRONT}/status`);
    await expectAllComponentsUp(page);
  });

  test('refresh button re-queries the API', async ({ page }) => {
    await page.goto(`${STOREFRONT}/status`);
    await expectAllComponentsUp(page);
    const request = page.waitForRequest((r) => r.url().endsWith('/api/v1/health'));
    await page.getByRole('button', { name: /refresh/i }).click();
    await request;
  });

  test('unknown pages show not found', async ({ page }) => {
    await page.goto(`${STOREFRONT}/does-not-exist`);
    await expect(page.getByText('Page not found')).toBeVisible();
    await page.getByRole('link', { name: 'Go to home' }).click();
    await expect(page).toHaveURL(`${STOREFRONT}/`);
  });
});

test.describe('Seller portal', () => {
  test.use({ storageState: SELLER_STATE });

  test('shows live system status', async ({ page }) => {
    await page.goto(`${SELLER}/system-status`);
    await expect(page.getByRole('heading', { level: 1, name: 'System status' })).toBeVisible();
    await expectAllComponentsUp(page);
  });

  test('mobile navigation opens and navigates @responsive', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Sidebar is always visible on desktop');
    await page.goto(`${SELLER}/system-status`);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await sheet.getByRole('link', { name: 'System status' }).click();
    await expect(sheet).toBeHidden();
  });
});

test.describe('Admin portal', () => {
  test.use({ storageState: ADMIN_STATE });

  test('shows system health with every dependency up @responsive', async ({ page }) => {
    await page.goto(`${ADMIN}/system-health`);
    await expect(page.getByRole('heading', { level: 1, name: 'System health' })).toBeVisible();
    await expectAllComponentsUp(page);
  });
});
