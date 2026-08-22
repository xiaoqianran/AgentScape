function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
}

function fnv1a(input) {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export class TraceRecorder {
  constructor({ limit = 5000, events = null } = {}) {
    this.limit = limit;
    this.eventsBus = events;
    this.entries = [];
    this.seq = 0;
    this.previousHash = null;
  }

  emit(type, payload = {}, { actor = 'system', causedBy = [] } = {}) {
    const base = { seq: this.seq++, type, actor, payload, causedBy, at: new Date().toISOString() };
    const hash = fnv1a(stable({ previousHash: this.previousHash, ...base }));
    const entry = { ...base, integrity: { previousHash: this.previousHash, hash } };
    this.previousHash = hash;
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.shift();
    this.eventsBus?.emit('trace.event', entry);
    return entry;
  }

  list({ type, actor, sinceSeq = -1, limit = 200 } = {}) {
    return this.entries.filter((e) => e.seq > sinceSeq && (!type || e.type === type) && (!actor || e.actor === actor)).slice(-limit);
  }

  inspect() {
    return { count: this.entries.length, lastSeq: this.seq - 1, lastHash: this.previousHash, recent: this.entries.slice(-20) };
  }

  exportJsonl() { return this.entries.map((e) => JSON.stringify(e)).join('\n') + (this.entries.length ? '\n' : ''); }

  verify() {
    let previousHash = null;
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
