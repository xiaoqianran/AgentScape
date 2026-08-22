export class SceneGraph {
  constructor({ store, spatial, events = null } = {}) {
    this.store = store;
    this.spatial = spatial;
    this.events = events;
    this.edges = new Map();
  }

  key(subject, predicate, object) { return `${subject}|${predicate}|${object}`; }

  set(subject, predicate, object, meta = {}) {
    const edge = { subject, predicate, object, meta: { ...meta } };
    this.edges.set(this.key(subject, predicate, object), edge);
    return edge;
  }

  delete(subject, predicate, object) { return this.edges.delete(this.key(subject, predicate, object)); }
  clear() { this.edges.clear(); }

  removeObject(id) {
    for (const [key, edge] of this.edges) {
      if (edge.subject === id || edge.object === id) this.edges.delete(key);
    }
  }

  list({ subject, predicate, object } = {}) {
    return [...this.edges.values()].filter((edge) =>
      (!subject || edge.subject === subject) &&
      (!predicate || edge.predicate === predicate) &&
      (!object || edge.object === object)
    ).map((edge) => ({ ...edge, meta: { ...edge.meta } }));
  }

  update() {
    const previous = JSON.stringify(this.list());
    this.clear();
    const records = this.store.list();
    const bounds = new Map();
    const surfaces = new Map();

    // Cache geometry facts once per graph rebuild. Relation derivation below is O(n²),
    // rather than repeatedly recomputing Box3 data inside nested loops.
    for (const [id, record] of records) {
      bounds.set(id, this.spatial.getBounds(id));
      surfaces.set(id, (record.manifest.surfaces || [])
        .map((surface) => this.spatial.getSupportSurface(id, surface.id))
        .filter(Boolean));
    }

    for (let i = 0; i < records.length; i++) {
      const [id] = records[i];
      const a = bounds.get(id);

      for (let j = 0; j < records.length; j++) {
        if (i === j) continue;
        const [otherId] = records[j];
        const b = bounds.get(otherId);

        const distance = Math.hypot(
          a.center[0] - b.center[0],
          a.center[1] - b.center[1],
          a.center[2] - b.center[2]
        );
        if (distance <= 2) this.set(id, 'NEAR', otherId, { distance: Number(distance.toFixed(3)) });

        for (const support of surfaces.get(otherId)) {
          const withinX = a.min[0] >= support.center.x - support.size[0] / 2 - 0.05 && a.max[0] <= support.center.x + support.size[0] / 2 + 0.05;
          const withinZ = a.min[2] >= support.center.z - support.size[1] / 2 - 0.05 && a.max[2] <= support.center.z + support.size[1] / 2 + 0.05;
          const verticalGap = Math.abs(a.min[1] - support.center.y);
          if (withinX && withinZ && verticalGap <= 0.12) {
            this.set(id, 'ON', otherId, { surfaceId: support.id, gap: Number(verticalGap.toFixed(3)) });
            this.set(otherId, 'SUPPORTS', id, { surfaceId: support.id });
          }
        }

        const inside = a.min[0] >= b.min[0] && a.max[0] <= b.max[0] &&
          a.min[1] >= b.min[1] && a.max[1] <= b.max[1] &&
          a.min[2] >= b.min[2] && a.max[2] <= b.max[2];
        if (inside) {
          this.set(id, 'INSIDE', otherId);
          this.set(otherId, 'CONTAINS', id);
        }
      }
    }

    const next = JSON.stringify(this.list());
    if (next !== previous) this.events?.emit('sceneGraph.updated', { edges: this.edges.size });
    return this.list();
  }

  describe(id) {
    return {
      outgoing: this.list({ subject: id }),
      incoming: this.list({ object: id })
    };
  }
}
