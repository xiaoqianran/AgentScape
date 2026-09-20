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
    this.savedDocument = clone(authoring.export());
    this.savedPromotions = clone(promotion?.exportState() || null);
  }

  status() {
    return {
      id:this.currentId,
      name:this.currentName,
      persisted:Boolean(this.currentId),
      dirty:this.isDirty()
    };
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
    this.promotion?.loadState();
    this.authoring.clear();
    const document = this.authoring.export();
    this.authoring.load(document, { label:'New world' });
    this.currentId = null;
    this.currentName = String(name || 'Untitled World');
    this.savedDocument = clone(document);
    this.savedPromotions = clone(this.promotion?.exportState() || null);
    return this.status();
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

      this.promotion?.loadState(record.promotions);

      this.currentId = record.id;
      this.currentName = record.name || record.id;
      this.savedDocument = clone(record.document);
      this.savedPromotions = clone(this.promotion?.exportState() || null);
      return this.status();
    } finally {
      this.fileBusy = false;
      if (this.promotion) this.promotion.fileBusy = false;
    }
  }

  async save({ name = null } = {}) {
    if (this.fileBusy || this.promotion?.busy) throw new Error('创作存档或晋升操作尚未完成');
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
    this.savedDocument = clone(document);
    this.savedPromotions = clone(promotions);
    return clone(record);
  }

  async saveAs({ id = null, name = null } = {}) {
    if (this.fileBusy || this.promotion?.busy) throw new Error('创作存档或晋升操作尚未完成');
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
    this.savedDocument = clone(document);
    this.savedPromotions = clone(promotions);
    return clone(record);
  }
}
