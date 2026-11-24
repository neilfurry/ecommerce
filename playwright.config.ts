import { defineConfig, devices } from '@playwright/test';

/**
 * Browser end-to-end tests across all three frontends against the real API and worker.
 * Prerequisites: infrastructure running (`pnpm infra:up`), database migrated and seeded.
 * Playwright starts (or reuses) the API, worker and Vite dev servers below.
 *
 * Install the browser once:  pnpm exec playwright install chromium
 * To use an already-installed Chrome instead, set PLAYWRIGHT_CHROMIUM_EXECUTABLE.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
const reuseExistingServer = !process.env.CI;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // A test that only passes on retry fails the run, so flakiness is fixed rather than hidden.
  failOnFlakyTests: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath },
  },
  projects: [
    // Signs in to the staff apps once and saves the cookies (e2e/.auth/, git-ignored).
    { name: 'setup', testMatch: /auth\.setup\.ts/, use: { launchOptions: { executablePath } } },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } },
      dependencies: ['setup'],
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], launchOptions: { executablePath } },
      grep: /@responsive/,
      dependencies: ['setup'],
    },
  ],
  webServer: [
    {
      name: 'api',
      command: 'pnpm --filter @marketplace/api run start',
      url: 'http://localhost:3000/api/v1/health/live',
      reuseExistingServer,
      timeout: 60_000,
    },
    {
      name: 'worker',
      command: 'pnpm --filter @marketplace/worker run start',
      // The worker has no HTTP port; the API reports its heartbeat instead.
      wait: { stdout: /Worker started/ },
      reuseExistingServer,
      timeout: 60_000,
    },
    {
      name: 'storefront',
      command: 'pnpm --filter @marketplace/storefront run dev',
      url: 'http://localhost:5173',
      reuseExistingServer,
    },
    {
      name: 'seller-portal',
      command: 'pnpm --filter @marketplace/seller-portal run dev',
      url: 'http://localhost:5174',
      reuseExistingServer,
    },
    {
      name: 'admin-portal',
      command: 'pnpm --filter @marketplace/admin-portal run dev',
      url: 'http://localhost:5175',
      reuseExistingServer,
    },
  ],
});
