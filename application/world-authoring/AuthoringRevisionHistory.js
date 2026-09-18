import {
  canonicalizeAuthoringDocument,
  diffAuthoringDocuments
} from './AuthoringDiff.js';
import { parseAuthoringDocument } from './AuthoringDocument.js';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeLimit(value) {
  const limit = Number(value ?? 64);
  if (!Number.isInteger(limit) || limit < 2) {
    throw new TypeError('World Authoring revision history limit must be an integer >= 2');
  }
  return limit;
}

export class AuthoringRevisionHistory {
  constructor({ limit = 64, now = () => new Date().toISOString() } = {}) {
    this.limit = normalizeLimit(limit);
    this.now = now;
    this.entries = [];
    this.cursor = -1;
    this.sequence = 0;
  }

  reset(document, { label = 'Loaded world', source = 'load' } = {}) {
    parseAuthoringDocument(document);
    this.entries = [];
    this.cursor = -1;
    this.sequence = 0;
    return this.commit(document, { label, source, force:true });
  }

  commit(document, {
    label = '',
    source = 'manual',
    force = false
  } = {}) {
    parseAuthoringDocument(document);
    const snapshot = clone(document);
    const canonical = canonicalizeAuthoringDocument(snapshot);
    const current = this.entries[this.cursor];

    if (!force && current && canonicalizeAuthoringDocument(current.document) === canonical) {
      return { created:false, revision:this.describe(current) };
    }

    if (this.cursor < this.entries.length - 1) {
      this.entries.splice(this.cursor + 1);
    }

    const entry = {
      id:`rev_${String(++this.sequence).padStart(6, '0')}`,
      index:this.cursor + 1,
      label:String(label || ''),
      source:String(source || 'manual'),
      createdAt:this.now(),
      document:snapshot
    };

    this.entries.push(entry);
    this.cursor = this.entries.length - 1;

    while (this.entries.length > this.limit) {
      this.entries.shift();
      this.cursor -= 1;
    }

    this.reindex();
    return { created:true, revision:this.describe(this.entries[this.cursor]) };
  }

  reindex() {
    this.entries.forEach((entry, index) => {
      entry.index = index;
    });
  }

  describe(entry) {
    if (!entry) return null;
    return {
      id:entry.id,
      index:entry.index,
      label:entry.label,
      source:entry.source,
      createdAt:entry.createdAt
    };
  }

  list() {
    return this.entries.map(entry => ({
      ...this.describe(entry),
      current:entry === this.entries[this.cursor]
    }));
  }

  current() {
    return this.describe(this.entries[this.cursor]);
  }

  currentDocument() {
    return clone(this.entries[this.cursor]?.document || null);
  }

  getDocument(revisionId) {
    const entry = this.entries.find(item => item.id === revisionId);
    if (!entry) throw new TypeError(`World Authoring revision not found: ${revisionId}`);
    return clone(entry.document);
  }

  canUndo() {
    return this.cursor > 0;
  }

  canRedo() {
    return this.cursor >= 0 && this.cursor < this.entries.length - 1;
  }

  undo() {
    if (!this.canUndo()) return null;
    this.cursor -= 1;
    return {
      revision:this.current(),
      document:this.currentDocument()
    };
  }

  redo() {
    if (!this.canRedo()) return null;
    this.cursor += 1;
    return {
      revision:this.current(),
      document:this.currentDocument()
    };
  }

  diff(fromRevisionId, toRevisionId) {
    const before = this.getDocument(fromRevisionId);
    const after = this.getDocument(toRevisionId);
    return diffAuthoringDocuments(before, after);
  }
}
