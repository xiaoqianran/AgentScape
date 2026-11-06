import { Errors } from '../errors.js';

export class ObjectStore {
  constructor() { this.items = new Map(); }
  get size() { return this.items.size; }
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
  /** Bounded allocation; offset traversal is O(offset + limit). Live insertion order. */
  page({ offset = 0, limit = 100 } = {}) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new RangeError('Invalid object page');
    }
    const entries = [];
    let index = 0;
    for (const entry of this.items) {
      if (index++ < offset) continue;
      entries.push(entry);
      if (entries.length === limit) break;
    }
    return { entries, nextOffset: offset + entries.length < this.size ? offset + entries.length : null };
  }
  clear() { this.items.clear(); }
}
