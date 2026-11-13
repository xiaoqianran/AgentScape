import { worldStorageError } from '../scene/WorldStorage.js';

const fail = code => worldStorageError(code);
const copy = value => value == null ? null : structuredClone(value);
const same = (a, b) => a?.hash === b?.hash && a?.bytes === b?.bytes && a?.kind === b?.kind;
const validateRoot = root => {
  if (!root || root.kind !== 'native-overlay' || !/^[a-f0-9]{64}$/.test(root.hash)
    || !Number.isSafeInteger(root.bytes) || root.bytes <= 0 || root.bytes > 1024 * 1024)
    throw fail('NATIVE_OVERLAY_HEAD_INVALID');
};

/** In-memory reference store used by headless tests and custom adapters. */
export class MemoryNativeOverlayHeadStore {
  constructor() { this.root = null; }
  async read() { return copy(this.root); }
  async publish(expected, root) {
    validateRoot(root);
    if (!same(this.root, expected)) throw fail('NATIVE_OVERLAY_HEAD_CONFLICT');
    this.root = copy(root);
    return copy(root);
  }
}

/** Atomic browser head-pointer updates in an IndexedDB readwrite transaction.
 * Only the pointer lives here; immutable bytes remain in WorldStorage.
 */
export class IndexedDBNativeOverlayHeadStore {
  constructor({ key, databaseName = 'agentscape-native-overlays-v1' } = {}) {
    if (typeof key !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(key)
      || typeof databaseName !== 'string' || !databaseName.length)
      throw fail('NATIVE_OVERLAY_HEAD_KEY_INVALID');
    this.key = key;
    this.databaseName = databaseName;
  }
  async open() {
    if (typeof indexedDB === 'undefined') throw fail('NATIVE_OVERLAY_INDEXEDDB_UNAVAILABLE');
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('heads'))
          request.result.createObjectStore('heads');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(fail('NATIVE_OVERLAY_HEAD_DB_BLOCKED'));
    });
  }
  async read() {
    const db = await this.open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('heads', 'readonly');
        const request = tx.objectStore('heads').get(this.key);
        let root = null;
        request.onsuccess = () => { root = request.result ?? null; };
        tx.oncomplete = () => resolve(copy(root));
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || fail('NATIVE_OVERLAY_HEAD_READ_FAILED'));
      });
    } finally { db.close(); }
  }
  async publish(expected, root) {
    validateRoot(root);
    const db = await this.open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('heads', 'readwrite');
        const store = tx.objectStore('heads');
        const request = store.get(this.key);
        let conflict = false;
        request.onsuccess = () => {
          if (!same(request.result ?? null, expected ?? null)) {
            conflict = true;
            tx.abort();
            return;
          }
          store.put(copy(root), this.key);
        };
        tx.oncomplete = () => resolve(copy(root));
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(conflict ? fail('NATIVE_OVERLAY_HEAD_CONFLICT')
          : tx.error || fail('NATIVE_OVERLAY_HEAD_PUBLISH_FAILED'));
      });
    } finally { db.close(); }
  }
}

/** Orchestrates save -> dependency verification -> atomic head publish. */
export function createNativeOverlayCheckpoint(scene, storage, heads) {
  if (!scene?.saveOverlay || !scene?.prepareOverlay || !scene?.restoreOverlay ||
      !storage?.node || !heads?.read || !heads?.publish)
    throw fail('NATIVE_OVERLAY_CHECKPOINT_OPTIONS');
  let busy = false;
  const exclusive = async fn => {
    if (busy) throw fail('NATIVE_OVERLAY_CHECKPOINT_BUSY');
    busy = true;
    try { return await fn(); } finally { busy = false; }
  };
  return {
    readLatest: () => heads.read(),
    saveLatest: (options = {}) => exclusive(async () => {
      const expected = await heads.read();
      if (expected) validateRoot(expected);
      const root = await scene.saveOverlay(storage, options);
      // Verify all referenced blocks, assets and environment *before* publishing
      // a new head. The prepared state never commits to the live Runtime.
      const prepared = await scene.prepareOverlay(storage, root, options);
      try { await heads.publish(expected, root); }
      finally { prepared.dispose(); }
      return root;
    }),
    restoreLatest: (options = {}) => exclusive(async () => {
      const root = await heads.read();
      if (!root) return null;
      validateRoot(root);
      await scene.restoreOverlay(storage, root, options);
      return root;
    })
  };
}

/** Opens a checkpoint with opt-in automatic restore of the latest head. */
export async function openNativeOverlayCheckpoint(scene, storage, heads, { restore = true } = {}) {
  const checkpoint = createNativeOverlayCheckpoint(scene, storage, heads);
  if (restore) await checkpoint.restoreLatest();
  return checkpoint;
}
