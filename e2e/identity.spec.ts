import { expect, test } from '@playwright/test';
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

const PASSWORD = 'correct horse battery staple';

/** Every request in these tests reads the SMS outbox as the signed-in demo super admin. */
test.use({ storageState: ADMIN_STATE });

test.describe('Customer accounts', () => {
  test('sign up with an SMS code, confirm the email, sign out and back in by SMS @responsive', async ({
    browser,
    request,
  }) => {
    // A fresh browser: the customer is not the signed-in admin.
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    const mobile = uniqueMobile();
    const email = uniqueEmail('shopper');

    await page.goto(STOREFRONT);
    await page.getByRole('banner').getByRole('link', { name: 'Create account' }).click();
    await page.getByLabel('First name').fill('Maria');
    await page.getByLabel('Last name').fill('Santos');
    await page.getByRole('textbox', { name: 'Mobile number' }).fill(mobile);
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByText(/We sent a 6-digit code to/)).toBeVisible();
    const code = await latestSmsCode(request, toE164(mobile));
    await page.getByLabel('Code').fill(code);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(`${STOREFRONT}/account`);
    await expect(page.getByRole('heading', { name: 'My account' })).toBeVisible();
    await expect(page.getByText('Not confirmed')).toBeVisible();

    // The worker emails a confirmation link (Mailpit catches it locally).
    const link = await latestEmailLink(request, email, 'Confirm email address');
    await page.goto(link);
    await expect(page.getByText('Email address confirmed')).toBeVisible();
    await page.getByRole('link', { name: 'Go to my account' }).click();
    await expect(page.getByText('Verified').nth(1)).toBeVisible();

    // Sign out, then sign back in with the mobile number and a new code.
    await page.getByRole('button', { name: /Account menu for Maria Santos/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(`${STOREFRONT}/sign-in`);

    await page.goto(`${STOREFRONT}/account`);
    await expect(page).toHaveURL(`${STOREFRONT}/sign-in`);
    await page.getByRole('textbox', { name: 'Mobile number' }).fill(mobile);
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByText(/We sent a 6-digit code to/)).toBeVisible();
    await expect.poll(() => latestSmsCode(request, toE164(mobile))).not.toBe(code);
    await page.getByLabel('Code').fill(await latestSmsCode(request, toE164(mobile)));
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(`${STOREFRONT}/account`);
    await context.close();
  });

  test('wholesale applicants shop at retail prices until an admin approves them', async ({
    browser,
    page,
    request,
  }) => {
    const customer = await browser.newContext({ storageState: undefined });
    const shop = await customer.newPage();
    const mobile = uniqueMobile();
    const businessName = `Sari-Sari ${Date.now()}`;

    await shop.goto(`${STOREFRONT}/sign-up`);
    await shop.getByLabel(/Business \(wholesale\)/).check();
    await shop.getByLabel('First name').fill('Jose');
    await shop.getByLabel('Last name').fill('Dela Cruz');
    await shop.getByRole('textbox', { name: 'Mobile number' }).fill(mobile);
    await shop.getByRole('textbox', { name: 'Email' }).fill(uniqueEmail('wholesale'));
    await shop.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await shop.getByLabel('Registered business name').fill(businessName);
    await shop.getByLabel('TIN').fill('123-456-789-000');
    await shop.getByLabel('Business address').fill('45 Mabini St, Quezon City, Metro Manila');
    await shop.getByRole('button', { name: 'Continue' }).click();
    await shop.getByLabel('Code').fill(await latestSmsCode(request, toE164(mobile)));
    await shop.getByRole('button', { name: 'Create account' }).click();
    await expect(shop.getByText('Application under review')).toBeVisible();

    // The super admin approves it in the Admin Console.
    await page.goto(`${ADMIN}/wholesale`);
    const row = page.getByRole('row').filter({ hasText: businessName });
    await row.getByRole('button', { name: 'Approve' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Wholesale access granted')).toBeVisible();
    await expect(row).toBeHidden();

    await shop.reload();
    await expect(shop.getByText('Wholesale account active')).toBeVisible();
    await customer.close();
  });
});

test.describe('Staff accounts', () => {
  test('an admin invites a staff member who sets a password and signs in', async ({
    browser,
    page,
    request,
  }) => {
    const email = uniqueEmail('support');
    await page.goto(`${ADMIN}/users`);
    await page.getByRole('button', { name: 'Invite staff member' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('First name').fill('Carla');
    await dialog.getByLabel('Last name').fill('Reyes');
    await dialog.getByLabel('Work email').fill(email);
    await dialog.getByLabel('Customer support').check();
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByText('Invitation sent')).toBeVisible();

    const link = await latestEmailLink(request, email, 'Set password and sign in');
    const staff = await browser.newContext({ storageState: undefined });
    const staffPage = await staff.newPage();
    await staffPage.goto(link);
    await staffPage.getByLabel('New password', { exact: true }).fill(PASSWORD);
    await staffPage.getByLabel('Confirm new password').fill(PASSWORD);
    await staffPage.getByRole('button', { name: 'Activate account' }).click();
    await expect(staffPage.getByText('Your account is ready')).toBeVisible();

    await staffSignIn(staffPage, ADMIN, email, PASSWORD);
    // Customer support can see users but not roles or developer tools.
    await expect(staffPage.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
    const nav = staffPage.getByRole('navigation', { name: 'Main' }).first();
    await expect(nav.getByRole('link', { name: 'Roles & permissions' })).toHaveCount(0);
    await staffPage.goto(`${ADMIN}/dev-tools/jobs`);
    await expect(staffPage.getByText("You don't have access to this page")).toBeVisible();
    await staff.close();
  });

  test('signed-out visitors are sent to sign-in and returned afterwards', async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    await page.goto(`${ADMIN}/roles`);
    await expect(page).toHaveURL(`${ADMIN}/sign-in`);
    await page.getByLabel('Email').fill(DEMO.superAdmin);
    await page.getByLabel('Password', { exact: true }).fill('not the password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('Incorrect email or password');
    await context.close();
  });

  test('the Seller Center shows who is signed in @responsive', async ({ browser }) => {
    const context = await browser.newContext({ storageState: SELLER_STATE });
    const page = await context.newPage();
    await page.goto(SELLER);
    await expect(page).toHaveURL(`${SELLER}/system-status`);
    await expect(page.getByRole('button', { name: /Account menu for/ })).toBeVisible();
    await context.close();
  });
});
