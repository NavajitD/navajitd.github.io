import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,           // local static server isn't worth parallelizing
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8765',
    headless: true,
    actionTimeout: 5000,
    navigationTimeout: 10000,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'python3 -m http.server 8765',
    url: 'http://127.0.0.1:8765/',
    reuseExistingServer: true,
    timeout: 10000,
  },
});
