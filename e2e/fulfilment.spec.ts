import { expect, type Page, test } from '@playwright/test';
import { ADMIN, ADMIN_STATE, DEMO_PASSWORD, SELLER, STOREFRONT, staffSignIn } from './support/env';

/**
 * The Phase 5 flow on the demo data: pay online with the mock provider (its test page), the
 * seller accepts and books the mock courier, the courier delivers (simulated by staff through
 * the signed webhook path) and the customer can then request a return.
 */

async function storefrontSignIn(page: Page, email: string) {
  await page.getByRole('tab', { name: 'Email' }).click();
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.describe('Orders, payments and shipping', () => {
  test('pays with the mock provider, ships with the mock courier and offers a return', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);

    // Buy the keyboard (Click & Type) and pay with GCash.
    await page.goto(`${STOREFRONT}/search?q=keytap`);
    await page.getByRole('link', { name: 'Keytap Mechanical Keyboard' }).click();
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByText('Added to cart')).toBeVisible();
    await page.goto(`${STOREFRONT}/cart`);
    await page.getByRole('button', { name: 'Sign in to check out' }).click();
    await storefrontSignIn(page, 'customer@marketplace.local');
    await expect(page).toHaveURL(/\/checkout$/);
    await page.getByRole('radio', { name: /GCash/ }).check();
    await page.getByRole('button', { name: /Place order/ }).click();

    // The provider's page (the mock's, clearly marked as a test). Nothing is paid yet.
    await expect(page).toHaveURL(/\/pay\/mock\/cs_mock_/);
    await expect(page.getByText('Test payment page')).toBeVisible();
    await page.getByRole('button', { name: 'Pay (test)' }).click();

    // Back on the order: the server checked with the provider; the order is paid.
    await expect(page).toHaveURL(/\/account\/orders\/[^?]+$/);
    await expect(page.getByTestId('payment-panel')).toHaveCount(0);
    await expect(page.getByTestId('order-status')).toHaveText('In progress');
    const orderNumber = /Order (MP\w+)/.exec(
      (await page.getByRole('heading', { level: 1 }).textContent()) ?? '',
    )?.[1];
    expect(orderNumber).toBeTruthy();
    const orderUrl = page.url();

    // Click & Type accepts the keyboard's package and books the mock courier.
    const sellerContext = await browser.newContext();
    const seller = await sellerContext.newPage();
    await staffSignIn(seller, SELLER, 'seller3.owner@marketplace.local');
    await seller.goto(`${SELLER}/orders`);
    await seller.getByRole('searchbox', { name: 'Search orders' }).fill(orderNumber!);
    await seller
      .getByRole('link', { name: new RegExp(`^${orderNumber}-\\d$`) })
      .first()
      .click();
    await seller.getByRole('button', { name: 'Accept and start preparing' }).click();
    await seller.getByRole('button', { name: 'Book shipment' }).click();
    await seller.getByRole('dialog').getByRole('button', { name: 'Book' }).click();
    await expect(seller.getByTestId('tracking-number').first()).toBeVisible();
    const tracking = (await seller.getByTestId('tracking-number').first().textContent())?.trim();
    expect(tracking).toMatch(/^MCK\d{10}$/);
    const soPath = new URL(seller.url()).pathname; // /orders/:id
    await sellerContext.close();

    // Staff make the mock courier deliver it (signed webhook path).
    const adminContext = await browser.newContext({ storageState: ADMIN_STATE });
    const admin = await adminContext.newPage();
    await admin.goto(`${ADMIN}/seller-${soPath.slice(1)}`);
    await admin.getByRole('combobox', { name: 'Shipment status' }).click();
    await admin.getByRole('option', { name: 'Delivered' }).click();
    await admin.getByRole('button', { name: 'Simulate courier update' }).click();
    await expect(admin.getByText('Courier update simulated').first()).toBeVisible();
    await adminContext.close();

    // The customer sees the delivery and can ask for a return.
    await page.goto(orderUrl);
    const pkg = page.getByLabel(/Package 1: /);
    await expect(pkg.getByTestId('package-status')).toHaveText('Delivered');
    await expect(pkg.getByText(tracking!)).toBeVisible();
    await expect(pkg.getByRole('button', { name: 'Return or refund' })).toBeVisible();
  });
});
