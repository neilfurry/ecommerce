import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { ApiSession, endReturnWindow } from './support/api';
import {
  ADMIN,
  ADMIN_STATE,
  DEMO,
  latestEmailLink,
  latestSmsCode,
  SELLER,
  SELLER_STATE,
  STOREFRONT,
  staffSignIn,
  toE164,
  uniqueEmail,
  uniqueMobile,
} from './support/env';

/**
 * Phase 8 end-to-end journeys, one per role, each through that role's own app. Steps that
 * belong to someone else (the courier delivering, another party ordering or approving) are
 * done through the API, and the days a delivered order waits before settlement are skipped by
 * moving its return window into the past (support/api.ts).
 */

const PHOTO = fileURLToPath(new URL('./fixtures/product.jpg', import.meta.url));
const PASSWORD = 'correct horse battery staple';
const PDF = Buffer.from('%PDF-1.4\njourney document\n%%EOF');
/** Bagong Pag-asa, Quezon City (PSGC). */
const QUEZON_CITY = {
  regionCode: '1300000000',
  provinceCode: null,
  cityCode: '1381300000',
  barangayCode: '1381300009',
};
const DEMO_CUSTOMER = 'customer@marketplace.local';

/** Outboxes (SMS) are read as the signed-in demo super admin. */
test.use({ storageState: ADMIN_STATE });

/** The demo seller's product the customer buys (stocked by the seed). */
const RICE = 'Sinandomeng Rice 25 kg';

async function variantOf(api: ApiSession, productName: string) {
  const list = await api.ok<{ items: { id: string; name: string }[] }>(
    api.get(`catalog/products?q=${encodeURIComponent(productName)}&pageSize=20`),
  );
  const product = list.items.find((p) => p.name === productName);
  expect(product, `product ${productName}`).toBeTruthy();
  const detail = await api.ok<{ variants: { id: string }[] }>(
    api.get(`catalog/products/${product!.id}`),
  );
  return detail.variants[0]!.id;
}

/** A customer order paid with the mock GCash provider; returns the order detail. */
async function paidOrder(customer: ApiSession, variantId: string, quantity = 1) {
  const { items: addresses } = await customer.ok<{ items: { id: string; isDefault: boolean }[] }>(
    customer.get('account/addresses'),
  );
  const addressId = (addresses.find((a) => a.isDefault) ?? addresses[0])!.id;
  const body = { addressId, buyNow: { variantId, quantity } };
  const quote = await customer.ok<{ totals: { grandTotal: string } }>(
    customer.post('checkout/quote', body),
  );
  const order = await customer.ok<{
    id: string;
    orderNumber: string;
    sellerOrders: { id: string; number: string }[];
    payment: { attempts: { checkoutUrl: string | null }[] };
  }>(
    customer.post(
      'checkout/orders',
      { ...body, paymentMethod: 'GCASH', expectedGrandTotal: quote.totals.grandTotal },
      randomUUID(),
    ),
  );
  const session = order.payment.attempts
    .find((a) => a.checkoutUrl)!
    .checkoutUrl!.split('/')
    .pop()!;
  await customer.ok(customer.post(`dev/mock-payments/${session}`, { outcome: 'paid' }));
  return order;
}

async function acceptAndShipApi(seller: ApiSession, sellerOrderId: string) {
  await seller.ok(seller.post(`seller/orders/${sellerOrderId}/accept`));
  return seller.ok<{ id: string; trackingNumber: string }>(
    seller.post(`seller/orders/${sellerOrderId}/shipments`, { carrier: 'MOCK' }),
  );
}

async function deliver(admin: ApiSession, shipmentId: string) {
  for (const status of ['PICKED_UP', 'DELIVERED']) {
    await admin.ok(admin.post(`shipments/${shipmentId}/simulate`, { status }));
  }
}

async function shipmentOf(seller: ApiSession, sellerOrderId: string) {
  const so = await seller.ok<{ shipments: { id: string; trackingNumber: string }[] }>(
    seller.get(`seller/orders/${sellerOrderId}`),
  );
  return so.shipments[0]!;
}

