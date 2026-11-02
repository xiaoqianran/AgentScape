import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.spec.js',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }], ['json', { outputFile: 'test-results/browser/results.json' }]],
  outputDir: 'test-results/browser',
  use: {
    baseURL: 'http://127.0.0.1:4178',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
  },
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4178 --strictPort',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { AGENTSCAPE_DEV_HOST: '127.0.0.1' }
  }
});
