import { spawnSync } from 'node:child_process';

const [group, ...args] = process.argv.slice(2);
if (!['core', 'ui', 'world'].includes(group)) {
  console.error('Usage: node dev/test-group.mjs core|ui|world [vitest options]');
  process.exit(1);
}
const result = spawnSync(process.execPath, [
  'node_modules/vitest/vitest.mjs', 'run',
  '--exclude', 'tests/e2e/generated-cup-runtime-e2e.test.js', ...args,
], { stdio: 'inherit', env: { ...process.env, AGENTSCAPE_TEST_GROUP: group } });
if (result.error) console.error(result.error);
process.exit(result.status ?? 1);
