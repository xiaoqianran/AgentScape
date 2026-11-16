import { defineConfig } from 'vitest/config';

// Keep test collection independent of dev servers, gateways and local secrets.
const groups = {
  core: ['agent', 'artifact', 'asset', 'contracts', 'generation', 'mcp'],
  ui: ['studio', 'observatory', 'rendering'],
  world: ['world', 'integration', 'e2e'],
};
const group = process.env.AGENTSCAPE_TEST_GROUP;
if (group && !groups[group]) throw new Error(`Unknown test group: ${group}`);

export default defineConfig({
  test: {
    include: group
      ? groups[group].map(directory => `tests/${directory}/**/*.test.js`)
      : ['tests/**/*.test.js'],
    maxWorkers: group === 'world' ? 1 : 4,
    forbidOnly: Boolean(process.env.CI),
  },
});
