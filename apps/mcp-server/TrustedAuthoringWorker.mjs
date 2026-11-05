import { parentPort, workerData } from 'node:worker_threads';
import { build, execute } from './AuthoringSandboxEntry.js';

// Explicitly trusted Node code: filesystem/network access is NOT isolated.
try {
  const document = workerData.mode === 'procedural' ? build(workerData.source) : execute(workerData.code, workerData.document);
  const json = JSON.stringify(document);
  if (json.length > 2097152) throw new Error('BUILD_OUTPUT_LIMIT');
  parentPort.postMessage({ json });
} catch (error) { parentPort.postMessage({ error: String(error.message).slice(0, 500) }); }
