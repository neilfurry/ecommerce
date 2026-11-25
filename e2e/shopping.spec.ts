import { expect, type Page, test } from '@playwright/test';
import { DEMO_PASSWORD, STOREFRONT } from './support/env';

/**
 * The Phase 4 shopping flow on the demo data (pnpm db:seed): a laptop from Isla Tech and a
 * keyboard from Click & Type in one checkout, which creates one order with two packages.
 */

async function storefrontSignIn(page: Page, email: string) {
  await page.getByRole('tab', { name: 'Email' }).click();
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.describe('Storefront shopping', () => {
  test('a guest finds products from two sellers and checks out one order with two packages', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto(STOREFRONT);
    // Home page sections come from the API.
    // A running flash sale (the demo "Payday Flash Sale", or one ending sooner).
    const flash = page.getByRole('region', { name: /flash sale/i });
    await expect(flash).toContainText('Ends in');
    await expect(flash.getByRole('listitem').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Featured products' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Featured stores' })).toBeVisible();

    // Search and open the keyboard (Click & Type, Davao).
    const search = page.getByRole('combobox', { name: /Search products/ }).first();
    await search.fill('keytap keyboard');
    await search.press('Enter');
    await expect(page).toHaveURL(/\/search\?q=keytap/);
    await page.getByRole('link', { name: 'Keytap Mechanical Keyboard' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Keytap Mechanical Keyboard' }),
    ).toBeVisible();
    await expect(page.getByTestId('unit-price')).toHaveText('₱2,199.00');
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByText('Added to cart')).toBeVisible();

    // Browse the Laptops category and open the laptop (Isla Tech, Cebu); choose 512 GB.
    await page.goto(`${STOREFRONT}/c/laptops`);
    await page.getByRole('link', { name: 'Isla Tech Aero 14 Laptop' }).click();
    await page.getByRole('button', { name: '512 GB' }).click();
    await expect(page.getByTestId('unit-price')).toHaveText('₱32,999.00');
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByText('Added to cart')).toBeVisible();

    // The cart groups items by store.
    await page.goto(`${STOREFRONT}/cart`);
    await expect(page.getByRole('link', { name: 'Isla Tech Gadgets' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Click & Type' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign in to check out' }).click();

    // Sign in; the browser cart joins the account cart and checkout opens.
    await storefrontSignIn(page, 'customer@marketplace.local');
    await expect(page).toHaveURL(/\/checkout$/);
    await expect(page.getByText(/Package 1 of 2/)).toBeVisible();
    await expect(page.getByText(/Package 2 of 2/)).toBeVisible();
    await expect(page.getByText(/from Lahug, City of Cebu/)).toBeVisible();

    // A marketplace coupon is checked by the server and shared by both packages.
    await page.getByLabel('Coupon code').fill('FREESHIP');
    await page.getByRole('button', { name: 'Apply' }).click();
    const coupons = page.getByRole('list', { name: 'Coupons' });
    await expect(coupons).toContainText('FREESHIP');
    const placeButton = page.getByRole('button', { name: /Place order/ });
    await expect(placeButton).toBeEnabled();
    const total =
      (await page.getByRole('definition').filter({ hasText: /₱/ }).last().textContent()) ?? '';

    await placeButton.click();
    await expect(page).toHaveURL(/\/account\/orders\/.+\?placed=1/);
    await expect(page.getByText(/Your order MP\w+ is placed/)).toBeVisible();
    await expect(page.getByText(/split into 2 packages/)).toBeVisible();
    await expect(page.getByTestId('order-status')).toHaveText('Placed');
    await expect(page.getByTestId('order-total')).toHaveText(total.trim());
    await expect(
      page.getByRole('region', { name: /Package 1: / }).or(page.getByLabel(/Package 1: /)),
    ).toBeVisible();
    await expect(page.getByLabel(/Package 2: /)).toBeVisible();

    // It is in the order history.
    await page.getByRole('link', { name: 'My orders' }).first().click();
    await expect(page.getByRole('heading', { name: 'My orders' })).toBeVisible();
  });

  test('an approved wholesale customer sees wholesale prices @responsive', async ({ page }) => {
    await page.goto(`${STOREFRONT}/sign-in`);
    await storefrontSignIn(page, 'wholesale@marketplace.local');
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByTestId('account-type')).toHaveText('Wholesale');

    await page.goto(`${STOREFRONT}/search?q=sinandomeng`);
    await page.getByRole('link', { name: 'Sinandomeng Rice 25 kg' }).first().click();
    await expect(
      page.getByText('Your wholesale account gets these prices automatically.'),
    ).toBeVisible();
    await page.getByLabel('Quantity', { exact: true }).fill('50');
    await expect(page.getByTestId('unit-price')).toHaveText('₱420.00');
  });
});
