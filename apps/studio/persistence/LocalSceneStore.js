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

  has() { return this.storage.getItem(this.key) != null; }
  clear() { this.storage.removeItem(this.key); }
}
