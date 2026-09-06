const DB_NAME = 'agentscape-artifacts';
const DB_VERSION = 1;
const DESCRIPTOR_STORE = 'descriptors';
const BYTE_STORE = 'bytes';

const clone = (value) => value == null ? value : structuredClone(value);

export class IndexedDbArtifactStore {
  constructor({ indexedDBImpl = globalThis.indexedDB } = {}) {
    this.indexedDB = indexedDBImpl;
  }

  async open() {
    if (!this.indexedDB) return null;
    return new Promise((resolve, reject) => {
      const request = this.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DESCRIPTOR_STORE)) db.createObjectStore(DESCRIPTOR_STORE);
        if (!db.objectStoreNames.contains(BYTE_STORE)) db.createObjectStore(BYTE_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async load() {
    const db = await this.open();
    if (!db) return { descriptors: [], entries: [] };
    try {
      const tx = db.transaction([DESCRIPTOR_STORE, BYTE_STORE], 'readonly');
      const readAll = (storeName) => new Promise((resolve, reject) => {
        const request = tx.objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
      const [descriptors, entries] = await Promise.all([
        readAll(DESCRIPTOR_STORE),
        readAll(BYTE_STORE)
      ]);
      return {
        descriptors: descriptors.map(clone),
        entries: entries.map((entry) => ({ ...clone(entry), data: new Uint8Array(entry.data) }))
      };
    } finally {
      db.close();
    }
  }

  async putArtifact(descriptor, entry) {
    const db = await this.open();
    if (!db) return false;
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction([DESCRIPTOR_STORE, BYTE_STORE], 'readwrite');
        tx.objectStore(DESCRIPTOR_STORE).put(clone(descriptor), descriptor.id);
        tx.objectStore(BYTE_STORE).put({ ...clone(entry), data: new Uint8Array(entry.data) }, entry.key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      return true;
    } finally {
      db.close();
    }
  }
}
