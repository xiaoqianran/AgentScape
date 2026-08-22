export class SceneGraph {
  constructor({ store, spatial, events = null } = {}) {
    this.store = store;
    this.spatial = spatial;
    this.events = events;
    this.edges = new Map();
    this.batchDepth = 0;
    this.dirty = true;
  }

  key(subject, predicate, object) { return `${subject}|${predicate}|${object}`; }

  set(subject, predicate, object, meta = {}) {
    const edge = { subject, predicate, object, meta: { ...meta } };
    this.edges.set(this.key(subject, predicate, object), edge);
    return edge;
  }

  delete(subject, predicate, object) { return this.edges.delete(this.key(subject, predicate, object)); }
  clear() { this.edges.clear(); }
  reset() { this.edges.clear(); this.dirty = false; this.batchDepth = 0; }

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

  invalidate() { this.dirty = true; }

  changed() {
    this.invalidate();
    if (this.batchDepth === 0) this.update();
  }

  async batch(operation) {
    this.batchDepth += 1;
    try {
      return await operation();
    } finally {
      this.batchDepth -= 1;
      if (this.batchDepth === 0) this.update();
    }
  }

  // update() means callers need a current graph. It may rebuild even inside a batch.
  update(snapshot = null) {
    if (this.dirty) this.rebuild(snapshot);
  }

  rebuild(snapshot = null) {
    const previous = JSON.stringify([...this.edges.values()]);
    this.clear();
    const records = this.store.list();
    const spatialSnapshot = snapshot || this.spatial.snapshot();
    const surfaces = new Map();

    for (const [id, record] of records) {
      surfaces.set(id, (record.manifest.surfaces || [])
        .map((surface) => this.spatial.getSupportSurface(id, surface.id, spatialSnapshot))
        .filter(Boolean));
    }

    const deriveDirected = (subjectId, subject, targetId, target) => {
      for (const support of surfaces.get(targetId)) {
        const withinX = subject.box.min.x >= support.center.x - support.size[0] / 2 - 0.05 && subject.box.max.x <= support.center.x + support.size[0] / 2 + 0.05;
        const withinZ = subject.box.min.z >= support.center.z - support.size[1] / 2 - 0.05 && subject.box.max.z <= support.center.z + support.size[1] / 2 + 0.05;
        const gap = Math.abs(subject.box.min.y - support.center.y);
        if (withinX && withinZ && gap <= 0.12) {
          this.set(subjectId, 'ON', targetId, { surfaceId: support.id, gap: Number(gap.toFixed(3)) });
          this.set(targetId, 'SUPPORTS', subjectId, { surfaceId: support.id });
        }
      }
      if (target.box.containsBox(subject.box)) {
        this.set(subjectId, 'INSIDE', targetId);
        this.set(targetId, 'CONTAINS', subjectId);
      }
    };

    for (let i = 0; i < records.length; i++) {
      const [id] = records[i];
      const a = spatialSnapshot.get(id);
      for (let j = i + 1; j < records.length; j++) {
        const [otherId] = records[j];
        const b = spatialSnapshot.get(otherId);
        const distance = a.center.distanceTo(b.center);
        if (distance <= 2) {
          const meta = { distance: Number(distance.toFixed(3)) };
          this.set(id, 'NEAR', otherId, meta);
          this.set(otherId, 'NEAR', id, meta);
        }
        deriveDirected(id, a, otherId, b);
        deriveDirected(otherId, b, id, a);
      }
    }

    this.dirty = false;
    const next = JSON.stringify([...this.edges.values()]);
    if (next !== previous) this.events?.emit('sceneGraph.updated', { edges: this.edges.size });
  }

  describe(id) {
    return {
      outgoing: this.list({ subject: id }),
      incoming: this.list({ object: id })
    };
  }
}
