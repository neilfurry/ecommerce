import { expect, test } from '@playwright/test';
import {
  ADMIN,
  ADMIN_STATE,
  DEMO_PASSWORD,
  latestSmsCode,
  MAILPIT,
  SELLER,
  SELLER_STATE,
  STOREFRONT,
  toE164,
  uniqueEmail,
  uniqueMobile,
} from './support/env';

/**
 * Phase 7 in the browser with the real worker: a new customer's welcome notification arrives
 * in the inbox and by email (Mailpit), they ask support a question that staff answer, and the
 * analytics, campaign and notification screens work from live data.
 */
test.use({ storageState: ADMIN_STATE });

test.describe('Engagement', () => {
  test('welcome notification, a support conversation and the rewards page', async ({
    browser,
    request,
  }) => {
    test.setTimeout(150_000);
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    const mobile = uniqueMobile();
    const email = uniqueEmail('engage');

    await page.goto(`${STOREFRONT}/sign-up`);
    await page.getByLabel('First name').fill('Lea');
    await page.getByLabel('Last name').fill('Reyes');
    await page.getByRole('textbox', { name: 'Mobile number' }).fill(mobile);
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Code').fill(await latestSmsCode(request, toE164(mobile)));
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(`${STOREFRONT}/account`);

    // The registration event is delivered by the worker: inbox and email.
    await expect
      .poll(
        async () => {
          await page.goto(`${STOREFRONT}/account/notifications`);
          return page
            .getByRole('list', { name: 'Notifications' })
            .getByText(/Welcome to/)
            .count();
        },
        { timeout: 45_000, message: 'welcome notification in the inbox' },
      )
      .toBeGreaterThan(0);
    // E2E_NO_MAILPIT=1 skips only the email check, for machines without Mailpit.
    if (!process.env.E2E_NO_MAILPIT)
      await expect
        .poll(
          async () => {
            const res = await request.get(
              `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
            );
            const { messages } = (await res.json()) as { messages: { Subject: string }[] };
            return messages.some((m) => m.Subject.startsWith('Welcome to'));
          },
          { timeout: 30_000, message: 'welcome email in Mailpit' },
        )
        .toBe(true);

    await page.goto(`${STOREFRONT}/account/rewards`);
    await expect(page.getByTestId('points-balance')).toHaveText('0');
    await expect(page.getByTestId('referral-code')).toHaveText(/^[A-Z0-9]{8}$/);

    // A general question goes to marketplace support.
    const subject = `Delivery areas ${Date.now()}`;
    await page.goto(`${STOREFRONT}/account/support`);
    await page.getByRole('button', { name: 'New question' }).click();
    await page.getByLabel('Subject').fill(subject);
    await page.getByLabel('Message').fill('Do you deliver to Siargao?');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page).toHaveURL(/\/account\/support\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('list', { name: 'Conversation' })).toContainText(
      'Do you deliver to Siargao?',
    );
    const ticketUrl = page.url();

    const adminContext = await browser.newContext({ storageState: ADMIN_STATE });
    const admin = await adminContext.newPage();
    await admin.goto(`${ADMIN}/support`);
    await admin.getByRole('link', { name: subject }).click();
    await admin.getByLabel('Reply').fill('Yes, through our Cebu partner courier.');
    await admin.getByRole('button', { name: 'Send' }).click();
    await expect(admin.getByText('Yes, through our Cebu partner courier.')).toBeVisible();
    await adminContext.close();

    await page.goto(ticketUrl);
    await expect(page.getByText('Yes, through our Cebu partner courier.')).toBeVisible();
    await expect(page.getByText('Waiting for you')).toBeVisible();
    await context.close();
  });

  test('staff analytics, campaigns and notification templates; seller reports', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const adminContext = await browser.newContext({ storageState: ADMIN_STATE });
    const admin = await adminContext.newPage();
    await admin.goto(`${ADMIN}/analytics`);
    await expect(admin.getByRole('heading', { name: 'Analytics', level: 1 })).toBeVisible();
    await expect(admin.getByTestId('kpi-cards').getByText('GMV')).toBeVisible();
    await admin.locator('#report-granularity').selectOption('month');
    const download = admin.waitForEvent('download');
    await admin.getByRole('button', { name: 'CSV' }).click();
    expect((await download).suggestedFilename()).toMatch(/^sales-.*\.csv$/);
    await admin.getByRole('tab', { name: 'Sellers' }).click();
    await expect(admin.getByRole('columnheader', { name: 'Seller' }).first()).toBeVisible();

    // A paused campaign (so other tests' prices are not affected).
    const name = `E2E campaign ${Date.now()}`;
    await admin.goto(`${ADMIN}/campaigns`);
    await admin.getByRole('button', { name: 'New campaign' }).click();
    const dialog = admin.getByRole('dialog');
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByLabel('Type').selectOption('BUY_X_GET_Y');
    await dialog.getByLabel('Percent off').fill('100');
    await dialog.getByLabel('Status').selectOption('INACTIVE');
    await dialog.getByRole('button', { name: 'Create campaign' }).click();
    const row = admin.getByRole('row').filter({ hasText: name });
    await expect(row).toContainText('Buy 1, take 1');
    await expect(row).toContainText('Paused');

    await admin.goto(`${ADMIN}/notifications`);
    await expect(admin.getByRole('cell', { name: 'Shipment', exact: true })).toBeVisible();
    await expect(admin.getByText('Built-in email').first()).toBeVisible();
    await adminContext.close();

    const sellerContext = await browser.newContext({ storageState: SELLER_STATE });
    const seller = await sellerContext.newPage();
    await seller.goto(`${SELLER}/reports`);
    await expect(seller.getByTestId('kpi-cards').getByText('Gross sales')).toBeVisible();
    await seller.getByRole('tab', { name: 'Inventory' }).click();
    await expect(seller.getByRole('columnheader', { name: 'SKU' })).toBeVisible();
    await seller.goto(`${SELLER}/marketing/campaigns`);
    await expect(seller.getByRole('heading', { name: 'Campaigns', level: 1 })).toBeVisible();
    await sellerContext.close();
  });
});
