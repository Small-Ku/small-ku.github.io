import { defineConfig } from '@playwright/test';
if (!process.env.MANGLING_BROWSER_BASELINE || !process.env.MANGLING_BROWSER_ARTIFACTS) throw new Error('Run pnpm test:browser to prepare isolated content fixtures.');
const port = process.env.MANGLING_BROWSER_PORT;
const baselinePort = process.env.MANGLING_BASELINE_PORT;
export default defineConfig({
  testDir: './tests/browser',
  outputDir: process.env.MANGLING_BROWSER_ARTIFACTS,
  reporter: 'line',
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1280, height: 900 },
    browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: [
    { command: `node scripts/static-server.mjs dist ${port}`, url: `http://127.0.0.1:${port}`, reuseExistingServer: false },
    { command: `node scripts/static-server.mjs "${process.env.MANGLING_BROWSER_BASELINE}" ${baselinePort}`,
      url: `http://127.0.0.1:${baselinePort}`, reuseExistingServer: false },
  ],
});
