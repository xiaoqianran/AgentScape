const DB_NAME = 'agentscape-assets';
const STORE_NAME = 'compiled-glb';
const DB_VERSION = 1;

export class CompiledAssetStore {
  constructor({ indexedDBImpl = globalThis.indexedDB, maxDecodeBytes = 32 * 1024 * 1024 } = {}) {
    this.indexedDB = indexedDBImpl;
    this.memory = new Map();
    this.sources = new Map();
    this.maxDecodeBytes = maxDecodeBytes;
  }

  registerSource(key, { bytes, read }) {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || typeof read !== 'function' || this.sources.has(key)) throw new TypeError('Invalid compiled resource source');
    this.sources.set(key, { bytes, read });
  }

  async open() {
    if (!this.indexedDB) return null;
    return new Promise((resolve, reject) => {
      const request = this.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async put(key, bytes, metadata = {}) {
    const value = { bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), metadata, savedAt: new Date().toISOString() };
    const db = await this.open();
    if (!db) { this.memory.set(key, value); return key; }
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return key;
  }

  async get(key) {
    const source = this.sources.get(key);
    if (source) {
      if (source.bytes > this.maxDecodeBytes) throw Object.assign(new Error('ASSET_DECODE_BUDGET'), { code: 'ASSET_DECODE_BUDGET' });
      const bytes = new Uint8Array(source.bytes); let offset = 0;
      for await (const chunk of source.read()) {
        if (!(chunk instanceof Uint8Array) || offset + chunk.length > bytes.length) throw new Error('ASSET_RESOURCE_SIZE_MISMATCH');
        bytes.set(chunk, offset); offset += chunk.length;
      }
      if (offset !== bytes.length) throw new Error('ASSET_RESOURCE_SIZE_MISMATCH');
      return { bytes, metadata: { contentAddressed: true } };
    }
    const db = await this.open();
    if (!db) return this.memory.get(key) || null;
    const value = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return value;
  }

  async has(key) { return Boolean(await this.get(key)); }

  async delete(key) {
    if (this.sources.delete(key)) return true;
    const db = await this.open();
    if (!db) return this.memory.delete(key);
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  }
}
