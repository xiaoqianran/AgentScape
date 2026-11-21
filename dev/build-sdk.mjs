import { rolldown } from 'rolldown';
import { build as buildVite } from 'vite';
import { readFile, writeFile, mkdir, copyFile, rm, lstat, cp, open, unlink } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const corePackage = new URL('sdk/typescript/', root);
const enginePackage = new URL('sdk/engine/', root);
const studioPackage = new URL('sdk/studio/', root);
const allowed = new Set(['--core', '--engine', '--studio']);
const flags = process.argv.slice(2);
const snapshotIndex = flags.indexOf('--snapshot');
const snapshot = snapshotIndex >= 0 ? flags.splice(snapshotIndex, 2)[1] : null;
if (snapshotIndex >= 0 && !snapshot) throw new Error('SDK_SNAPSHOT_PATH_REQUIRED');
if (flags.some(flag => !allowed.has(flag))) throw new Error('Unknown SDK build target: ' + flags.join(' '));
const enabled = name => !flags.length || flags.includes('--' + name);

// Serialize shared output writes when independent SDK contract suites build in parallel.
async function acquireBuildLock() {
  const url = new URL('sdk/.build-sdk.lock', root);
  for (let i = 0; i < 1200; i++) {
    try {
      const handle = await open(url, 'wx');
      await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
      return async () => {
        try { await handle.close(); } finally { await unlink(url).catch(error => {
          if (error.code !== 'ENOENT') throw error;
        }); }
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (i % 30 === 0) {
        try {
          const record = JSON.parse(await readFile(url, 'utf8'));
          if (Number.isInteger(record.pid) && record.pid > 0) {
            try { process.kill(record.pid, 0); }
            catch (error) { if (error.code === 'ESRCH') await unlink(url).catch(() => {}); }
          }
        } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw new Error('SDK_BUILD_LOCK_TIMEOUT: another build did not release its lock');
}

async function cleanDirectory(directory, parent) {
  const target = resolve(fileURLToPath(directory));
  if (dirname(target) !== resolve(fileURLToPath(parent))) throw new Error('Invalid SDK output path: ' + target);
  const existing = await lstat(target).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (existing?.isSymbolicLink()) throw new Error('SDK output cannot be a symlink: ' + target);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
}

async function bundleFile(input, output, options = {}) {
  const build = await rolldown({ input: fileURLToPath(input), ...options });
  try {
    await build.write({ file: fileURLToPath(output), format: 'es', sourcemap: true });
  } finally {
    await build.close();
  }
}

// Contract tests build into unique snapshots while the build lock is held.
async function snapshotSdkBuild(target) {
  if (!target) return;
  const directory = resolve(target);
  const parent = resolve(fileURLToPath(root));
  if (dirname(directory) !== parent ||
      !['.tmp-sdk-', '.tmp-sdk-journey-'].some(prefix => basename(directory).startsWith(prefix))) {
    throw new Error('SDK_SNAPSHOT_OUTSIDE_TEST_DIRECTORY');
  }
  if (enabled('core')) await cp(new URL('dist/', corePackage), resolve(directory, 'core'), { recursive: true });
  if (enabled('engine')) await cp(new URL('dist/', enginePackage), resolve(directory, 'dist'), { recursive: true });
  if (enabled('studio')) await cp(new URL('site/', studioPackage), resolve(directory, 'site'), { recursive: true });
}

async function buildCore() {
  const dist = new URL('dist/', corePackage);
  await cleanDirectory(dist, corePackage);
  await bundleFile(new URL('src/core.js', corePackage), new URL('core.js', dist));
  await bundleFile(new URL('src/index.ts', corePackage), new URL('index.js', dist));
  await copyFile(new URL('src/core.d.ts', corePackage), new URL('core.d.ts', dist));
  await copyFile(new URL('src/index.d.ts', corePackage), new URL('index.d.ts', dist));
  const manifest = JSON.parse(await readFile(new URL('package.json', corePackage), 'utf8'));
  if (Object.keys(manifest.dependencies || {}).length || manifest.bin ||
    Object.keys(manifest.exports || {}).some(key => !['.', './core'].includes(key))) {
    throw new Error('Core package must not require engine dependencies, CLI or plugin entrypoints');
  }
  console.log('agentscape3d core built without engine, Studio or MCP');
}

async function buildEngine() {
  const dist = new URL('dist/', enginePackage);
  await cleanDirectory(dist, enginePackage);
  const manifest = JSON.parse(await readFile(new URL('package.json', enginePackage), 'utf8'));
  const rootManifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  if (manifest.dependencies?.three) throw new Error('Engine must use host-provided Three.js');
  for (const [name, version] of Object.entries(manifest.dependencies || {})) {
    if (rootManifest.dependencies[name] !== version) throw new Error('Engine dependency drift: ' + name);
  }
  const engineBuild = await rolldown({
    input: fileURLToPath(new URL('src/index.ts', enginePackage)),
    external: id => !id.startsWith('.') && !id.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(id)
  });
  try {
    await engineBuild.write({
      dir: fileURLToPath(dist), format: 'es', entryFileNames: 'index.js', sourcemap: true
    });
  } finally {
    await engineBuild.close();
  }
  await bundleFile(new URL('src/core.js', corePackage), new URL('core.js', dist));
  const runtime = new URL('runtime/', dist);
  await mkdir(runtime);
  for (const directory of ['application', 'modules', 'foundation', 'apps/mcp-server', 'apps/server', 'public/assets']) {
    await cp(new URL(directory, root), new URL(directory, runtime), { recursive: true });
  }
  await copyFile(new URL('package-lock.json', root), new URL('package-lock.json', runtime));
  await copyFile(new URL('package.json', root), new URL('package.json', runtime));
  await copyFile(new URL('src/node.mjs', enginePackage), new URL('node.js', dist));
  await writeFile(new URL('mcp.js', dist), "export { startServer } from './runtime/apps/mcp-server/main.mjs';\n");
  await bundleFile(new URL('application/code-execution/BrowserCodeWorker.js', root), new URL('BrowserCodeWorker.js', dist));
  await copyFile(new URL('src/index.d.ts', enginePackage), new URL('index.d.ts', dist));
  await copyFile(new URL('src/core.d.ts', corePackage), new URL('core.d.ts', dist));
  await copyFile(new URL('src/node.d.ts', enginePackage), new URL('node.d.ts', dist));
  await copyFile(new URL('src/mcp.d.ts', enginePackage), new URL('mcp.d.ts', dist));
  console.log('agentscape3d-engine runtime and optional MCP entry built');
}

async function buildStudio() {
  const site = new URL('site/', studioPackage);
  await buildVite({ root: fileURLToPath(root), configFile: fileURLToPath(new URL('vite.config.js', root)) });
  await cleanDirectory(site, studioPackage);
  await cp(new URL('dist/', root), site, { recursive: true });
  console.log('agentscape3d-studio static website built');
}

const release = await acquireBuildLock();
try {
  if (enabled('core')) await buildCore();
  if (enabled('engine')) await buildEngine();
  if (enabled('studio')) await buildStudio();
  await snapshotSdkBuild(snapshot);
} finally {
  await release();
}
