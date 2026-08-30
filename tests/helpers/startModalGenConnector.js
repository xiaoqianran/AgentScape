import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENTSCAPE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODAL_GEN_ROOT = path.resolve(AGENTSCAPE_ROOT, '../modal-provider/modal-gen-client');
const SERVER_SCRIPT = path.join(MODAL_GEN_ROOT, 'tests/fixtures/agentscape_e2e_server.py');
const CONTROL_TOKEN = 'agentscape-e2e-control';
const TEMP_PREFIX = 'agentscape-modal-gen-e2e-';
const HEALTH_TIMEOUT_MS = 30_000;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth(endpoint, child, diagnostics, getSpawnError) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (getSpawnError()) throw getSpawnError();
    if (child.exitCode !== null) {
      throw new Error(`modal-gen-client exited during startup (${child.exitCode}): ${diagnostics()}`);
    }
    try {
      const response = await fetch(`${endpoint}/health`);
      if (response.ok) return;
    } catch {}
    await delay(50);
  }
  throw new Error(`modal-gen-client did not become healthy: ${diagnostics()}`);
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await Promise.race([exited, delay(3_000)]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await Promise.race([exited, delay(1_000)]);
  }
}

async function removeTempRoot(root) {
  const isOwnedTempRoot = path.dirname(root) === path.resolve(tmpdir())
    && path.basename(root).startsWith(TEMP_PREFIX);
  if (isOwnedTempRoot) await rm(root, { recursive: true, force: true });
}

export async function startModalGenConnector({ glbBytes, origin = 'http://localhost:5173' } = {}) {
  if (!(glbBytes instanceof Uint8Array) || !glbBytes.byteLength) {
    throw new TypeError('startModalGenConnector requires GLB bytes');
  }

  const root = await mkdtemp(path.join(tmpdir(), TEMP_PREFIX));
  const glbPath = path.join(root, 'cup.glb');
  await writeFile(glbPath, glbBytes);
  const port = await availablePort();
  const endpoint = `http://127.0.0.1:${port}`;
  const output = [];
  const child = spawn('uv', [
    'run', 'python', SERVER_SCRIPT,
    '--port', String(port),
    '--glb', glbPath,
    '--data-dir', root
  ], {
    cwd: MODAL_GEN_ROOT,
    env: {
      ...process.env,
      MODAL_GEN_AGENT_TOKEN: CONTROL_TOKEN,
      MODAL_GEN_ALLOW_ANY_ORIGIN: '0'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let spawnError;
  const capture = (chunk) => {
    output.push(String(chunk));
    if (output.length > 100) output.shift();
  };
  child.once('error', (error) => { spawnError = error; });
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const diagnostics = () => output.join('').slice(-8_000);

  try {
    await waitForHealth(endpoint, child, diagnostics, () => spawnError);
  } catch (error) {
    await stopChild(child);
    await removeTempRoot(root);
    throw error;
  }

  let disposed = false;
  return {
    endpoint,
    origin,
    pid: child.pid,
    async approve(pairingId) {
      const response = await fetch(`${endpoint}/v1/pairings/${encodeURIComponent(pairingId)}/approve`, {
        method: 'POST',
        headers: { 'X-Modal-Gen-Session': CONTROL_TOKEN }
      });
      if (!response.ok) {
        throw new Error(`modal-gen-client pairing approval failed: HTTP ${response.status}`);
      }
      return response.json();
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await stopChild(child);
      await removeTempRoot(root);
    },
    diagnostics
  };
}
