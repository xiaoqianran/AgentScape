const MAX_ARRAY = 32;
const MAX_STRING = 2048;
const MAX_DEPTH = 5;

function compact(value, depth = 0) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (ArrayBuffer.isView(value)) return { type: value.constructor.name, bytes: value.byteLength };
  if (value instanceof ArrayBuffer) return { type: 'ArrayBuffer', bytes: value.byteLength };
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY).map((item) => compact(item, depth + 1));
    return value.length > MAX_ARRAY ? [...items, { truncated: value.length - MAX_ARRAY }] : items;
  }
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, MAX_ARRAY).map(([key, item]) => [key, compact(item, depth + 1)]));
  }
  return String(value);
}

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

function fnv1a(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export class TraceRecorder {
  constructor({ limit = 1000, events = null } = {}) {
    this.limit = limit;
    this.eventsBus = events;
    this.entries = [];
    this.seq = 0;
    this.previousHash = null;
    this.anchorHash = null;
  }

  emit(type, payload = {}, { actor = 'system', causedBy = [] } = {}) {
    const base = { seq: this.seq++, type, actor, payload: compact(payload), causedBy, at: new Date().toISOString() };
    const hash = fnv1a(stable({ previousHash: this.previousHash, ...base }));
    const entry = { ...base, integrity: { previousHash: this.previousHash, hash } };
    this.previousHash = hash;
    this.entries.push(entry);
    if (this.entries.length > this.limit) {
      const removed = this.entries.shift();
      this.anchorHash = removed.integrity.hash;
    }
    this.eventsBus?.emit('trace.event', entry);
    return entry;
  }

  list({ type, actor, sinceSeq = -1, limit = 200 } = {}) {
    return this.entries.filter((entry) => entry.seq > sinceSeq && (!type || entry.type === type) && (!actor || entry.actor === actor)).slice(-limit);
  }

  verify() {
    let previousHash = this.anchorHash;
    for (const entry of this.entries) {
      const { integrity, ...base } = entry;
      if (integrity.previousHash !== previousHash) return { ok: false, seq: entry.seq, reason: 'previous_hash_mismatch' };
      const expected = fnv1a(stable({ previousHash, ...base }));
      if (integrity.hash !== expected) return { ok: false, seq: entry.seq, reason: 'hash_mismatch' };
      previousHash = integrity.hash;
    }
    return { ok: true, entries: this.entries.length, lastHash: previousHash };
  }

}