/** Seller application through the API: account, confirmed email, profile, documents, submitted. */
async function sellerApplication(request: Parameters<typeof latestEmailLink>[0]) {
  const email = uniqueEmail('journey-seller');
  const businessName = `Journey Supplies ${Date.now()}`;
  const seller = await ApiSession.open('seller');
  await seller.ok(
    seller.post('auth/sellers/sign-up', {
      firstName: 'Rosa',
      lastName: 'Reyes',
      email,
      password: PASSWORD,
      businessName,
      businessType: 'SOLE_PROPRIETORSHIP',
      mobile: uniqueMobile(),
    }),
  );
  const link = await latestEmailLink(request, email, 'Confirm email address');
  await seller.ok(
    seller.post('auth/email/verify', { token: new URL(link).searchParams.get('token') }),
  );
  await seller.ok(
    seller.patch('sellers/me', {
      addressLine1: '45 Mabini Street',
      barangay: 'Bagong Pag-asa',
      city: 'Quezon City',
      province: 'Metro Manila',
      postalCode: '1105',
      registrationNumber: 'DTI-2026-8899',
      tin: '123-456-789-000',
    }),
  );
  for (const type of ['BUSINESS_REGISTRATION', 'BIR_REGISTRATION', 'OWNER_ID']) {
    await seller.ok(
      seller.ctx.post('sellers/me/documents', {
        multipart: {
          type,
          file: { name: `${type}.pdf`, mimeType: 'application/pdf', buffer: PDF },
        },
        headers: { 'X-CSRF-Token': await csrfOf(seller) },
      }),
    );
  }
  const detail = await seller.ok<{ id: string }>(seller.post('sellers/me/submit'));
  return { seller, email, businessName, sellerId: detail.id };
}

async function csrfOf(api: ApiSession) {
  return ((await (await api.get('auth/csrf')).json()) as { csrfToken: string }).csrfToken;
}

/** A store and a Quezon City warehouse for an approved seller; returns the store id. */
async function storeAndWarehouse(seller: ApiSession, storeName: string) {
  const slug = `journey-${Date.now().toString(36)}`;
  const store = await seller.ok<{ id: string }>(seller.post('stores', { name: storeName, slug }));
  await seller.ok(
    seller.post('inventory/warehouses', {
      name: 'Main',
      code: 'MAIN',
      addressLine1: '45 Mabini Street',
      city: 'Quezon City',
      province: 'Metro Manila',
      location: QUEZON_CITY,
      isDefault: true,
    }),
  );
  return store.id;
}

