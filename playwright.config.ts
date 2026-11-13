import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  timeout: 15_000,
  expect: { timeout: 5_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'node --import tsx test/e2e/server.ts',
    url: 'http://127.0.0.1:4173/api/readiness',
    reuseExistingServer: false,
    timeout: 15_000,
    env: { PORT: '4173' },
  },
});
