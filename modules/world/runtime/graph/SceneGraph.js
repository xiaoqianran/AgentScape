import * as THREE from 'three';

// Broad-phase only: the SpatialSystem remains the source of truth for exact
// ON / INSIDE geometry. Reject only pairs that cannot possibly match.
const mayRestOn = (subjectBox, surface) => {
  const halfX=surface.size[0]/2+0.05;
  const halfZ=surface.size[1]/2+0.05;
  return subjectBox.min.x <= surface.center.x+halfX &&
    subjectBox.max.x >= surface.center.x-halfX &&
    subjectBox.min.z <= surface.center.z+halfZ &&
    subjectBox.max.z >= surface.center.z-halfZ &&
    subjectBox.min.y >= surface.center.y-0.03 &&
    subjectBox.min.y <= surface.center.y+0.12;
};

const intersectsExpanded = (left, right, margin = 0) =>
  left.min.x <= right.max.x + margin && left.max.x >= right.min.x - margin &&
  left.min.y <= right.max.y + margin && left.max.y >= right.min.y - margin &&
  left.min.z <= right.max.z + margin && left.max.z >= right.min.z - margin;

const sameValue = (left, right) => {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => sameValue(value, right[index]));
  }
  const leftKeys = Object.keys(left), rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]));
};

const sameEdges = (left, right) => {
  if (left.size !== right.size) return false;
  for (const [key, edge] of left) {
    const other = right.get(key);
    if (!other) return false;
    if (edge === other) continue;
    if (edge.subject !== other.subject || edge.predicate !== other.predicate || edge.object !== other.object) return false;
    const a = edge.meta || {}, b = other.meta || {};
    const aKeys = Object.keys(a), bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length || aKeys.some((name) => !sameValue(a[name], b[name]))) return false;
  }
  return true;
};

