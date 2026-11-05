import { Worker } from 'node:worker_threads';
import { sandboxBundle } from './SandboxBundle.js';
import { pipelineDigest } from './BuildEnvironment.js';
import { validateRemoteAuthoringDocument } from './RemoteAuthoringDocument.js';
import { DockerBuildRunner } from './DockerBuildRunner.js';

/** Execution contract: environment(), run(request, {signal}), execute(), close().
 * Worker resource limits are reliability controls, NOT OS isolation.
 */
export function createCodeExecutor({ mode = 'worker-wasm', authorized = false, remote = false, timeoutMs = 1500,
  wallTimeoutMs = 12000, memoryBytes = 96 * 1024 * 1024, ...options } = {}) {
  if (!['disabled', 'worker-wasm', 'trusted-local', 'os-isolated'].includes(mode)) throw new Error('CODE_EXECUTION_MODE_INVALID');
  if (remote && !['disabled', 'os-isolated'].includes(mode)) throw new Error('OS_ISOLATION_REQUIRED');
  if (mode === 'trusted-local' && authorized !== true) throw new Error('CODE_EXECUTION_AUTHORIZATION_REQUIRED');
  if (mode === 'os-isolated') return new DockerBuildRunner(options);
  const active = new Set();
  let closed = false;
  const check = () => {
    if (closed) throw new Error('AUTHORING_EXECUTOR_CLOSED');
    if (mode === 'disabled') throw new Error('CODE_EXECUTION_DISABLED');
  };
  const executor = {
    async environment() {
      check();
      return { engine: mode, builderVersion: '2', threeVersion: '0.186.0',
        digest: (await sandboxBundle()).digest, pipelineDigest: await pipelineDigest() };
    },
    async run(request, { signal } = {}) {
      check();
      if (signal?.aborted) throw new Error('BUILD_CANCELLED');
      if (!['authoring', 'procedural'].includes(request.mode)) throw new Error('BUILD_MODE_INVALID');
      const source = request.mode === 'procedural' ? request.source : request.code;
      if (typeof source !== 'string' || Buffer.byteLength(source) > 32768) throw new Error('BUILD_SOURCE_LIMIT');
      if (request.mode === 'authoring') validateRemoteAuthoringDocument(request.document);
      const environment = await executor.environment();
      const bundle = mode === 'worker-wasm' ? (await sandboxBundle()).code : undefined;
      check();
      if (signal?.aborted) throw new Error('BUILD_CANCELLED');
      return new Promise((resolve, reject) => {
        const worker = new Worker(new URL(mode === 'worker-wasm' ? './AuthoringSandboxWorker.mjs' : './TrustedAuthoringWorker.mjs', import.meta.url), {
          workerData: { ...request, bundle, timeoutMs, memoryBytes }, resourceLimits: { maxOldGenerationSizeMb: Math.ceil(memoryBytes / 1048576) }, execArgv: []
        });
        let finished = false;
        const finish = (error, value) => {
          if (finished) return;
          finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
          active.delete(cancel); void worker.terminate();
          if (error) reject(error); else resolve(value);
        };
        const abort = () => finish(new Error('BUILD_CANCELLED'));
        const cancel = () => finish(new Error('AUTHORING_EXECUTOR_CLOSED'));
        const timer = setTimeout(() => finish(new Error('AUTHORING_CODE_TIMEOUT')), wallTimeoutMs);
        active.add(cancel); signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        worker.once('message', message => {
          if (message.error) return finish(Object.assign(new Error('BUILD_EXECUTION_FAILED'), { details: { message: message.error } }));
          try {
            if (typeof message.json !== 'string' || message.json.length > 2097152) throw new Error('BUILD_OUTPUT_LIMIT');
            finish(null, { document: validateRemoteAuthoringDocument(JSON.parse(message.json)), environment,
              security: { mode, osIsolation: false, trusted: mode === 'trusted-local', memoryBytes, wallTimeoutMs } });
          } catch (error) { finish(error); }
        });
        worker.once('error', error => finish(Object.assign(new Error('AUTHORING_SANDBOX_FAILED'), { details: { message: error.message } })));
        worker.once('exit', () => finish(new Error('AUTHORING_SANDBOX_STOPPED')));
      });
    },
    async execute(request, options) { return (await executor.run({ ...request, mode: 'authoring' }, options)).document; },
    close() { closed = true; for (const cancel of active) cancel(); }
  };
  return executor;
}
