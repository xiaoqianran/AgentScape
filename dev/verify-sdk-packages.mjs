import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run through npm run sdk:verify:packages');
const npm = (args, cwd) => execFileSync(process.execPath, [npmCli, ...args], {
  cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit']
});
const packages = [
  { folder: 'sdk/typescript', name: 'agentscape3d' },
  { folder: 'sdk/engine', name: 'agentscape3d-engine' },
  { folder: 'sdk/studio', name: 'agentscape3d-studio' }
];
const checks = {};
for (const item of packages) {
  const directory = join(root, item.folder);
  const envelope = JSON.parse(npm(['pack', '--dry-run', '--ignore-scripts', '--json'], directory));
  const pack = envelope[item.name] || (Array.isArray(envelope) ? envelope[0] : null);
  if (!pack || pack.name !== item.name) throw new Error('Invalid npm package for ' + item.name);
  const paths = new Set(pack.files.map(file => file.path));
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  const includes = (file) => paths.has(file);
  if (item.name === 'agentscape3d') {
    for (const file of ['dist/index.js', 'dist/index.d.ts', 'dist/core.js', 'dist/core.d.ts']) {
      if (!includes(file)) throw new Error('Core is missing ' + file);
    }
    if (Object.keys(manifest.dependencies || {}).length || manifest.bin) throw new Error('Core must have no dependencies or CLI');
    if ([...paths].some(file => file.startsWith('site/') || file.includes('/runtime/') ||
      /(^|\/)(?:mcp|node|BrowserCodeWorker)\.(?:js|mjs)$/.test(file))) {
      throw new Error('Core archive contains non-core modules');
    }
    if (pack.size > 100_000) throw new Error('Core tarball is unexpectedly large: ' + pack.size);
  } else if (item.name === 'agentscape3d-engine') {
    for (const file of ['dist/index.js', 'dist/node.js', 'dist/mcp.js', 'dist/runtime/package.json', 'cli.mjs']) {
      if (!includes(file)) throw new Error('Engine is missing ' + file);
    }
    if ([...paths].some(file => file.startsWith('site/'))) throw new Error('Engine must not bundle Studio site');
  } else {
    for (const file of ['site/index.html', 'site/studio/index.html', 'cli.mjs']) {
      if (!includes(file)) throw new Error('Studio is missing ' + file);
    }
    if (Object.keys(manifest.dependencies || {}).length || [...paths].some(file => file.startsWith('dist/runtime/'))) {
      throw new Error('Studio must not depend on the Engine or bundle runtime sources');
    }
  }
  checks[item.name] = { files: paths.size, bytes: pack.size, unpackedBytes: pack.unpackedSize };
}

const temporary = mkdtempSync(join(tmpdir(), 'agentscape-core-pack-'));
try {
  const coreFolder = join(root, 'sdk/typescript');
  const packOutput = JSON.parse(npm([
    'pack', '--json', '--ignore-scripts', '--pack-destination', temporary
  ], coreFolder));
  const packed = packOutput.agentscape3d || (Array.isArray(packOutput) ? packOutput[0] : null);
  if (!packed?.filename) throw new Error('Core npm pack has no filename');
  const consumer = join(temporary, 'consumer');
  mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, name: 'agentscape-core-test', type: 'module' }));
  npm([
    'install', '--offline', '--legacy-peer-deps', '--ignore-scripts',
    '--no-audit', '--no-fund', join(temporary, packed.filename)
  ], consumer);
  writeFileSync(join(consumer, 'smoke.mjs'), [
    "import assert from 'node:assert/strict';",
    "import { attach, AgentScape } from 'agentscape3d';",
    "const scene = { isObject3D: true, isScene: true, parent: null };",
    "const node = { isObject3D: true, uuid: 'node-1', name: 'door', parent: scene, rotation: { y: 0 } };",
    "const world = attach(scene);",
    "assert.equal(AgentScape.attach, attach);",
    "world.register(node, { id: 'door', type: 'anything', actions: { open: () => { node.rotation.y = 1; } } });",
    "await world.invoke('door','open');",
    "assert.equal(node.rotation.y, 1);",
    "assert.equal(world.inspect('door').type, 'anything');",
    "world.dispose();",
    "console.log('Isolated npm core consumer passed');"
  ].join('\n'));
  execFileSync(process.execPath, ['smoke.mjs'], { cwd: consumer, stdio: 'inherit' });
} finally {
  if (dirname(temporary) !== resolve(tmpdir()) || !basename(temporary).startsWith('agentscape-core-pack-')) {
    throw new Error('Unsafe temp cleanup path');
  }
  rmSync(temporary, { recursive: true, force: true });
}
console.log('SDK package boundaries verified:', JSON.stringify(checks));
