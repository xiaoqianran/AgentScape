import { parentPort, workerData } from 'node:worker_threads';
import * as THREE from 'three';
import { serializeAsset, execute } from './AuthoringSandboxEntry.js';

// Explicitly trusted Node code: filesystem/network access is NOT isolated.
try {
  let document;
  if(workerData.mode === 'procedural') {
    const module = await import(`data:text/javascript;base64,${Buffer.from(workerData.source).toString('base64')}`);
    if(typeof module.createAsset !== 'function')throw new Error('PROCEDURAL_ENTRY_REQUIRED');
    document = serializeAsset(await module.createAsset(THREE));
  } else document = execute(workerData.code, workerData.document);
  const json = JSON.stringify(document);
  if (json.length > 2097152) throw new Error('BUILD_OUTPUT_LIMIT');
  parentPort.postMessage({ json });
} catch (error) { parentPort.postMessage({ error: String(error.message).slice(0, 500) }); }