test.describe('Role journeys (Phase 8)', () => {
  test('customer: register → browse → cart → checkout → pay → track → review', async ({
    browser,
    request,
  }) => {
    test.setTimeout(240_000);
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    const mobile = uniqueMobile();

    // Register with an SMS code.
    await page.goto(STOREFRONT);
    await page.getByRole('banner').getByRole('link', { name: 'Create account' }).click();
    await page.getByLabel('First name').fill('Carla');
    await page.getByLabel('Last name').fill('Mendoza');
    await page.getByRole('textbox', { name: 'Mobile number' }).fill(mobile);
    await page.getByRole('textbox', { name: 'Email' }).fill(uniqueEmail('journey-customer'));
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Code').fill(await latestSmsCode(request, toE164(mobile)));
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Hello, Carla' })).toBeVisible();

    // Browse: search, open the product, add it to the cart.
    const search = page.getByRole('combobox', { name: /Search products/ }).first();
    await search.fill('sinandomeng');
    await search.press('Enter');
    await page.getByRole('link', { name: RICE }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: RICE })).toBeVisible();
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByText('Added to cart')).toBeVisible();

    // Checkout: a new delivery address, then GCash.
    await page.goto(`${STOREFRONT}/cart`);
    await page.getByRole('button', { name: /check out/i }).click();
    await expect(page).toHaveURL(/\/checkout$/);
    await page.getByLabel('Recipient’s full name').fill('Carla Mendoza');
    await page.getByRole('textbox', { name: 'Mobile number' }).fill(mobile);
    await page.getByLabel('Region').selectOption({ label: 'National Capital Region (NCR)' });
    await page.getByLabel('City or municipality').selectOption({ label: 'Quezon City' });
    await page.getByLabel('Barangay').selectOption({ label: 'Bagong Pag-asa' });
    await page.getByLabel('Postal code').fill('1105');
    await page.getByLabel('House number and street').fill('12 Matiwasay Street');
    await page.getByRole('button', { name: 'Save and deliver here' }).click();
    await expect(page.getByText(/Package 1 of 1/)).toBeVisible();
    await page.getByRole('radio', { name: /GCash/ }).check();
    await page.getByRole('button', { name: /Place order/ }).click();

    // Pay on the (mock) provider's page.
    await expect(page).toHaveURL(/\/pay\/mock\/cs_mock_/);
    await page.getByRole('button', { name: 'Pay (test)' }).click();
    await expect(page).toHaveURL(/\/account\/orders\/[^?]+$/);
    await expect(page.getByTestId('order-status')).toHaveText('In progress');
    const orderNumber = /Order (MP\w+)/.exec(
      (await page.getByRole('heading', { level: 1 }).textContent()) ?? '',
    )![1]!;
    const orderUrl = page.url();

    // The seller ships and the courier delivers (other parties, through the API).
    const seller = await ApiSession.open('seller', { storageState: SELLER_STATE });
    const admin = await ApiSession.open('admin', { storageState: ADMIN_STATE });
    const orders = await seller.ok<{ items: { id: string; number: string }[] }>(
      seller.get(`seller/orders?search=${orderNumber}&pageSize=10`),
    );
    const so = orders.items.find((o) => o.number.startsWith(orderNumber))!;
    const shipment = await acceptAndShipApi(seller, so.id);

    // Track: the order shows the shipment, then the delivery.
    await page.goto(orderUrl);
    const pkg = page.getByLabel(/Package 1: /);
    await expect(pkg.getByText(shipment.trackingNumber)).toBeVisible();
    await deliver(admin, shipment.id);
    await page.reload();
    await expect(pkg.getByTestId('package-status')).toHaveText('Delivered');

    // Review the product from the order.
    await pkg.getByRole('link', { name: 'Write a review' }).click();
    await expect(page).toHaveURL(/\/account\/reviews/);
    await page.getByRole('radiogroup', { name: 'Rating' }).locator('label').nth(3).click();
    await expect(page.getByRole('radio', { name: '4 stars' })).toBeChecked();
    await page.getByLabel('Headline (optional)').fill('Fresh and fragrant');
    await page.getByLabel('Your review (optional)').fill('Well packed and delivered on time.');
    await page.getByRole('button', { name: 'Submit review' }).click();
    await expect(page.getByText('Fresh and fragrant')).toBeVisible();

    await seller.dispose();
    await admin.dispose();
    await context.close();
  });

  test('seller: register → verify → store → product → order → ship → settlement', async ({
    browser,
    request,
  }) => {
    test.setTimeout(300_000);
    const email = uniqueEmail('journey-owner');
    const businessName = `Journey Trading ${Date.now()}`;
    const productName = `Journey Coffee Beans ${Date.now()}`;
    const sku = `JRN-${Date.now().toString(36).toUpperCase()}`;
    const admin = await ApiSession.open('admin', { storageState: ADMIN_STATE });
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    // Register the business.
    await page.goto(`${SELLER}/sign-in`);
    await page.getByRole('link', { name: 'Register your business' }).click();
    await page.getByLabel('Registered business name').fill(businessName);
    await page.getByLabel('Business type').click();
    await page.getByRole('option', { name: 'Sole proprietorship', exact: true }).click();
    await page.getByLabel('Owner first name').fill('Lito');
    await page.getByLabel('Owner last name').fill('Santos');
    await page.getByLabel('Business mobile number').fill(uniqueMobile());
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: /Register/ }).click();
    await expect(page).toHaveURL(`${SELLER}/verification`);

    // Verify: confirm the email, complete the profile, upload documents, submit.
    await page.goto(await latestEmailLink(request, email, 'Confirm email address'));
    await expect(page.getByText('Email address confirmed')).toBeVisible();
    await page.goto(`${SELLER}/profile`);
    await page.getByLabel('DTI business name registration number').fill('DTI-2026-55502');
    await page.getByLabel('BIR TIN').fill('123-456-789-000');
    await page.getByLabel('Street address').fill('45 Mabini Street');
    await page.getByLabel('City or municipality').fill('Quezon City');
    await page.getByLabel('Province').fill('Metro Manila');
    await page.getByLabel('Postal code').fill('1105');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Business profile saved')).toBeVisible();
    await page.goto(`${SELLER}/verification`);
    for (const type of [
      'DTI / SEC / CDA registration certificate',
      'BIR Certificate of Registration (Form 2303)',
      "Owner's government-issued ID",
    ]) {
      await page.getByLabel('Document type').click();
      await page.getByRole('option', { name: type, exact: true }).click();
      await page
        .getByLabel('File (PDF, JPEG or PNG)')
        .setInputFiles({ name: 'document.pdf', mimeType: 'application/pdf', buffer: PDF });
      await page.getByRole('button', { name: 'Upload' }).click();
      await expect(page.getByRole('list', { name: 'Uploaded documents' })).toContainText(type);
    }
    await page.getByRole('button', { name: 'Submit for verification' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByText('Under review').first()).toBeVisible();

    // The marketplace verifies the business (admin, through the API).
    const applications = await admin.ok<{ items: { id: string; businessName: string }[] }>(
      admin.get(`sellers?search=${encodeURIComponent(businessName)}&pageSize=10`),
    );
    const sellerId = applications.items.find((s) => s.businessName === businessName)!.id;
    await admin.ok(admin.post(`sellers/${sellerId}/review`, { decision: 'APPROVE' }));

    // Create the store.
    await page.goto(`${SELLER}/stores`);
    await page.getByRole('button', { name: 'Create store' }).click();
    const createDialog = page.getByRole('dialog');
    await createDialog.getByLabel('Store name').fill(businessName);
    await expect(createDialog.getByText(/Available/)).toBeVisible();
    await createDialog.getByRole('button', { name: 'Create store' }).click();
    await expect(page.getByRole('heading', { level: 1, name: businessName })).toBeVisible();

    // A warehouse to ship from (API: the location pickers are covered by other tests).
    const owner = await ApiSession.open('seller', { email, password: PASSWORD });
    await owner.ok(
      owner.post('inventory/warehouses', {
        name: 'Main warehouse',
        code: 'MAIN',
        addressLine1: '45 Mabini Street',
        city: 'Quezon City',
        province: 'Metro Manila',
        location: QUEZON_CITY,
        isDefault: true,
      }),
    );

    // Add a product, submit it, and stock it once the marketplace approved it.
    await page.goto(`${SELLER}/products`);
    await page.getByRole('link', { name: /Add product/ }).click();
    await page.getByLabel('Product name').fill(productName);
    await page.getByLabel('Category').click();
    await page.getByRole('option', { name: 'Rice & Grains' }).click();
    await page.getByLabel('Description').fill('Whole roasted beans from Benguet, 1 kg bag.');
    await page.getByLabel('SKU').fill(sku);
    await page.getByLabel('Regular price (₱)').fill('650.00');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByRole('heading', { level: 1, name: productName })).toBeVisible();
    await page.getByLabel('Net weight (kg) *').fill('1');
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect(page.getByText('Product saved')).toBeVisible();
    await page.getByRole('tab', { name: /Photos/ }).click();
    await page.getByLabel('Upload photos').setInputFiles(PHOTO);
    await expect(
      page.getByRole('list', { name: 'Product photos' }).getByRole('listitem'),
    ).toHaveCount(1);
    await page.getByRole('button', { name: /Submit for approval/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByText('Waiting for approval').first()).toBeVisible();
    const productId = page.url().split('/').pop()!;
    await admin.ok(admin.post(`products/${productId}/review`, { decision: 'APPROVE' }));

    await page.goto(`${SELLER}/inventory/adjustments`);
    await page.getByLabel('Warehouse').click();
    await page.getByRole('option', { name: /MAIN/ }).click();
    await page.getByLabel('Find product').fill(sku);
    await page.getByLabel('Product', { exact: true }).click();
    await page.getByRole('option', { name: productName }).click();
    await page.getByLabel('Variant').click();
    await page.getByRole('option', { name: new RegExp(sku) }).click();
    await page.getByLabel('Units').fill('20');
    await page.getByRole('button', { name: 'Record movement' }).click();
    await expect(page.getByText(/Now 20 on hand, 20 available/)).toBeVisible();

    // Receive an order (a customer pays online, through the API).
    const customer = await ApiSession.open('storefront', { email: DEMO_CUSTOMER });
    const order = await paidOrder(customer, await variantOf(customer, productName), 2);
    const so = order.sellerOrders[0]!;
    await page.goto(`${SELLER}/orders`);
    await page.getByRole('searchbox', { name: 'Search orders' }).fill(order.orderNumber);
    await page.getByRole('link', { name: so.number }).click();
    await expect(page.getByText(productName)).toBeVisible();

    // Ship it.
    await page.getByRole('button', { name: 'Accept and start preparing' }).click();
    await page.getByRole('button', { name: 'Book shipment' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Book' }).click();
    await expect(page.getByTestId('tracking-number').first()).toBeVisible();

    // Delivered, the return window passes and the marketplace settles the period.
    await deliver(admin, (await shipmentOf(owner, so.id)).id);
    await endReturnWindow(so.id);
    await admin.ok(admin.post('finance/settlements/run', { sellerId }));

    // View the settlement.
    await page.goto(`${SELLER}/finance/settlements`);
    await page.getByRole('link').filter({ hasText: /–|-/ }).first().click();
    await expect(page.getByRole('heading', { name: /Statement / })).toBeVisible();
    await expect(page.getByText(so.number)).toBeVisible();

    await customer.dispose();
    await owner.dispose();
    await admin.dispose();
    await context.close();
  });

  test('administrator: sign in → approve seller → approve product → monitor order → resolve dispute → approve payout', async ({
    browser,
    request,
  }) => {
    test.setTimeout(300_000);
    const staffApi = await ApiSession.open('admin', { storageState: ADMIN_STATE });

    // Sign in to the Admin Console (a fresh browser, not the saved session).
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    await staffSignIn(page, ADMIN, DEMO.superAdmin);

    // Approve a seller application.
    const app = await sellerApplication(request);
    await page.goto(`${ADMIN}/sellers`);
    await page.getByLabel('Search sellers').fill(app.businessName);
    await page.getByRole('link', { name: app.businessName }).click();
    await page.getByRole('button', { name: 'Approve' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Seller verified')).toBeVisible();

    // Approve the seller's product.
    const seller = await ApiSession.open('seller', { email: app.email, password: PASSWORD });
    const storeId = await storeAndWarehouse(seller, app.businessName);
    const productName = `Journey Dried Mangoes ${Date.now()}`;
    const categories = await seller.ok<{ categories: { id: string; name: string }[] }>(
      seller.get('categories'),
    );
    const category = categories.categories.find((c) => c.name === 'Rice & Grains')!;
    const created = await seller.ok<{ id: string; variants: { id: string }[] }>(
      seller.post('products', {
        storeId,
        categoryId: category.id,
        name: productName,
        description: 'Sweet dried mangoes from Cebu, 500 g pack.',
        attributeValues: { net_weight: 0.5 },
        sku: `MNG-${Date.now().toString(36).toUpperCase()}`,
        regularPrice: '320.00',
      }),
    );
    await seller.ok(
      seller.ctx.post(`products/${created.id}/images`, {
        multipart: {
          file: { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: readFileSync(PHOTO) },
        },
        headers: { 'X-CSRF-Token': await csrfOf(seller) },
      }),
    );
    await seller.ok(seller.post(`products/${created.id}/submit`));
    await page.goto(`${ADMIN}/catalog/products`);
    await page.getByRole('searchbox').first().fill(productName);
    await page.getByRole('link', { name: productName }).click();
    await page.getByRole('button', { name: /Approve/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Product approved')).toBeVisible();

    // Monitor an order: a customer buys two packs.
    const warehouses = await seller.ok<{ warehouses: { id: string }[] }>(
      seller.get('inventory/warehouses'),
    );
    await seller.ok(
      seller.post('inventory/movements', {
        warehouseId: warehouses.warehouses[0]!.id,
        variantId: created.variants[0]!.id,
        type: 'STOCK_IN',
        quantity: 30,
      }),
    );
    const customer = await ApiSession.open('storefront', { email: DEMO_CUSTOMER });
    const disputed = await paidOrder(customer, created.variants[0]!.id, 1);
    const settled = await paidOrder(customer, created.variants[0]!.id, 2);
    await page.goto(`${ADMIN}/orders`);
    await page.getByRole('searchbox', { name: 'Search orders' }).fill(disputed.orderNumber);
    await page.getByRole('link', { name: disputed.orderNumber, exact: true }).click();
    await expect(page.getByText('Seller orders (1)')).toBeVisible();
    await expect(page.getByText(new RegExp(`^${app.businessName} ·`))).toBeVisible();
    await expect(page.getByText('Payment received').first()).toBeVisible();
    await page.getByRole('link', { name: disputed.sellerOrders[0]!.number }).click();
    await expect(page.getByText(productName).first()).toBeVisible();

    // Resolve a dispute: the customer asks for a return, the seller refuses, the customer escalates.
    for (const placed of [disputed, settled]) {
      const shipment = await acceptAndShipApi(seller, placed.sellerOrders[0]!.id);
      await deliver(staffApi, shipment.id);
    }
    const detail = await customer.ok<{ sellerOrders: { items: { id: string }[] }[] }>(
      customer.get(`account/orders/${disputed.id}`),
    );
    const ret = await customer.ok<{ id: string; number: string }>(
      customer.ctx.post('account/returns', {
        multipart: {
          data: JSON.stringify({
            sellerOrderId: disputed.sellerOrders[0]!.id,
            reason: 'DAMAGED',
            description: 'The pack arrived torn open.',
            requestedResolution: 'FULL_REFUND',
            items: [{ orderItemId: detail.sellerOrders[0]!.items[0]!.id, quantity: 1 }],
          }),
        },
        headers: { 'X-CSRF-Token': await csrfOf(customer) },
      }),
    );
    await seller.ok(
      seller.post(`seller/returns/${ret.id}/reject`, {
        response: 'The seal was intact when it left.',
      }),
    );
    await customer.ok(
      customer.post(`account/returns/${ret.id}/escalate`, { note: 'Please review the photos.' }),
    );
    await page.goto(`${ADMIN}/disputes`);
    await page.getByRole('link', { name: ret.number }).first().click();
    await expect(page.getByRole('heading', { name: `Return ${ret.number}` })).toBeVisible();
    await expect(page.getByLabel('Decision', { exact: true })).toContainText('Full refund');
    await page
      .getByLabel('Decision note (shown to the customer and the seller)')
      .fill('Damaged in transit: the marketplace refunds the customer in full.');
    await page.getByRole('button', { name: 'Record decision' }).click();
    await expect(page.getByText('Decision recorded').first()).toBeVisible();
    await expect
      .poll(
        async () =>
          (await customer.ok<{ status: string }>(customer.get(`account/returns/${ret.id}`))).status,
      )
      .not.toBe('ESCALATED');

    // Approve a payout: the other order is settled and the seller asks to be paid.
    await endReturnWindow(settled.sellerOrders[0]!.id);
    await staffApi.ok(staffApi.post('finance/settlements/run', { sellerId: app.sellerId }));
    const bank = await seller.ok<{ id: string }>(
      seller.post('seller/finance/bank-accounts', {
        institutionName: 'BDO Unibank',
        accountName: app.businessName,
        accountNumber: '001234567890',
      }),
    );
    await staffApi.ok(
      staffApi.post(`finance/bank-accounts/${bank.id}/review`, { decision: 'VERIFY' }),
    );
    await staffApi.ok(
      staffApi.post(`finance/sellers/${app.sellerId}/tax-profile/verify`, {
        verified: true,
        withholdingExemptUntil: null,
      }),
    );
    const overview = await seller.ok<{ balances: { withdrawable: string } }>(
      seller.get('seller/finance/overview'),
    );
    expect(Number(overview.balances.withdrawable)).toBeGreaterThanOrEqual(100);
    const payout = await seller.ok<{ id: string; reference: string }>(
      seller.post('seller/finance/payouts', {
        amount: overview.balances.withdrawable,
        bankAccountId: bank.id,
        idempotencyKey: randomUUID(),
      }),
    );
    await page.goto(`${ADMIN}/finance/payouts/${payout.id}`);
    await expect(page.getByRole('heading', { name: `Payout ${payout.reference}` })).toBeVisible();
    await page.getByRole('button', { name: 'Approve' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText(/Approved/).first()).toBeVisible();

    await customer.dispose();
    await seller.dispose();
    await app.seller.dispose();
    await staffApi.dispose();
    await context.close();
  });
});
