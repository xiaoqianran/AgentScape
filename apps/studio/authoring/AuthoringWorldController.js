import { diffAuthoringDocuments } from '../../../application/world-authoring/AuthoringDiff.js';

function clone(value) {
  if (value == null) return value;
  return globalThis.structuredClone ? globalThis.structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function defaultIdFactory() {
  const suffix = globalThis.crypto?.randomUUID?.() || (Date.now() + '-' + Math.random().toString(16).slice(2));
  return 'world_' + suffix;
}

export class AuthoringWorldController {
  constructor({
    authoring,
    promotion = null,
    store,
    resolveModel = null,
    idFactory = defaultIdFactory
  } = {}) {
    if (!authoring?.export || !authoring?.load || !authoring?.commit) {
      throw new TypeError('AuthoringWorldController requires WorldAuthoringContext');
    }
    if (!store?.save || !store?.load || !store?.list) {
      throw new TypeError('AuthoringWorldController requires AuthoringWorldStore');
    }

    this.authoring = authoring;
    this.promotion = promotion;
    this.store = store;
    this.resolveModel = resolveModel;
    this.idFactory = idFactory;
    this.currentId = null;
    this.currentName = 'Untitled World';
    this.authoringActive = false;
    this.statusListeners = new Set();
    this.savedDocument = clone(authoring.export());
    this.savedPromotions = clone(promotion?.exportState() || null);
  }

  status() {
    return {
      id:this.currentId,
      name:this.currentName,
      persisted:Boolean(this.currentId),
      active:this.authoringActive,
      dirty:this.isDirty()
    };
  }

  onStatusChange(listener) {
    if (typeof listener !== 'function') return () => {};
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  notifyStatusChange() {
    for (const listener of this.statusListeners) listener();
  }

  isDirty() {
    if (!this.savedDocument) return true;
    return !diffAuthoringDocuments(this.savedDocument, this.authoring.export()).empty
      || JSON.stringify(this.savedPromotions) !== JSON.stringify(this.promotion?.exportState() || null);
  }

  async list() {
    return this.store.list();
  }

  async newWorld({ name = 'Untitled World' } = {}) {
    if (this.fileBusy || this.promotion?.busy) throw new Error('创作存档或晋升操作尚未完成');
    this.fileBusy = true;
    try {
      this.promotion?.loadState();
      this.authoring.clear();
      const document = this.authoring.export();
      this.authoring.load(document, { label:'New world' });
      this.authoring.setPresentationMode?.('replace');
      this.currentId = null;
      this.currentName = String(name || 'Untitled World');
      this.authoringActive = true;
      this.notifyStatusChange();
      this.savedDocument = clone(document);
      this.savedPromotions = clone(this.promotion?.exportState() || null);
      return this.status();
    } finally {
      this.fileBusy = false;
    }
  }

  async openWorld(id) {
    if (this.fileBusy || this.promotion?.busy) throw new Error('创作存档或晋升操作尚未完成');
    this.fileBusy = true;
    if (this.promotion) this.promotion.fileBusy = true;
    try {
      const record = await this.store.load(id);
      if (!record) throw new TypeError('Authoring world not found: ' + id);
      this.promotion?.validateState(record.promotions);

      await this.authoring.loadAsync(record.document, {
        resolveModel:this.resolveModel,
        label:'Open ' + (record.name || record.id)
      });
      this.authoring.setPresentationMode?.('replace');

      this.promotion?.loadState(record.promotions);

      this.currentId = record.id;
      this.currentName = record.name || record.id;
      this.authoringActive = true;
      this.notifyStatusChange();
      this.savedDocument = clone(record.document);
      this.savedPromotions = clone(this.promotion?.exportState() || null);
      return this.status();
    } finally {
      this.fileBusy = false;
      if (this.promotion) this.promotion.fileBusy = false;
    }
  }

  async discardChanges() {
    if (this.fileBusy || this.promotion?.busy) throw new Error('创作存档或晋升操作尚未完成');
    this.fileBusy = true;
    try {
      if (this.savedDocument) {
        if (this.authoring.loadAsync) {
          await this.authoring.loadAsync(this.savedDocument, {
            resolveModel:this.resolveModel,
            label:'Discard unsaved changes'
          });
        } else {
          this.authoring.load(this.savedDocument, { label:'Discard unsaved changes' });
        }
      }
      this.promotion?.loadState(this.savedPromotions);
      this.notifyStatusChange();
      return this.status();
    } finally {
      this.fileBusy = false;
    }
  }

  // Leaves the draft-only presentation so runtime worlds render normally again.
  restoreOverlayPresentation() {
    this.authoring.setPresentationMode?.('overlay');
    this.authoringActive = false;
    this.notifyStatusChange();
  }

  async save({ name = null } = {}) {
    if (this.fileBusy || this.promotion?.busy) throw new Error('创作存档或晋升操作尚未完成');
    this.fileBusy = true;
    try {
      const id = this.currentId || this.idFactory();
      const nextName = String(name || this.currentName || id);
      const document = this.authoring.export();

      const promotions = this.promotion?.exportState() || null;
      const record = await this.store.save({ id, name:nextName, document, promotions });
      this.authoring.commit({
        label:'Save ' + nextName,
        source:'save'
      });

      this.currentId = record.id;
      this.currentName = record.name;
      this.authoringActive = true;
      this.notifyStatusChange();
      this.savedDocument = clone(document);
      this.savedPromotions = clone(promotions);
      return clone(record);
    } finally {
      this.fileBusy = false;
    }
  }

  async saveAs({ id = null, name = null } = {}) {
    if (this.fileBusy || this.promotion?.busy) throw new Error('创作存档或晋升操作尚未完成');
    this.fileBusy = true;
    try {
      const nextId = String(id || this.idFactory()).trim();
      if (!nextId) throw new TypeError('Save As requires a world id');
      const nextName = String(name || this.currentName || nextId);
      const document = this.authoring.export();

      const promotions = this.promotion?.exportState() || null;
      const record = await this.store.save({ id:nextId, name:nextName, document, promotions });
      this.authoring.commit({
        label:'Save As ' + nextName,
        source:'save'
      });

      this.currentId = record.id;
      this.currentName = record.name;
      this.authoringActive = true;
      this.notifyStatusChange();
      this.savedDocument = clone(document);
      this.savedPromotions = clone(promotions);
      return clone(record);
    } finally {
      this.fileBusy = false;
    }
  }

  async renameWorld(id, name) {
    if (this.fileBusy || this.promotion?.busy) throw new Error('创作存档或晋升操作尚未完成');
    if (!this.store.rename) throw new TypeError('AuthoringWorldStore does not support renaming');

    const worldId = String(id || '').trim();
    if (!worldId) throw new TypeError('Authoring world rename requires id');

    this.fileBusy = true;
    try {
      const record = await this.store.rename(worldId, name);
      if (!record) throw new TypeError('Authoring world not found: ' + worldId);
      if (this.currentId === record.id) this.currentName = record.name;
      return clone(record);
    } finally {
      this.fileBusy = false;
    }
  }

  async removeWorld(id) {
    if (this.fileBusy || this.promotion?.busy) throw new Error('创作存档或晋升操作尚未完成');
    if (!this.store.remove) throw new TypeError('AuthoringWorldStore does not support removing worlds');

    const worldId = String(id || '').trim();
    if (!worldId) throw new TypeError('Authoring world remove requires id');
    if (this.currentId === worldId) {
      throw new Error('当前正在编辑的草稿不能删除，请先打开其他世界或创建新草稿');
    }

    this.fileBusy = true;
    try {
      const removed = await this.store.remove(worldId);
      if (!removed) throw new TypeError('Authoring world not found: ' + worldId);
      return true;
    } finally {
      this.fileBusy = false;
    }
  }
}
