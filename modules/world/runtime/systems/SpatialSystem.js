import * as THREE from 'three';
import { nativeCarryRecord } from '../interaction/NativePhysicalTarget.js';
import {
  boxesOverlap,
  objectWorldPosition,
  spatialEntryAtRootPosition,
  spatialSnapshotEntry
} from '../spatial/SpatialSnapshot.js';

const roundVec = (vector) => vector.toArray().map((value) => Number(value.toFixed(3)));

export class SpatialSystem {
  constructor({ store, entities=null, physics=null }) {
    this.store = store;
    this.entities=entities;this.physics=physics;
    this.raycaster = new THREE.Raycaster();
  }

  snapshot() {
    const snapshot = new Map();
    for (const [id, record] of this.store.entries()) if (record.active !== false) snapshot.set(id, spatialSnapshotEntry(id, record.object));
    return snapshot;
  }

  nativeRecord(id){return nativeCarryRecord(this.entities,this.physics,id);}
  interactionRecord(id){return this.store.has(id)?this.store.get(id):this.nativeRecord(id);}
  interactionBounds(id){
    if(this.store.has(id))return this.getBounds(id);
    const bounds=this.nativeRecord(id)?this.physics.manipulationBounds(id):null;
    if(!bounds)throw Object.assign(new Error('TARGET_PHYSICS_UNAVAILABLE'),{code:'TARGET_PHYSICS_UNAVAILABLE'});
    return bounds;
  }
  interactionPosition(id){
    return this.nativeRecord(id)?new THREE.Vector3(...this.physics.getPosition(id)):objectWorldPosition(this.store.get(id).object);
  }
  placementSnapshot(subjectId,targetId){
    const snapshot=this.snapshot();
    if(!this.nativeRecord(subjectId)&&!this.nativeRecord(targetId))return snapshot;
    for(const entity of this.entities?.list({source:'native',capability:'physics'})||[]){
      const bounds=this.nativeRecord(entity.id)?this.physics.manipulationBounds(entity.id):null;
      if(!bounds)continue;
      const box=new THREE.Box3(new THREE.Vector3(...bounds.min),new THREE.Vector3(...bounds.max));
      snapshot.set(entity.id,{id:entity.id,bounds,box,center:box.getCenter(new THREE.Vector3()),size:box.getSize(new THREE.Vector3())});
    }
    return snapshot;
  }

  getBounds(id, snapshot = null) {
    return snapshot?.get(id)?.bounds || spatialSnapshotEntry(id, this.store.get(id).object).bounds;
  }

  debugSnapshot({ snapshot = this.snapshot(), overlapMargin = 0.01 } = {}) {
    const bounds = [...snapshot.values()].map((entry) => structuredClone(entry.bounds));
    const overlapPairs = this.overlapPairs({ margin: overlapMargin, snapshot });
    return {
      schemaVersion: 2,
      source: 'spatial',
      bounds,
      overlapPairs,
      metrics: {
        objectCount: bounds.length,
        overlapPairCount: overlapPairs.length,
        overlapMargin
      }
    };
  }

  findNearby(id, radius = 2, snapshot = null) {
    const localSnapshot = snapshot || this.snapshot();
    const source = localSnapshot.get(id);
    if (!source) return [];
    const results = [];
    for (const [otherId, record] of this.store.entries()) {
      if (otherId === id) continue;
      const other = localSnapshot.get(otherId);
      if (!other) continue;
      const distance = source.center.distanceTo(other.center);
      if (distance <= radius) results.push({ id: otherId, asset: record.assetId, distance: Number(distance.toFixed(3)) });
    }
    return results.sort((left, right) => left.distance - right.distance);
  }

