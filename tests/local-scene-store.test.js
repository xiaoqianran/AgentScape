import { describe, expect, it } from 'vitest';
import { LocalSceneStore } from '../src/persistence/LocalSceneStore.js';

class MemoryStorage {
  constructor(){ this.map = new Map(); }
  setItem(k,v){ this.map.set(k,String(v)); }
  getItem(k){ return this.map.has(k) ? this.map.get(k) : null; }
  removeItem(k){ this.map.delete(k); }
}

describe('LocalSceneStore', () => {
  it('round-trips JSON scenes', () => {
    const store = new LocalSceneStore({ storage: new MemoryStorage(), key: 'test' });
    const scene = { schema:'agentscape.scene', schemaVersion:1, objects:[{id:'a'}] };
    store.save(scene);
    expect(store.has()).toBe(true);
    expect(store.load()).toEqual(scene);
    store.clear();
    expect(store.has()).toBe(false);
  });
});
