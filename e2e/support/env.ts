import { randomInt } from 'node:crypto';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const STOREFRONT = 'http://localhost:5173';
export const SELLER = 'http://localhost:5174';
export const ADMIN = 'http://localhost:5175';
export const API = 'http://localhost:3000/api/v1';
export const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';

/** Demo accounts created by `pnpm db:seed` (SEED_DEMO_USERS=true in development). */
export const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Marketplace-dev-2026!';
export const DEMO = {
  superAdmin: 'superadmin@marketplace.local',
  sellerOwner: 'seller.owner@marketplace.local',
};

/** Saved sign-ins (see auth.setup.ts). */
export const ADMIN_STATE = 'e2e/.auth/admin.json';
export const SELLER_STATE = 'e2e/.auth/seller.json';

export const uniqueMobile = () => `0917${randomInt(0, 10_000_000).toString().padStart(7, '0')}`;
export const uniqueEmail = (label: string) =>
  `${label}.${Date.now()}.${randomInt(1000, 9999)}@e2e.test`;
export const toE164 = (local: string) => `+63${local.slice(1)}`;

/** Signs in through a staff app's sign-in page. */
export async function staffSignIn(
  page: Page,
  appUrl: string,
  email: string,
  password = DEMO_PASSWORD,
) {
  await page.goto(`${appUrl}/sign-in`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

/**
 * The newest SMS code sent to a number, read from the development SMS outbox through the
 * API (as a signed-in super admin), the same place a developer reads it in the Admin Console.
 */
export async function latestSmsCode(request: APIRequestContext, e164: string): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await request.get(`${API}/dev/sms-outbox`, {
          headers: { 'X-Client-App': 'admin' },
        });
        const body = (await res.json()) as { messages: { to: string; body: string }[] };
        code = body.messages.find((m) => m.to === e164)?.body.match(/^(\d{6})/)?.[1];
        return code;
      },
      { timeout: 15_000, message: `SMS code for ${e164}` },
    )
    .toMatch(/^\d{6}$/);
  return code!;
}

/** The first link in the newest email to `to` whose text contains `marker`. */
export async function latestEmailLink(
  request: APIRequestContext,
  to: string,
  marker: string,
): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const search = await request.get(
          `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`,
        );
        const { messages } = (await search.json()) as { messages: { ID: string }[] };
        for (const { ID } of messages) {
          const message = (await (await request.get(`${MAILPIT}/api/v1/message/${ID}`)).json()) as {
            Text: string;
          };
          if (message.Text.includes(marker)) {
            link = message.Text.match(/https?:\/\/\S+token=[A-Za-z0-9_-]+/)?.[0];
            if (link) return link;
          }
        }
        return undefined;
      },
      { timeout: 20_000, message: `email to ${to} containing "${marker}"` },
    )
    .toBeTruthy();
  return link!;
}
