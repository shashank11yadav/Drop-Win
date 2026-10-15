import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env['E2E_PAGES_PORT'] ?? 5312);

export default defineConfig({
  testDir: 'e2e-pages',
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}/Drop-Win/`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  // The exact files the Pages workflow uploads, served statically under the
  // same /Drop-Win/ path and with no headers, as GitHub Pages serves them.
  // Only the meta-tag CSP protects the page, so a violation fails the test.
  webServer: {
    command: `npm run build:pages && npx vite preview --mode pages --host 127.0.0.1 --port ${String(PORT)} --strictPort`,
    cwd: 'apps/web',
    url: `http://127.0.0.1:${String(PORT)}/Drop-Win/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