export class SceneGraph {
  constructor({ store, spatial, events = null } = {}) {
    this.store = store;
    this.spatial = spatial;
    this.events = events;
    this.edges = new Map();
    this.nearCenters = new Map();
    this.nearPairs = new Map();
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
  reset() { this.nearCenters.clear(); this.nearPairs.clear(); this.edges.clear(); this.environmentFacts = []; this.dirty = false; this.batchDepth = 0; }


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
    const previous = new Map(this.edges);
    this.clear();
    for (const fact of this.environmentFacts) this.set(fact.subject, fact.predicate, fact.object, fact.meta);
    const records = this.store.list().filter(([, record]) => record.active !== false);
    const spatialSnapshot = snapshot || this.spatial.snapshot();
    const surfaces = new Map();
    const containmentBounds = new Map();
    const relationBounds = new Map();

    // Keep the expensive exact geometry checks out of unrelated pairs. A target
    // can expose surfaces/receptacles outside its visual bounds, so index those
    // world-space regions as well as the object bounds.
    const cellSize = 4;
    const cellKey = (x, y, z) => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)},${Math.floor(z / cellSize)}`;
    const relationGrid = new Map();
    const addRelationBound = (id, box) => {
      if (!box) return;
      const bounds = relationBounds.get(id) || [];
      bounds.push(box);
      relationBounds.set(id, bounds);
      const minX = Math.floor(box.min.x / cellSize), maxX = Math.floor(box.max.x / cellSize);
      const minY = Math.floor(box.min.y / cellSize), maxY = Math.floor(box.max.y / cellSize);
      const minZ = Math.floor(box.min.z / cellSize), maxZ = Math.floor(box.max.z / cellSize);
      for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) for (let z = minZ; z <= maxZ; z++) {
        const key = cellKey(x * cellSize, y * cellSize, z * cellSize);
        let bucket = relationGrid.get(key);
        if (!bucket) relationGrid.set(key, bucket = new Set());
        bucket.add(id);
      }
    };

    for (const [id, record] of records) {
      surfaces.set(id, (record.manifest.surfaces || [])
        .map((surface) => this.spatial.getSupportSurface(id, surface.id, spatialSnapshot))
        .filter(Boolean));
      const receptacles=record.manifest.receptacles||[];
      const zones=receptacles.length
        ? receptacles.map((entry)=>this.spatial.getReceptacle(id,entry.id,spatialSnapshot)?.box)
        : [spatialSnapshot.get(id).box];
      containmentBounds.set(id,zones.filter(Boolean).map((box)=>box.clone().expandByScalar(0.02)));
      addRelationBound(id, spatialSnapshot.get(id).box);
      for (const surface of surfaces.get(id)) {
        addRelationBound(id, new THREE.Box3(
          new THREE.Vector3(surface.center.x - surface.size[0] / 2, surface.center.y - 0.12, surface.center.z - surface.size[1] / 2),
          new THREE.Vector3(surface.center.x + surface.size[0] / 2, surface.center.y + 0.12, surface.center.z + surface.size[1] / 2)
        ));
      }
      for (const box of zones) if (box) addRelationBound(id, box);
    }

    const deriveDirected = (subjectId, subject, targetId, target) => {
      for (const support of surfaces.get(targetId)) {
        if (!mayRestOn(subject.box,support)) continue;
        const status = this.spatial.supportGeometry(subjectId,targetId,{surfaceId:support.id,snapshot:spatialSnapshot});
        if (status.supported) {
          const meta = { surfaceId:support.id, gap:Number(status.gap.toFixed(3)), evidence:'spatial-geometry' };
          this.set(subjectId, 'ON', targetId, meta);
          this.set(targetId, 'SUPPORTS', subjectId, meta);
        }
      }
      if (containmentBounds.get(targetId).some((box)=>box.containsBox(subject.box))) {
        const containment = this.spatial.containmentGeometry(subjectId,targetId,{snapshot:spatialSnapshot});
        if (containment.inside) {
          const meta = { ...(containment.receptacleId ? { receptacleId:containment.receptacleId } : {}), evidence:'spatial-geometry' };
          this.set(subjectId, 'INSIDE', targetId, meta);
          this.set(targetId, 'CONTAINS', subjectId, meta);
        }
      }
    };

    const candidates = new Set();
    const nearDistances = new Map();
    const centers = new Map();
    const moved = new Set();
    for (const [id] of records) {
      const center = spatialSnapshot.get(id).center;
      const previousCenter = this.nearCenters.get(id);
      if (!previousCenter?.equals(center)) moved.add(id);
      centers.set(id, moved.has(id) ? center.clone() : previousCenter);
    }
    for (const [pair, distance] of this.nearPairs) {
      const [left, right] = pair.split('\0');
      if (centers.has(left) && centers.has(right) && !moved.has(left) && !moved.has(right)) {
        nearDistances.set(pair, distance);
      }
    }
    for (const id of moved) {
      const a = spatialSnapshot.get(id);
      const { x, y, z } = a.center;
      const neighbors = new Set();
      for (const dx of [-2, 0, 2]) for (const dy of [-2, 0, 2]) for (const dz of [-2, 0, 2]) {
        const bucket = relationGrid.get(cellKey(x + dx, y + dy, z + dz));
        if (bucket) for (const otherId of bucket) {
          if (!moved.has(otherId) || id < otherId) neighbors.add(otherId);
        }
      }
      for (const otherId of neighbors) {
        const b = spatialSnapshot.get(otherId);
        const distance = a.center.distanceTo(b.center);
        if (distance <= 2) {
          const pair = id < otherId ? `${id}\0${otherId}` : `${otherId}\0${id}`;
          nearDistances.set(pair, distance);
        }
      }
    }
    for (const [pair, distance] of nearDistances) {
      const [left, right] = pair.split('\0');
      const meta = { distance: Number(distance.toFixed(3)) };
      for (const [subject, object] of [[left, right], [right, left]]) {
        const key = this.key(subject, 'NEAR', object);
        const existing = previous.get(key);
        if (existing && sameValue(existing.meta, meta)) this.edges.set(key, existing);
        else this.set(subject, 'NEAR', object, meta);
      }
    }
    for (const [id] of records) {
      const a = spatialSnapshot.get(id);
      const seenTargets = new Set();
      const box = a.box;
      const minX = Math.floor((box.min.x - 0.12) / cellSize), maxX = Math.floor((box.max.x + 0.12) / cellSize);
      const minY = Math.floor((box.min.y - 0.12) / cellSize), maxY = Math.floor((box.max.y + 0.12) / cellSize);
      const minZ = Math.floor((box.min.z - 0.12) / cellSize), maxZ = Math.floor((box.max.z + 0.12) / cellSize);
      for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) for (let z = minZ; z <= maxZ; z++) {
        for (const targetId of relationGrid.get(cellKey(x * cellSize, y * cellSize, z * cellSize)) || []) {
          if (targetId === id || seenTargets.has(targetId)) continue;
          seenTargets.add(targetId);
          if (relationBounds.get(targetId)?.some((bound) => intersectsExpanded(box, bound, 0.12))) {
            const pair = id < targetId ? `${id}\0${targetId}` : `${targetId}\0${id}`;
            candidates.add(pair);
          }
        }
      }
    }
    for (const pair of candidates) {
      const [id, otherId] = pair.split('\0');
      const a = spatialSnapshot.get(id), b = spatialSnapshot.get(otherId);
      deriveDirected(id, a, otherId, b);
      deriveDirected(otherId, b, id, a);
    }

    this.nearCenters = centers;
    this.nearPairs = nearDistances;
    this.dirty = false;
    if (!sameEdges(previous, this.edges)) this.events?.emit('sceneGraph.updated', { edges: this.edges.size });
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