  raycast(origin, direction, maxDistance = 100) {
    const rayOrigin = new THREE.Vector3(...origin);
    const rayDirection = new THREE.Vector3(...direction).normalize();
    this.raycaster.set(rayOrigin, rayDirection);
    this.raycaster.far = maxDistance;
    const roots = this.store.list().map(([, record]) => record.object);
    const hits = this.raycaster.intersectObjects(roots, true);
    const results = [];
    const seen = new Set();
    for (const hit of hits) {
      let current = hit.object;
      while (current && !current.userData.instanceId) current = current.parent;
      const id = current?.userData.instanceId ?? null;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      results.push({ id, distance: Number(hit.distance.toFixed(3)), point: roundVec(hit.point) });
    }
    return results;
  }

  overlappingIds(id, { ignore = [], margin = 0.01, snapshot = null } = {}) {
    const localSnapshot = snapshot || this.snapshot();
    const source = localSnapshot.get(id);
    if (!source) return [];
    const ignored = new Set([id, ...ignore]);
    const overlaps = [];
    for (const [otherId] of this.store.entries()) {
      if (ignored.has(otherId)) continue;
      const other = localSnapshot.get(otherId);
      if (other && boxesOverlap(source.box, other.box, margin)) overlaps.push(otherId);
    }
    return overlaps;
  }

  overlapPairs({ margin = 0.01, snapshot = this.snapshot() } = {}) {
    const entries = [...snapshot].map(([id, { box }], index) => ({ id, box, index }));
    const pairs = [];
    const bruteForce = () => {
      for (let left = 0; left < entries.length; left++) {
        for (let right = left + 1; right < entries.length; right++) {
          if (boxesOverlap(entries[left].box, entries[right].box, margin)) pairs.push([entries[left].id, entries[right].id]);
        }
      }
      return pairs;
    };
    // Small scenes do not benefit from sorting. Keep the original predicate for
    // all candidates, including touching/degenerate bounds and nonfinite input.
    if (entries.length < 64) return bruteForce();
    const axes = ['x', 'y', 'z'];
    const ranges = axes.map(axis => {
      let min = Infinity, max = -Infinity;
      for (const { box } of entries) {
        if (!Number.isFinite(box.min[axis]) || !Number.isFinite(box.max[axis])) return NaN;
        min = Math.min(min, box.min[axis]);
        max = Math.max(max, box.min[axis]);
      }
      return max - min;
    });
    if (ranges.some(range => !Number.isFinite(range))) return bruteForce();
    const axis = axes[ranges.indexOf(Math.max(...ranges))];
    // A densely overlapping axis cannot prune enough candidates to offset
    // pair ordering and bucket allocation; use the cheap original path.
    const averageExtent = entries.reduce((sum,{box}) => sum + Math.max(0,box.max[axis]-box.min[axis]),0)/entries.length;
    if (averageExtent >= Math.max(...ranges)/2) return bruteForce();
    const ordered = [...entries].sort((a,b) => a.box.min[axis] - b.box.min[axis] || a.index - b.index);
    const buckets = Array.from({length:entries.length}, () => []);
    for (let left = 0; left < ordered.length; left++) {
      const a = ordered[left];
      for (let right = left + 1; right < ordered.length; right++) {
        const b = ordered[right];
        // The un-inset interval is conservative for the exact overlap test.
        if (b.box.min[axis] > a.box.max[axis]) break;
        if (boxesOverlap(a.box,b.box,margin)) buckets[Math.min(a.index,b.index)].push(Math.max(a.index,b.index));
      }
    }
    // Preserve the snapshot's original pair ordering for deterministic findings.
    for (let left = 0; left < buckets.length; left++) {
      for (const right of buckets[left].sort((a,b) => a-b)) pairs.push([entries[left].id,entries[right].id]);
    }
    return pairs;
  }

