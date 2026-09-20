const DB_NAME = 'agentscape-world-authoring';
const DB_VERSION = 1;
const STORE_NAME = 'worlds';

function clone(value) {
  if (value == null) return value;
  return globalThis.structuredClone ? globalThis.structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
  });
}

export class AuthoringWorldStore {
  constructor({
    indexedDBImpl = globalThis.indexedDB,
    memory = new Map(),
    now = () => new Date().toISOString()
  } = {}) {
    this.indexedDB = indexedDBImpl;
    this.memory = memory;
    this.now = now;
    this.dbPromise = null;
  }

  async open() {
    if (!this.indexedDB?.open) return null;
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = this.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath:'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Unable to open Authoring world database'));
    });

    return this.dbPromise;
  }

  async save({ id, name = '', document, promotions = null }) {
    const worldId = String(id || '').trim();
    if (!worldId) throw new TypeError('Authoring world save requires id');
    if (!document || typeof document !== 'object') throw new TypeError('Authoring world save requires document');

    const previous = await this.load(worldId);
    const timestamp = this.now();
    const record = {
      id:worldId,
      name:String(name || worldId),
      createdAt:previous?.createdAt || timestamp,
      updatedAt:timestamp,
      document:clone(document),
      ...(promotions ? { promotions:clone(promotions) } : {})
    };

    const db = await this.open();
    if (!db) {
      this.memory.set(worldId, clone(record));
      return clone(record);
    }

    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    await transactionDone(tx);
    return clone(record);
  }

  async load(id) {
    const worldId = String(id || '').trim();
    if (!worldId) return null;

    const db = await this.open();
    if (!db) return clone(this.memory.get(worldId) || null);

    const tx = db.transaction(STORE_NAME, 'readonly');
    const value = await requestResult(tx.objectStore(STORE_NAME).get(worldId));
    return clone(value || null);
  }

  async list() {
    const db = await this.open();
    let records;

    if (!db) {
      records = [...this.memory.values()].map(clone);
    } else {
      const tx = db.transaction(STORE_NAME, 'readonly');
      records = await requestResult(tx.objectStore(STORE_NAME).getAll());
    }

    return records
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
      .map(({ document, promotions, ...metadata }) => clone(metadata));
  }

  async remove(id) {
    const worldId = String(id || '').trim();
    if (!worldId) return false;

    const db = await this.open();
    if (!db) return this.memory.delete(worldId);

    const exists = Boolean(await this.load(worldId));
    if (!exists) return false;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(worldId);
    await transactionDone(tx);
    return true;
  }
}
