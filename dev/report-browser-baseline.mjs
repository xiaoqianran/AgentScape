import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { cpus, totalmem, platform, release } from 'node:os';

const results = JSON.parse(readFileSync('test-results/browser/results.json', 'utf8'));
const selected = new Set(['performance-baseline.json', 'world-startup-timing.json', 'style-switch-timing.json']);
const measurements = [];
function walk(suite) {
  for (const spec of suite.specs || []) for (const test of spec.tests || []) for (const run of test.results || []) {
    for (const attachment of run.attachments || []) {
      if (!selected.has(attachment.name) || run.status !== 'passed') continue;
      const bytes = attachment.body ? Buffer.from(attachment.body, 'base64') : readFileSync(attachment.path);
      measurements.push({ test: spec.title, measurement: attachment.name, data: JSON.parse(bytes.toString('utf8')) });
    }
  }
  for (const child of suite.suites || []) walk(child);
}
walk(results);
if (!measurements.some(row => row.measurement === 'performance-baseline.json')) throw new Error('Missing passed performance measurement');
const report = { generatedAt: new Date().toISOString(), version: JSON.parse(readFileSync('package.json')).version,
  environment: { os: platform(), release: release(), node: process.version, cpu: cpus()[0]?.model,
    logicalCpus: cpus().length, systemMemoryBytes: totalmem(), rendering: 'Chromium SwiftShader' },
  stats: results.stats, measurements,
  scope: 'Local measurement; no hardware GPU, mobile or independent human first-use claim' };
mkdirSync('.tmp-release', { recursive: true });
writeFileSync('.tmp-release/browser-baseline.json', JSON.stringify(report, null, 2) + '\n');
console.log('Browser baseline written to .tmp-release/browser-baseline.json');
