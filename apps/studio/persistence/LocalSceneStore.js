export class LocalSceneStore {
  constructor({ storage = localStorage, key = 'agentscape.scene.autosave' } = {}) {
    this.storage = storage;
    this.key = key;
  }

  save(scene) {
    this.storage.setItem(this.key, JSON.stringify(scene));
    return scene;
  }

  load() {
    const raw = this.storage.getItem(this.key);
    return raw ? JSON.parse(raw) : null;
  }

  setKey(key) {
    const next=String(key || '').trim();
    if(!next) throw new TypeError('LocalSceneStore key is required');
    this.key=next;
    return this;
  }

  has() { return this.storage.getItem(this.key) != null; }
  clear() { this.storage.removeItem(this.key); }
}
