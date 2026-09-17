const clone = (value) => value == null ? value : structuredClone(value);

export class WorldObservation {
  constructor(runtime) {
    this.runtime = runtime;
  }

  hasObject(id) {
    return Boolean(id && this.runtime.store?.has(id));
  }

  object(id) {
    if (!this.hasObject(id)) return null;
    const record = this.runtime.store.get(id);
    const position = this.runtime.physics?.getPosition?.(id) || record.object?.position?.toArray?.() || null;
    return {
      id,
      asset: record.assetId,
      type: record.manifest?.type,
      position: Array.isArray(position) ? [...position] : null
    };
  }

  relations(ids = [], { limit = 8 } = {}) {
    if (!this.runtime.sceneGraph || !ids.length) return [];
    this.runtime.sceneGraph.update();
    const relevant = new Set(ids);
    const edges = [];
    for (const edge of this.runtime.sceneGraph.list()) {
      if (!relevant.has(edge.subject) && !relevant.has(edge.object)) continue;
      edges.push(clone(edge));
      if (edges.length >= limit) break;
    }
    return edges;
  }

  actor(id) {
    const object = this.object(id);
    if (!object) return null;
    return {
      id,
      position: object.position,
      navigation: this.runtime.locomotion?.status?.(id) || null,
      carry: this.runtime.interactions?.carryStatus?.(id) || null
    };
  }

  affordances(ids = [], { actorId = null } = {}) {
    const runtimeAffordances = this.runtime.affordances;
    if (!runtimeAffordances?.contracts || !runtimeAffordances.contracts().length) return null;
    return {
      count: runtimeAffordances.contracts().length,
      lastResult: clone(runtimeAffordances.lastResult || null),
      focus: ids.map((id) => runtimeAffordances.inspect(id, { actorId })).filter(Boolean)
    };
  }

  articulation(id) {
    if (!this.hasObject(id)) return null;
    const parts = this.runtime.store.get(id).manifest?.parts || {};
    const supported = Object.values(parts).some((part) => part?.joint && part?.physics && Object.keys(part.targets || {}).length);
    if (!supported || !this.runtime.interactions?.articulationStatus) return null;
    try {
      return clone(this.runtime.interactions.articulationStatus(id));
    } catch {
      return null;
    }
  }
}
