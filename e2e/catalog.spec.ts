import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { ADMIN, ADMIN_STATE, API, SELLER, SELLER_STATE } from './support/env';

const PHOTO = fileURLToPath(new URL('./fixtures/product.jpg', import.meta.url));

test.describe('Catalog, approval and inventory', () => {
  test('a seller lists a product, the marketplace approves it, and stock is recorded', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const name = `Dinorado Rice 5 kg ${Date.now()}`;
    const sku = `DIN-${Date.now().toString(36).toUpperCase()}`;

    const sellerContext = await browser.newContext({ storageState: SELLER_STATE });
    const seller = await sellerContext.newPage();

    // 1. Create a draft.
    await seller.goto(`${SELLER}/products`);
    await seller.getByRole('link', { name: /Add product/ }).click();
    await seller.getByLabel('Product name').fill(name);
    await seller.getByLabel('Category').click();
    await seller.getByRole('option', { name: 'Rice & Grains' }).click();
    await seller
      .getByLabel('Description')
      .fill('Fragrant Dinorado rice, soft when cooked. Packed in a 5 kg bag.');
    await seller.getByLabel('SKU').fill(sku);
    await seller.getByLabel('Regular price (₱)').fill('420.00');
    await seller.getByRole('button', { name: 'Save draft' }).click();
    await expect(seller.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(seller.getByRole('list', { name: 'Missing before submission' })).toContainText(
      'Add at least one photo',
    );

    // 2. Category details and a photo.
    await seller.getByLabel('Net weight (kg) *').fill('5');
    await seller.getByRole('button', { name: 'Save details' }).click();
    await expect(seller.getByText('Product saved')).toBeVisible();
    await seller.getByRole('tab', { name: /Photos/ }).click();
    await seller.getByLabel('Upload photos').setInputFiles(PHOTO);
    await expect(
      seller.getByRole('list', { name: 'Product photos' }).getByRole('listitem'),
    ).toHaveCount(1);

    // 3. Submit for approval.
    await seller.getByRole('button', { name: /Submit for approval/ }).click();
    await seller.getByRole('alertdialog').getByRole('button', { name: 'Submit' }).click();
    await expect(seller.getByText('Waiting for approval').first()).toBeVisible();
    const productId = seller.url().split('/').pop()!;

    // 4. A marketplace admin approves it.
    const adminContext = await browser.newContext({ storageState: ADMIN_STATE });
    const admin = await adminContext.newPage();
    // The review queue lists it (search, as a reused database may hold more than a page).
    await admin.goto(`${ADMIN}/catalog/products`);
    await admin.getByRole('searchbox').first().fill(name);
    await admin.getByRole('link', { name }).click();
    await expect(admin).toHaveURL(new RegExp(`/catalog/products/${productId}$`));
    await expect(admin.getByText('5 kg', { exact: true })).toBeVisible();
    await admin.getByRole('button', { name: /Approve/ }).click();
    await admin.getByRole('alertdialog').getByRole('button', { name: 'Approve' }).click();
    await expect(admin.getByText('Product approved')).toBeVisible();

    // Shoppers can see it now, priced by the server.
    const publicPage = await admin.request.get(`${API}/catalog/products/${productId}`, {
      headers: { 'X-Client-App': 'storefront' },
    });
    expect(publicPage.ok()).toBe(true);
    expect(
      ((await publicPage.json()) as { prices: { unitPrice: string }[] }).prices[0]?.unitPrice,
    ).toBe('420.00');

    // 5. The seller records stock in.
    await seller.goto(`${SELLER}/inventory/adjustments`);
    await seller.getByLabel('Warehouse').click();
    await seller.getByRole('option', { name: /QC-1/ }).click();
    await seller.getByLabel('Find product').fill(sku);
    await seller.getByLabel('Product', { exact: true }).click();
    await seller.getByRole('option', { name }).click();
    await seller.getByLabel('Variant').click();
    await seller.getByRole('option', { name: new RegExp(sku) }).click();
    await seller.getByLabel('Units').fill('40');
    await seller.getByRole('button', { name: 'Record movement' }).click();
    await expect(seller.getByText(/Now 40 on hand, 40 available/)).toBeVisible();

    // The movement is in the history.
    await seller.goto(`${SELLER}/inventory/history`);
    await expect(seller.getByRole('table', { name: 'Inventory movements' })).toContainText(sku);

    await adminContext.close();
    await sellerContext.close();
  });

  test('the seller inventory dashboard and admin overview show the demo stock @responsive', async ({
    browser,
  }) => {
    const sellerContext = await browser.newContext({ storageState: SELLER_STATE });
    const seller = await sellerContext.newPage();
    await seller.goto(`${SELLER}/inventory`);
    await expect(seller.getByRole('heading', { level: 1, name: 'Inventory' })).toBeVisible();
    await expect(seller.getByRole('table', { name: 'Stock levels' })).toContainText('RICE-SIN-25');
    await sellerContext.close();

    const adminContext = await browser.newContext({ storageState: ADMIN_STATE });
    const admin = await adminContext.newPage();
    await admin.goto(`${ADMIN}/inventory`);
    await expect(admin.getByRole('table', { name: 'Inventory by seller' })).toContainText(
      'Sam Sari-Sari Trading',
    );
    await adminContext.close();
  });
});
