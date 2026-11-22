import { defineConfig } from '@playwright/test';

const testPort=Number(process.env.AGENTSCAPE_TEST_PORT||4178);
if(!Number.isInteger(testPort)||testPort<1024||testPort>65535)throw new Error('AGENTSCAPE_TEST_PORT_INVALID');
const testRoot='.tmp/playwright-session-'+process.pid;

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
    baseURL: 'http://127.0.0.1:'+testPort,
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
  },
  webServer: {
    command: `npm run build -- --outDir ${testRoot}/dist && npm run preview -- --outDir ${testRoot}/dist --host 127.0.0.1 --port ${testPort} --strictPort`,
    url: 'http://127.0.0.1:'+testPort,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { AGENTSCAPE_DEV_HOST: '127.0.0.1',
      AGENTSCAPE_WORLD_REPOSITORY_TOKEN: 'test-browser-world-publish-token-for-isolated-e2e',
      AGENTSCAPE_WORLD_REPOSITORY_DIR: testRoot+'/repository' }
  }
});