  // A root AABB is only a broad-phase candidate. For visual-only groups, disjoint
  // conservative mesh AABBs can disprove it; unsupported geometry stays unknown.
  // Do not use this as proof of contact or to bypass physical-body validation.
  visualOverlapDisproved(id, otherId, cache = new Map()) {
    const meshBounds = key => {
      if (cache.has(key)) return cache.get(key);
      const record = this.store.has(key) ? this.store.get(key) : null;
      const boxes = [];
      let complete = record?.manifest?.capabilityLevel === 'visual';
      if (complete) {
        record.object.updateWorldMatrix(true, true);
        record.object.traverse(node => {
          if (!complete) return;
          if (node.isLine || node.isPoints || node.isSprite) { complete = false; return; }
          if (!node.isMesh) return;
          if (boxes.length >= 256 || node.isInstancedMesh || node.isSkinnedMesh || node.isBatchedMesh || node.geometry?.morphAttributes?.position?.length || !node.geometry?.getAttribute('position')) {
            complete = false; return;
          }
          if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
          const box = node.geometry.boundingBox?.clone().applyMatrix4(node.matrixWorld);
          if (!box || box.isEmpty() || ![...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite)) { complete = false; return; }
          boxes.push(box);
        });
      }
      const result = complete && boxes.length ? boxes : null;
      cache.set(key, result);
      return result;
    };
    const left = meshBounds(id), right = meshBounds(otherId);
    if (!left || !right || left.length * right.length > 16384) return false;
    return !left.some(a => right.some(b => boxesOverlap(a,b)));
  }

  getSupportSurface(targetId, surfaceId, snapshot = null) {
    const native=this.nativeRecord(targetId);
    if(native){
      if(this.physics.manipulationBody(targetId).body!=='fixed')return null;
      const rotation=this.physics.getRotation(targetId),position=this.physics.getPosition(targetId);
      if(!rotation||!position||1-Math.abs(rotation[3])>1e-6)return null;
      const surface=surfaceId?native.manifest.surfaces.find(item=>item.id===surfaceId):native.manifest.surfaces[0];
      return surface?{targetId,id:surface.id,center:new THREE.Vector3(...position).add(new THREE.Vector3(...surface.localPosition)),size:[...surface.size]}:null;
    }
    const record = this.store.get(targetId);
    if (!snapshot?.has(targetId)) record.object.updateWorldMatrix(true, true);
    const surface = surfaceId
      ? record.manifest.surfaces?.find((item) => item.id === surfaceId)
      : record.manifest.surfaces?.[0];
    if (!surface) return null;

    const local = new THREE.Vector3(...surface.localPosition);
    const center = local.clone().applyMatrix4(record.object.matrixWorld);
    const size = surface.size || [1, 1];
    const scaleX = Math.abs(record.object.scale.x || 1);
    const scaleZ = Math.abs(record.object.scale.z || 1);
    return { targetId, id: surface.id, center, size: [size[0] * scaleX, size[1] * scaleZ] };
  }

  getReceptacle(targetId, receptacleId = null, snapshot = null) {
    const record = this.store.get(targetId);
    if (!snapshot?.has(targetId)) record.object.updateWorldMatrix(true, true);
    const definition = receptacleId
      ? record.manifest.receptacles?.find((item) => item.id === receptacleId)
      : record.manifest.receptacles?.[0];
    if (!definition) return null;
    const half = new THREE.Vector3(...definition.size).multiplyScalar(0.5);
    const center = new THREE.Vector3(...definition.localPosition);
    const box = new THREE.Box3(center.clone().sub(half), center.clone().add(half)).applyMatrix4(record.object.matrixWorld);
    return {
      targetId,
      id: definition.id,
      box,
      center: box.getCenter(new THREE.Vector3()),
      size: box.getSize(new THREE.Vector3())
    };
  }

