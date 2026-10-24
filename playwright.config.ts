import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', workers: 1, timeout: 30000,
  outputDir: '/tmp/aether-sketch-browser-results',
  use: { launchOptions: { executablePath: process.env.AETHER_TEST_CHROMIUM }, baseURL: 'http://127.0.0.1:5183', viewport: { width: 1440, height: 960 }, screenshot: 'only-on-failure' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5183 --strictPort', url: 'http://127.0.0.1:5183', reuseExistingServer: false },
});
