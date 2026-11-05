import { createCodeExecutor } from './CodeExecutor.js';

// Compatibility name; WASM/Worker isolation is not OS isolation.
export function createIsolatedAuthoringExecutor(options = {}) {
  return createCodeExecutor({ ...options, mode: 'worker-wasm' });
}