  containmentGeometry(subjectId, targetId, { receptacleId = null, tolerance = 0.02, snapshot = null } = {}) {
    const localSnapshot = snapshot || this.snapshot();
    const subject = localSnapshot.get(subjectId);
    const target = localSnapshot.get(targetId);
    if (!subject) return { inside: false, reason: 'SUBJECT_MISSING', evidence: 'spatial-geometry' };
    if (!target) return { inside: false, reason: 'TARGET_MISSING', evidence: 'spatial-geometry' };
    const record = this.store.get(targetId);
    const receptacles = record.manifest.receptacles || [];
    if (receptacles.length) {
      const candidates = receptacleId ? receptacles.filter((item) => item.id === receptacleId) : receptacles;
      if (!candidates.length) return { inside: false, reason: 'RECEPTACLE_MISSING', receptacleId, evidence: 'spatial-geometry' };
      for (const definition of candidates) {
        const receptacle = this.getReceptacle(targetId, definition.id, localSnapshot);
        const box = receptacle.box.clone().expandByScalar(tolerance);
        if (box.containsBox(subject.box)) return {
          inside: true,
          subjectId,
          targetId,
          receptacleId: definition.id,
          mode: 'receptacle',
          tolerance,
          evidence: 'spatial-geometry'
        };
      }
      return { inside: false, reason: 'OUTSIDE_RECEPTACLE', subjectId, targetId, receptacleId, tolerance, evidence: 'spatial-geometry' };
    }
    const box = target.box.clone().expandByScalar(tolerance);
    const inside = box.containsBox(subject.box);
    return {
      inside,
      subjectId,
      targetId,
      receptacleId: null,
      mode: 'bounds',
      tolerance,
      evidence: 'spatial-geometry',
      ...(inside ? {} : { reason: 'OUTSIDE_TARGET_BOUNDS' })
    };
  }

  findFreeSpaceInside(objectId, targetId, { receptacleId = null, clearance = 0.03, grid = 3, ignore = [], poseClear = null } = {}) {
    const objectRecord = this.store.get(objectId);
    const snapshot = this.snapshot();
    const receptacle = this.getReceptacle(targetId, receptacleId, snapshot);
    if (!receptacle) return null;
    const entry = snapshot.get(objectId);
    const currentRoot = objectWorldPosition(objectRecord.object);
    const { box: bounds, size } = entry;
    if (size.x + clearance * 2 > receptacle.size.x || size.y + clearance * 2 > receptacle.size.y || size.z + clearance * 2 > receptacle.size.z) return null;
    const rootToCenterX = currentRoot.x - entry.center.x;
    const rootToCenterZ = currentRoot.z - entry.center.z;
    const rootToBottomY = currentRoot.y - bounds.min.y;
    const halfX = size.x / 2 + clearance;
    const halfZ = size.z / 2 + clearance;
    const usableX = Math.max(0, receptacle.size.x / 2 - halfX);
    const usableZ = Math.max(0, receptacle.size.z / 2 - halfZ);
    const candidates = [];
    for (let x = 0; x < grid; x++) {
      for (let z = 0; z < grid; z++) {
        const nx = grid === 1 ? 0 : (x / (grid - 1)) * 2 - 1;
        const nz = grid === 1 ? 0 : (z / (grid - 1)) * 2 - 1;
        candidates.push(new THREE.Vector3(
          receptacle.center.x + nx * usableX + rootToCenterX,
          receptacle.box.min.y + clearance + rootToBottomY,
          receptacle.center.z + nz * usableZ + rootToCenterZ
        ));
      }
    }
    candidates.sort((left, right) => left.distanceToSquared(receptacle.center) - right.distanceToSquared(receptacle.center));
    for (const candidate of candidates) {
      const candidateSnapshot = new Map(snapshot);
      candidateSnapshot.set(objectId, spatialEntryAtRootPosition(entry, currentRoot, candidate));
      const containment = this.containmentGeometry(objectId, targetId, { receptacleId: receptacle.id, tolerance: 0, snapshot: candidateSnapshot });
      const overlaps = this.overlappingIds(objectId, { ignore: [targetId, ...ignore], margin: clearance / 2, snapshot: candidateSnapshot });
      const physics = poseClear ? poseClear(candidate.toArray()) : { checked: true, clear: true };
      if (containment.inside && !overlaps.length && physics?.checked && physics.clear) return candidate;
    }
    return null;
  }

