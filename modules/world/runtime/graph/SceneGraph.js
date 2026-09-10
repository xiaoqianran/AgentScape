export class SceneGraph {
  constructor({ store, spatial, events = null } = {}) {
    this.store = store;
    this.spatial = spatial;
    this.events = events;
    this.edges = new Map();
    this.environmentFacts = [];
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
  reset() { this.edges.clear(); this.environmentFacts = []; this.dirty = false; this.batchDepth = 0; }


  setEnvironmentSemantics(environmentId, value = null) {
    this.environmentFacts = environmentSemanticFacts(environmentId, value);
    this.changed();
    return this.environmentFacts.map((fact) => ({ ...fact, meta:{...fact.meta} }));
  }

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
    for (const fact of this.environmentFacts) this.set(fact.subject, fact.predicate, fact.object, fact.meta);
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
        const status = this.spatial.supportStatus(subjectId,targetId,{surfaceId:support.id,snapshot:spatialSnapshot});
        if (status.on) {
          this.set(subjectId, 'ON', targetId, { surfaceId:support.id, gap:Number(status.gap.toFixed(3)) });
          this.set(targetId, 'SUPPORTS', subjectId, { surfaceId:support.id });
        }
      }
      const containment = this.spatial.insideStatus(subjectId,targetId,{snapshot:spatialSnapshot});
      if (containment.inside) {
        const meta = containment.receptacleId ? { receptacleId:containment.receptacleId } : {};
        this.set(subjectId, 'INSIDE', targetId, meta);
        this.set(targetId, 'CONTAINS', subjectId, meta);
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

const semanticKey = (label) => encodeURIComponent(String(label).trim().toLocaleLowerCase());
const instanceKey = (id) => encodeURIComponent(String(id).trim());
const finiteVec3 = (value) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);

function semanticPayload(value) {
  if (Array.isArray(value)) return { categories:value, instances:[], granularity:'category', sourceKind:'category-list', provenance:null };
  if ([1,2].includes(value?.schemaVersion) && Array.isArray(value.categories) && Array.isArray(value.instances)) {
    return {
      categories:value.categories, instances:value.instances,
      granularity:value.instances.length ? 'instance' : 'category',
      sourceKind:`runtime-semantics-v${value.schemaVersion}`,
      schemaVersion:value.schemaVersion,
      provenance:value.provenance && typeof value.provenance==='object' ? structuredClone(value.provenance) : null
    };
  }
  return { categories:[], instances:[], granularity:'none', sourceKind:value == null ? 'none' : 'unsupported', provenance:null };
}

function environmentSemanticFacts(environmentId, value) {
  const {categories,instances,granularity,sourceKind,provenance}=semanticPayload(value);
  const subject=`environment:${String(environmentId || 'environment')}`;
  const seenCategories=new Set();
  const facts=[];
  const addCategory=(rawLabel) => {
    if (typeof rawLabel !== 'string') return null;
    const label=rawLabel.trim();
    if (!label) return null;
    const key=label.toLocaleLowerCase();
    const categoryId=`semantic-category:${semanticKey(label)}`;
    if (!seenCategories.has(key)) {
      seenCategories.add(key);
      facts.push({
        subject,predicate:'HAS_CATEGORY',object:categoryId,
        meta:{label,granularity,sourceKind,...(provenance?{provenance:structuredClone(provenance)}:{})}
      });
    }
    return categoryId;
  };
  for (const item of categories) addCategory(item);

  const seenInstances=new Set();
  for (const item of instances) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const id=typeof item.id === 'string' ? item.id.trim() : '';
    const label=typeof item.label === 'string' ? item.label.trim() : '';
    if (!id || !label) continue;
    let spatialMeta=null;
    if (finiteVec3(item.center) && finiteVec3(item.bbox?.min) && finiteVec3(item.bbox?.max)) {
      spatialMeta={center:[...item.center],bbox:{min:[...item.bbox.min],max:[...item.bbox.max]}};
    } else if (item.localization?.kind==='point-scale' && finiteVec3(item.localization.center) && Number.isFinite(item.localization.scale) && item.localization.scale>0) {
      spatialMeta={localization:structuredClone(item.localization)};
    } else continue;
    const instanceId=`semantic-instance:${instanceKey(id)}`;
    if (seenInstances.has(instanceId)) continue;
    seenInstances.add(instanceId);
    const categoryId=addCategory(label);
    const meta={
      id,label,...spatialMeta,
      ...(Number.isFinite(item.confidence)?{confidence:item.confidence}:{}),
      ...(item.evidence && typeof item.evidence==='object'?{evidence:structuredClone(item.evidence)}:{}),
      sourceKind,...(provenance?{provenance:structuredClone(provenance)}:{})
    };
    facts.push({subject,predicate:'HAS_INSTANCE',object:instanceId,meta});
    facts.push({subject:instanceId,predicate:'INSTANCE_OF',object:categoryId,meta:{label,sourceKind}});
  }
  return facts;
}
