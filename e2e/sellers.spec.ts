import { expect, type Page, test } from '@playwright/test';
import {
  ADMIN,
  ADMIN_STATE,
  latestEmailLink,
  SELLER,
  SELLER_STATE,
  staffSignIn,
  uniqueEmail,
  uniqueMobile,
} from './support/env';

const PASSWORD = 'correct horse battery staple';
/** Smallest files that pass the API's content detection (magic bytes). */
const PDF = Buffer.from('%PDF-1.4\nseller e2e document\n%%EOF');

/** Every request in these tests reads the outboxes as the signed-in demo super admin. */
test.use({ storageState: ADMIN_STATE });

async function uploadDocument(page: Page, type: string) {
  await page.getByLabel('Document type').click();
  await page.getByRole('option', { name: type }).click();
  await page.getByLabel('File (PDF, JPEG or PNG)').setInputFiles({
    name: `${type.slice(0, 8)}.pdf`,
    mimeType: 'application/pdf',
    buffer: PDF,
  });
  await page.getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByRole('list', { name: 'Uploaded documents' })).toContainText(type);
}

test.describe('Seller onboarding', () => {
  test('a seller registers, is verified, opens a store and adds an employee', async ({
    browser,
    page: adminPage,
    request,
  }) => {
    test.setTimeout(120_000);
    const ownerEmail = uniqueEmail('seller');
    const businessName = `E2E Trading ${Date.now()}`;

    // 1. Registration (public sign-up in the Seller Center).
    const sellerContext = await browser.newContext({ storageState: undefined });
    const seller = await sellerContext.newPage();
    await seller.goto(`${SELLER}/sign-in`);
    await seller.getByRole('link', { name: 'Register your business' }).click();
    await seller.getByLabel('Registered business name').fill(businessName);
    await seller.getByLabel('Business type').click();
    await seller.getByRole('option', { name: 'Sole proprietorship' }).click();
    await seller.getByLabel('Owner first name').fill('Lito');
    await seller.getByLabel('Owner last name').fill('Santos');
    await seller.getByLabel('Business mobile number').fill(uniqueMobile());
    await seller.getByLabel('Email').fill(ownerEmail);
    await seller.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await seller.getByRole('button', { name: /Register/ }).click();
    await expect(seller).toHaveURL(`${SELLER}/verification`);
    await expect(seller.getByRole('list', { name: 'Missing items' })).toContainText(
      'Confirm your email address',
    );

    // 2. Confirm the email from the link that was sent.
    const confirm = await latestEmailLink(request, ownerEmail, 'Confirm email address');
    await seller.goto(confirm);
    await expect(seller.getByText('Email address confirmed')).toBeVisible();

    // 3. Business details and documents.
    await seller.goto(`${SELLER}/profile`);
    await seller.getByLabel('DTI business name registration number').fill('DTI-2026-55501');
    await seller.getByLabel('BIR TIN').fill('123-456-789-000');
    await seller.getByLabel('Street address').fill('12 Rizal Avenue');
    await seller.getByLabel('City or municipality').fill('Quezon City');
    await seller.getByLabel('Province').fill('Metro Manila');
    await seller.getByLabel('Postal code').fill('1100');
    await seller.getByRole('button', { name: 'Save profile' }).click();
    await expect(seller.getByText('Business profile saved')).toBeVisible();

    await seller.goto(`${SELLER}/verification`);
    await uploadDocument(seller, 'DTI / SEC / CDA registration certificate');
    await uploadDocument(seller, 'BIR Certificate of Registration (Form 2303)');
    await uploadDocument(seller, "Owner's government-issued ID");
    await seller.getByRole('button', { name: 'Submit for verification' }).click();
    await seller.getByRole('alertdialog').getByRole('button', { name: 'Submit' }).click();
    await expect(seller.getByText('Under review').first()).toBeVisible();

    // 4. A marketplace admin reviews and approves the application.
    await adminPage.goto(`${ADMIN}/sellers`);
    await adminPage.getByRole('link', { name: businessName }).click();
    await expect(adminPage.getByRole('heading', { level: 1, name: businessName })).toBeVisible();
    await adminPage.getByRole('button', { name: 'Approve' }).click();
    await adminPage.getByRole('alertdialog').getByRole('button', { name: 'Approve' }).click();
    await expect(adminPage.getByText('Seller verified')).toBeVisible();
    await latestEmailLink(request, ownerEmail, 'Create your store').catch(() => undefined);

    // 5. The verified seller creates a store.
    await seller.goto(`${SELLER}/stores`);
    await seller.getByRole('button', { name: 'Create store' }).click();
    const createDialog = seller.getByRole('dialog');
    await createDialog.getByLabel('Store name').fill(businessName);
    await expect(createDialog.getByText(/Available/)).toBeVisible();
    await createDialog.getByRole('button', { name: 'Create store' }).click();
    await expect(seller.getByRole('heading', { level: 1, name: businessName })).toBeVisible();

    // 6. The owner invites an employee, who joins with a new account.
    const staffEmail = uniqueEmail('encoder');
    await seller.goto(`${SELLER}/employees`);
    await seller.getByRole('button', { name: 'Invite employee' }).click();
    const invite = seller.getByRole('dialog');
    await invite.getByLabel('Email').fill(staffEmail);
    await invite.getByLabel('Seller encoder').check();
    await invite.getByRole('button', { name: 'Send invitation' }).click();
    await expect(seller.getByRole('table', { name: 'Pending invitations' })).toContainText(
      staffEmail,
    );

    const joinLink = await latestEmailLink(request, staffEmail, 'Accept invitation');
    const staffContext = await browser.newContext({ storageState: undefined });
    const staff = await staffContext.newPage();
    await staff.goto(joinLink);
    await staff.getByLabel('First name').fill('Ana');
    await staff.getByLabel('Last name').fill('Cruz');
    await staff.getByLabel('Choose a password').fill(PASSWORD);
    await staff.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(staff.getByText(`You joined ${businessName}`)).toBeVisible();

    // The employee works only on this seller and cannot manage the team.
    await staffSignIn(staff, SELLER, staffEmail, PASSWORD);
    await expect(staff.getByText(businessName).first()).toBeVisible();
    const nav = staff.getByRole('navigation', { name: 'Main' }).first();
    await expect(nav.getByRole('link', { name: 'Employees' })).toBeVisible();
    await staff.goto(`${SELLER}/employees`);
    await expect(staff.getByRole('button', { name: 'Invite employee' })).toHaveCount(0);

    await staffContext.close();
    await sellerContext.close();
  });

  test('another seller cannot open the demo seller’s store', async ({ browser, request }) => {
    // The demo seller's store id, read through the public store page.
    const store = await request.get('http://localhost:3000/api/v1/stores/by-slug/sam-sari-sari', {
      headers: { 'X-Client-App': 'storefront' },
    });
    expect(store.ok()).toBe(true);
    const { id } = (await store.json()) as { id: string };

    // A brand-new seller (owner of another business) gets "not found", not the store.
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    await page.goto(`${SELLER}/register`);
    await page.getByLabel('Registered business name').fill(`Isolation Test ${Date.now()}`);
    await page.getByLabel('Business type').click();
    await page.getByRole('option', { name: 'Corporation' }).click();
    await page.getByLabel('Owner first name').fill('Iso');
    await page.getByLabel('Owner last name').fill('Lation');
    await page.getByLabel('Business mobile number').fill(uniqueMobile());
    await page.getByLabel('Email').fill(uniqueEmail('isolation'));
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: /Register/ }).click();
    await expect(page).toHaveURL(`${SELLER}/verification`);
    await page.goto(`${SELLER}/stores/${id}`);
    await expect(page.getByText(/not found/i).first()).toBeVisible();
    await context.close();
  });
});

test.describe('Seller Center', () => {
  test('the demo owner lands on the dashboard @responsive', async ({ browser }) => {
    const context = await browser.newContext({ storageState: SELLER_STATE });
    const page = await context.newPage();
    await page.goto(SELLER);
    await expect(page).toHaveURL(`${SELLER}/dashboard`);
    await expect(page.getByRole('heading', { level: 1, name: /Hello,/ })).toBeVisible();
    await context.close();
  });
});
