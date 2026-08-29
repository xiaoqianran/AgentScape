import { Errors } from '../../core/errors.js';

export class ObjectStore {
  constructor() { this.items = new Map(); }
  add(id, value) {
    if (this.items.has(id)) throw new Error(`Duplicate object id: ${id}`);
    this.items.set(id, value); return value;
  }
  get(id) { const value = this.items.get(id); if (!value) throw Errors.objectNotFound(id); return value; }
  has(id) { return this.items.has(id); }
  delete(id) { return this.items.delete(id); }
  values() { return this.items.values(); }
  entries() { return this.items.entries(); }
  list() { return [...this.items.entries()]; }
  clear() { this.items.clear(); }
}
