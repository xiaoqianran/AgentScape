const DB_NAME='agentscape-asset-library';
const DB_VERSION=1;
const STORE_NAME='entries';
const clone=(value)=>value==null?value:structuredClone(value);

export class LocalAssetLibraryStore {
  constructor({indexedDBImpl=globalThis.indexedDB}={}) {
    this.indexedDB=indexedDBImpl;
    this.memory=new Map();
  }

  async open() {
    if(!this.indexedDB) return null;
    return new Promise((resolve,reject)=>{
      const request=this.indexedDB.open(DB_NAME,DB_VERSION);
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
  }

  async put(entry) {
    const value=clone(entry);
    const db=await this.open();
    if(!db) { this.memory.set(value.assetId,value); return value.assetId; }
    try {
      await new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE_NAME,'readwrite');
        tx.objectStore(STORE_NAME).put(value,value.assetId);
        tx.oncomplete=resolve;
        tx.onerror=()=>reject(tx.error);
        tx.onabort=()=>reject(tx.error);
      });
      return value.assetId;
    } finally { db.close(); }
  }

  async get(assetId) {
    const db=await this.open();
    if(!db) return clone(this.memory.get(assetId)||null);
    try {
      return await new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE_NAME,'readonly');
        const request=tx.objectStore(STORE_NAME).get(assetId);
        request.onsuccess=()=>resolve(clone(request.result||null));
        request.onerror=()=>reject(request.error);
      });
    } finally { db.close(); }
  }

  async list() {
    const db=await this.open();
    if(!db) return [...this.memory.values()].map(clone);
    try {
      return await new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE_NAME,'readonly');
        const request=tx.objectStore(STORE_NAME).getAll();
        request.onsuccess=()=>resolve((request.result||[]).map(clone));
        request.onerror=()=>reject(request.error);
      });
    } finally { db.close(); }
  }

  async delete(assetId) {
    const db=await this.open();
    if(!db) return this.memory.delete(assetId);
    try {
      await new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE_NAME,'readwrite');
        tx.objectStore(STORE_NAME).delete(assetId);
        tx.oncomplete=resolve;
        tx.onerror=()=>reject(tx.error);
        tx.onabort=()=>reject(tx.error);
      });
      return true;
    } finally { db.close(); }
  }
}
