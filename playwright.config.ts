import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env['E2E_PORT'] ?? 5304);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  // The production build served by the Node server, with the production
  // security headers, so a CSP violation fails the test.
  webServer: {
    command: 'npm run build -w @drop-win/web && node apps/api/src/node.ts',
    url: `http://127.0.0.1:${String(PORT)}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      APP_ENV: 'test',
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATABASE_PATH: ':memory:',
      WEB_DIST: 'apps/web/dist',
      SESSION_SECRET: 'e2e-only-secret-not-used-anywhere-else-0123',
    },
  },
});
