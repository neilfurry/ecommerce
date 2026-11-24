import { test as setup } from '@playwright/test';
import { ADMIN, ADMIN_STATE, DEMO, SELLER, SELLER_STATE, staffSignIn } from './support/env';

/**
 * Signs in once per staff app and saves the cookies, so tests start signed in without
 * spending the per-address sign-in rate limit.
 */
setup('sign in to the Admin Console as the demo super admin', async ({ page }) => {
  await staffSignIn(page, ADMIN, DEMO.superAdmin);
  await page.context().storageState({ path: ADMIN_STATE });
});

setup('sign in to the Seller Center as the demo seller owner', async ({ page }) => {
  await staffSignIn(page, SELLER, DEMO.sellerOwner);
  await page.context().storageState({ path: SELLER_STATE });
});
