import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';
import path from 'path';

const toPosix = (value: string) => value.replace(/\\/g, '/');

const testDir = defineBddConfig({
  featuresRoot: __dirname,
  features: [
    `${toPosix(__dirname)}/tests/bdd/features/*.feature`,
    `${toPosix(__dirname)}/tests/bdd/features/**/*.feature`,
  ],
  steps: [
    `${toPosix(__dirname)}/tests/bdd/steps/*.ts`,
    `${toPosix(__dirname)}/tests/bdd/steps/**/*.ts`,
    `${toPosix(__dirname)}/support/fixtures/**/*.ts`
  ],
  outputDir: path.resolve(__dirname, 'generated/bdd-specs')
});

export default defineConfig({
  testDir: testDir,
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`.
       Also what the `request` fixture resolves relative API paths against. Pointing
       it at the Vite dev server rather than the backend keeps API setup on the same
       origin as the UI: vite.config.js proxies /api through to 8080. */
    baseURL: process.env.APP_BASE_URL ?? 'http://localhost:5173',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
/*
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    }, */

  ],
});
