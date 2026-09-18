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
    this.store = store;
    this.resolveModel = resolveModel;
    this.idFactory = idFactory;
    this.currentId = null;
    this.currentName = 'Untitled World';
    this.savedDocument = clone(authoring.export());
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
    return !diffAuthoringDocuments(this.savedDocument, this.authoring.export()).empty;
  }

  async list() {
    return this.store.list();
  }

  async newWorld({ name = 'Untitled World' } = {}) {
    this.authoring.clear();
    const document = this.authoring.export();
    this.authoring.load(document, { label:'New world' });
    this.currentId = null;
    this.currentName = String(name || 'Untitled World');
    this.savedDocument = clone(document);
    return this.status();
  }

  async openWorld(id) {
    const record = await this.store.load(id);
    if (!record) throw new TypeError('Authoring world not found: ' + id);

    await this.authoring.loadAsync(record.document, {
      resolveModel:this.resolveModel,
      label:'Open ' + (record.name || record.id)
    });

    this.currentId = record.id;
    this.currentName = record.name || record.id;
    this.savedDocument = clone(record.document);
    return this.status();
  }

  async save({ name = null } = {}) {
    const id = this.currentId || this.idFactory();
    const nextName = String(name || this.currentName || id);
    const document = this.authoring.export();

    const record = await this.store.save({ id, name:nextName, document });
    this.authoring.commit({
      label:'Save ' + nextName,
      source:'save'
    });

    this.currentId = record.id;
    this.currentName = record.name;
    this.savedDocument = clone(document);
    return clone(record);
  }

  async saveAs({ id = null, name = null } = {}) {
    const nextId = String(id || this.idFactory()).trim();
    if (!nextId) throw new TypeError('Save As requires a world id');
    const nextName = String(name || this.currentName || nextId);
    const document = this.authoring.export();

    const record = await this.store.save({ id:nextId, name:nextName, document });
    this.authoring.commit({
      label:'Save As ' + nextName,
      source:'save'
    });

    this.currentId = record.id;
    this.currentName = record.name;
    this.savedDocument = clone(document);
    return clone(record);
  }
}
