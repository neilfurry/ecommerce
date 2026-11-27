import { randomInt } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { ADMIN, ADMIN_STATE, SELLER, staffSignIn } from './support/env';

/**
 * Phase 6 on the demo data: a seller adds a payout bank account (only the last four digits are
 * ever shown), finance verifies it, and the accounting screens load from the ledger.
 */
test.describe('Finance', () => {
  test('a seller adds a bank account that finance verifies; accounting pages load', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const number = `00${randomInt(10_000_000, 99_999_999)}`;
    const last4 = number.slice(-4);

    // Seller 2 (Isla Tech) adds an account.
    await staffSignIn(page, SELLER, 'seller2.owner@marketplace.local');
    await page.goto(`${SELLER}/finance`);
    await expect(page.getByRole('heading', { name: 'Finance', level: 1 })).toBeVisible();
    await expect(page.getByLabel('Balances')).toBeVisible();
    await page.goto(`${SELLER}/finance/bank-accounts`);
    await page.getByRole('button', { name: 'Add account' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Bank or e-wallet').fill('BDO Unibank');
    await dialog.getByLabel('BIC / SWIFT code (optional)').fill('BNORPHMM');
    await dialog.getByLabel('Account name').fill('Isla Tech Inc.');
    await dialog.getByLabel('Account number').fill(number);
    await dialog.getByRole('button', { name: 'Add account' }).click();
    await expect(page.getByText(`•••• ${last4}`)).toBeVisible();
    await expect(page.getByText(number)).toHaveCount(0);

    // Finance verifies it in the Admin Console.
    const adminContext = await browser.newContext({ storageState: ADMIN_STATE });
    const admin = await adminContext.newPage();
    await admin.goto(`${ADMIN}/finance/payouts?tab=bank-accounts`);
    const row = admin.getByRole('listitem').filter({ hasText: `•••• ${last4}` });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Verify' }).click();
    await admin.getByRole('alertdialog').getByRole('button', { name: 'Verify' }).click();
    await expect(admin.getByText('Account verified')).toBeVisible();

    await page.reload();
    await expect(
      page
        .locator('div')
        .filter({ hasText: `•••• ${last4}` })
        .getByText('Verified')
        .first(),
    ).toBeVisible();

    // The accounting screens read from the ledger.
    await admin.goto(`${ADMIN}/finance`);
    await expect(admin.getByRole('heading', { name: 'Finance', level: 1 })).toBeVisible();
    await expect(admin.getByText('Owed to sellers now')).toBeVisible();
    await admin.goto(`${ADMIN}/finance/reports?tab=trial-balance`);
    await expect(admin.getByText('Debits equal credits.')).toBeVisible();
    await admin.goto(`${ADMIN}/finance/ledger`);
    await expect(admin.getByRole('table', { name: 'Journals' })).toBeVisible();
    await adminContext.close();
  });
});
