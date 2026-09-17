import * as THREE from 'three';
import {
  boxesOverlap,
  objectWorldPosition,
  spatialEntryAtRootPosition,
  spatialSnapshotEntry
} from '../spatial/SpatialSnapshot.js';

const roundVec = (vector) => vector.toArray().map((value) => Number(value.toFixed(3)));

export class SpatialSystem {
  constructor({ store }) {
    this.store = store;
    this.raycaster = new THREE.Raycaster();
  }

  snapshot() {
    const snapshot = new Map();
    for (const [id, record] of this.store.entries()) snapshot.set(id, spatialSnapshotEntry(id, record.object));
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
    const ids = [...snapshot.keys()];
    const pairs = [];
    for (let left = 0; left < ids.length; left++) {
      for (let right = left + 1; right < ids.length; right++) {
        if (boxesOverlap(snapshot.get(ids[left]).box, snapshot.get(ids[right]).box, margin)) pairs.push([ids[left], ids[right]]);
      }
    }
    return pairs;
  }

  getSupportSurface(targetId, surfaceId, snapshot = null) {
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
    const localSnapshot = snapshot || this.snapshot();
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
    const objectRecord = this.store.get(objectId);
    const snapshot = this.snapshot();
    const surface = this.getSupportSurface(targetId, surfaceId, snapshot);
    if (!surface) return null;

    const entry = snapshot.get(objectId);
    const currentRoot = objectWorldPosition(objectRecord.object);
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
      if (!overlaps.length) return candidate;
    }
    return null;
  }
}
