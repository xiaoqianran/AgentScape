const DB_NAME = 'agentscape-assets';
const STORE_NAME = 'compiled-glb';
const DB_VERSION = 1;

export class CompiledAssetStore {
  constructor({ indexedDBImpl = globalThis.indexedDB } = {}) {
    this.indexedDB = indexedDBImpl;
    this.memory = new Map();
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
