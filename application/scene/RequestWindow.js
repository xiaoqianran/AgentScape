/**
 * Session-local bounded idempotency: replay in-flight and recently settled
 * requests. Oldest settled records may be evicted under pressure; never evict
 * a running request. Callers must check capacity before starting a mutation.
 */
export function createRequestWindow({
  now = () => Date.now(), limit = 256, retentionMs = 300_000,
  conflictCode = 'IDEMPOTENCY_CONFLICT', limitCode = 'REQUEST_BUDGET_EXHAUSTED'
} = {}) {
  const records = new Map();
  const issue = code => Object.assign(new Error(code), { code });

  const prune = () => {
    const current = now();
    for (const [id, entry] of records) {
      if (entry.settledAt !== null && current - entry.settledAt >= retentionMs)
        records.delete(id);
    }
  };

  return {
    get size() { return records.size; },
    replay(id, fingerprint) {
      if (!id) return null;
      prune();
      const existing = records.get(id);
      if (!existing) return null;
      if (existing.fingerprint !== fingerprint) throw issue(conflictCode);
      return existing.promise;
    },
    ensureCapacity() {
      prune();
      if (records.size >= limit) {
        for (const [id, entry] of records) {
          if (entry.settledAt !== null) {
            records.delete(id);
            if (records.size < limit) break;
          }
        }
      }
      if (records.size >= limit) throw issue(limitCode);
    },
    track(id, fingerprint, promise) {
      if (!id) return;
      const entry = { fingerprint, promise, settledAt: null };
      records.set(id, entry);
      const settled = () => { entry.settledAt = now(); };
      // The failure handler is required; tracking must not create an
      // unhandled rejection for an operation that the caller will catch.
      void promise.then(settled, settled);
    },
    clear() { records.clear(); }
  };
}