  supportGeometry(subjectId, targetId, { surfaceId = null, tolerance = 0.12, snapshot = null } = {}) {
    const localSnapshot = snapshot || this.placementSnapshot(subjectId,targetId);
    const subject = localSnapshot.get(subjectId);
    if (!subject) return { supported: false, reason: 'SUBJECT_MISSING', evidence: 'spatial-geometry' };
    const surface = this.getSupportSurface(targetId, surfaceId, localSnapshot);
    if (!surface) return { supported: false, reason: 'SURFACE_MISSING', evidence: 'spatial-geometry' };
    const withinX = subject.box.min.x >= surface.center.x - surface.size[0] / 2 - 0.05 && subject.box.max.x <= surface.center.x + surface.size[0] / 2 + 0.05;
    const withinZ = subject.box.min.z >= surface.center.z - surface.size[1] / 2 - 0.05 && subject.box.max.z <= surface.center.z + surface.size[1] / 2 + 0.05;
    const verticalGap = subject.box.min.y - surface.center.y;
    const gap = Math.abs(verticalGap);
    const aboveSurface = verticalGap >= -0.03;
    return {
      supported: withinX && withinZ && aboveSurface && gap <= tolerance,
      subjectId,
      targetId,
      surfaceId: surface.id,
      withinX,
      withinZ,
      aboveSurface,
      verticalGap: Number(verticalGap.toFixed(4)),
      gap: Number(gap.toFixed(4)),
      tolerance,
      evidence: 'spatial-geometry'
    };
  }

  findFreeSpace(objectId, targetId, { surfaceId, clearance = 0.03, grid = 5, ignore = [] } = {}) {
    const native=Boolean(this.nativeRecord(objectId)||this.nativeRecord(targetId));
    const snapshot = this.placementSnapshot(objectId,targetId);
    const surface = this.getSupportSurface(targetId, surfaceId, snapshot);
    if (!surface) return null;

    const entry = snapshot.get(objectId);
    if(!entry)return null;
    const currentRoot = this.interactionPosition(objectId);
    const { box: bounds, size } = entry;
    const halfX = size.x / 2 + clearance;
    const halfZ = size.z / 2 + clearance;
    if (surface.size[0] < halfX * 2 || surface.size[1] < halfZ * 2) return null;
    const usableX = Math.max(0, surface.size[0] / 2 - halfX);
    const usableZ = Math.max(0, surface.size[1] / 2 - halfZ);
    const rootToCenterX = currentRoot.x - entry.center.x;
    const rootToCenterZ = currentRoot.z - entry.center.z;
    const rootToBottomY = currentRoot.y - bounds.min.y;
    const candidates = [];

    for (let x = 0; x < grid; x++) {
      for (let z = 0; z < grid; z++) {
        const nx = grid === 1 ? 0 : (x / (grid - 1)) * 2 - 1;
        const nz = grid === 1 ? 0 : (z / (grid - 1)) * 2 - 1;
        candidates.push(new THREE.Vector3(
          surface.center.x + nx * usableX + rootToCenterX,
          surface.center.y + clearance + rootToBottomY,
          surface.center.z + nz * usableZ + rootToCenterZ
        ));
      }
    }

    candidates.sort((left, right) => left.distanceToSquared(surface.center) - right.distanceToSquared(surface.center));
    for (const candidate of candidates) {
      const candidateSnapshot = new Map(snapshot);
      candidateSnapshot.set(objectId, spatialEntryAtRootPosition(entry, currentRoot, candidate));
      const overlaps = this.overlappingIds(objectId, { ignore: [targetId, ...ignore], margin: clearance / 2, snapshot: candidateSnapshot });
      if (native&&!this.physics.checkBodyPose(objectId,candidate.toArray(),this.physics.getRotation(objectId),{excludeIds:ignore}).clear)continue;
      if (!overlaps.length) return candidate;
    }
    return null;
  }
}
