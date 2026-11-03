import { defineConfig, devices } from '@playwright/test';

const PORT = 3200;
const DB = process.env.E2E_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/uth_e2e';
// Use a locally installed Chrome when Playwright's bundled browsers aren't downloaded.
const executablePath = process.env.CHROME_PATH || undefined;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: { executablePath, args: ['--no-sandbox'] },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `node tests/e2e/reset-db.mjs && node dist/server/server/index.js`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    env: { PORT: String(PORT), DATABASE_URL: DB },
    timeout: 30_000,
  },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'] } }],
});
