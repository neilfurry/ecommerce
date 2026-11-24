import { expect, test } from '@playwright/test';
import { ADMIN, ADMIN_STATE, MAILPIT } from './support/env';

test.use({ storageState: ADMIN_STATE });

/**
 * Proves the background pipeline and file storage end to end through the Admin Console:
 * browser → API → Redis/BullMQ → worker → SMTP/MinIO/PostgreSQL.
 */
test.describe('Admin Console developer tools', () => {
  test('sample job runs through the worker', async ({ page }) => {
    await page.goto(`${ADMIN}/dev-tools/jobs`);
    await page.getByLabel('Message').fill('Playwright says hello');
    await page.getByRole('button', { name: 'Run job' }).click();
    await expect(page.getByText('Sample job queued')).toBeVisible();
    const status = page.getByTestId('job-status').first();
    await expect(status.getByTestId('job-state')).toHaveText('Completed', { timeout: 20_000 });
    await expect(status).toContainText('Playwright says hello');
  });

  test('a job that fails every attempt is retried, then dead-lettered', async ({ page }) => {
    await page.goto(`${ADMIN}/dev-tools/jobs`);
    const message = `always fails ${Date.now()}`;
    await page.getByLabel('Message').fill(message);
    await page.getByLabel('Work duration (ms)').fill('0');
    await page.getByRole('combobox', { name: 'Simulated failures' }).click();
    await page.getByRole('option', { name: 'Fail the first 5 attempts' }).click();
    await page.getByRole('button', { name: 'Run job' }).click();

    const status = page.getByTestId('job-status').first();
    // 3 attempts with 1 s then 2 s backoff.
    await expect(status.getByTestId('job-state')).toHaveText('Failed', { timeout: 30_000 });
    await expect(status).toContainText('Attempt 3 of 3');

    const deadLetters = page.getByRole('table', { name: 'Dead letters' });
    await expect(deadLetters.getByText('Simulated failure on attempt 3 of 5').first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('test email is delivered to Mailpit', async ({ page, request }) => {
    const recipient = `e2e-${Date.now()}@marketplace.local`;
    await page.goto(`${ADMIN}/dev-tools/jobs`);
    await page.getByLabel('Recipient').fill(recipient);
    await page.getByRole('button', { name: 'Send test email' }).click();
    await expect(page.getByTestId('job-status').getByTestId('job-state')).toHaveText('Completed', {
      timeout: 20_000,
    });
    await expect
      .poll(
        async () => {
          const res = await request.get(
            `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${recipient}`)}`,
          );
          return ((await res.json()) as { messages_count: number }).messages_count;
        },
        { timeout: 15_000 },
      )
      .toBe(1);
  });

  test('file upload, signed download and delete', async ({ page }) => {
    const name = `e2e-${Date.now()}.txt`;
    await page.goto(`${ADMIN}/dev-tools/files`);
    await page.getByLabel('File', { exact: true }).setInputFiles({
      name,
      mimeType: 'text/plain',
      buffer: Buffer.from('Salamat sa pagsubok!'),
    });
    await page.getByRole('button', { name: 'Upload' }).click();
    await expect(page.getByText('File uploaded')).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await row.getByRole('button', { name: `Download ${name}` }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(name);

    await row.getByRole('button', { name: `Delete ${name}` }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete file' }).click();
    await expect(page.getByText('File deleted')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(0);
  });

  test('rejects a disguised executable', async ({ page }) => {
    await page.goto(`${ADMIN}/dev-tools/files`);
    await page.getByLabel('File', { exact: true }).setInputFiles({
      name: 'photo.png',
      mimeType: 'image/png',
      buffer: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]),
    });
    await page.getByRole('button', { name: 'Upload' }).click();
    await expect(page.getByText('Upload failed')).toBeVisible();
    await expect(page.getByText(/Unsupported file type/)).toBeVisible();
  });
});
