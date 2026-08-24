import * as THREE from 'three';

const roundVec = (v) => v.toArray().map((n) => Number(n.toFixed(3)));

const objectBox = (object) => new THREE.Box3().setFromObject(object);

const snapshotEntry = (id, object) => {
  const box = objectBox(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  return {
    box,
    center,
    size,
    bounds: { id, min: roundVec(box.min), max: roundVec(box.max), center: roundVec(center), size: roundVec(size) }
  };
};

const intersectsWithMargin = (a, b, margin) => {
  const aminX = a.min.x + margin, aminY = a.min.y + margin, aminZ = a.min.z + margin;
  const amaxX = a.max.x - margin, amaxY = a.max.y - margin, amaxZ = a.max.z - margin;
  const bminX = b.min.x + margin, bminY = b.min.y + margin, bminZ = b.min.z + margin;
  const bmaxX = b.max.x - margin, bmaxY = b.max.y - margin, bmaxZ = b.max.z - margin;
  if (aminX > amaxX || aminY > amaxY || aminZ > amaxZ || bminX > bmaxX || bminY > bmaxY || bminZ > bmaxZ) return false;
  return aminX <= bmaxX && amaxX >= bminX && aminY <= bmaxY && amaxY >= bminY && aminZ <= bmaxZ && amaxZ >= bminZ;
};

export class SpatialSystem {
  constructor({ store, scene }) {
    this.store = store;
    this.scene = scene;
    this.raycaster = new THREE.Raycaster();
  }

  snapshot() {
    const snapshot = new Map();
    for (const [id, record] of this.store.entries()) snapshot.set(id, snapshotEntry(id, record.object));
    return snapshot;
  }

  getBounds(id, snapshot = null) {
    return snapshot?.get(id)?.bounds || snapshotEntry(id, this.store.get(id).object).bounds;
  }

  findNearby(id, radius = 2) {
    const source = this.store.get(id);
    const sourcePosition = new THREE.Vector3();
    source.object.getWorldPosition(sourcePosition);
    const results = [];
    for (const [otherId, record] of this.store.entries()) {
      if (otherId === id) continue;
      const p = new THREE.Vector3();
      record.object.getWorldPosition(p);
      const distance = sourcePosition.distanceTo(p);
      if (distance <= radius) results.push({ id: otherId, asset: record.assetId, distance: Number(distance.toFixed(3)) });
    }
    return results.sort((a, b) => a.distance - b.distance);
  }

  raycast(origin, direction, maxDistance = 100) {
    const o = new THREE.Vector3(...origin);
    const d = new THREE.Vector3(...direction).normalize();
    this.raycaster.set(o, d);
    this.raycaster.far = maxDistance;
    const roots = this.store.list().map(([, r]) => r.object);
    const hits = this.raycaster.intersectObjects(roots, true);
    return hits.map((hit) => {
      let current = hit.object;
      while (current && !current.userData.instanceId) current = current.parent;
      return {
        id: current?.userData.instanceId ?? null,
        distance: Number(hit.distance.toFixed(3)),
        point: roundVec(hit.point)
      };
    }).filter((hit) => hit.id);
  }

  isColliding(id, { ignore = [], margin = 0.01, snapshot = null } = {}) {
    const a = snapshot?.get(id)?.box || objectBox(this.store.get(id).object);
    const ignored = new Set([id, ...ignore]);
    const collisions = [];
    for (const [otherId, record] of this.store.entries()) {
      if (ignored.has(otherId)) continue;
      const b = snapshot?.get(otherId)?.box || objectBox(record.object);
      if (intersectsWithMargin(a, b, margin)) collisions.push(otherId);
    }
    return collisions;
  }

  collisionPairs({ margin = 0.01, snapshot = this.snapshot() } = {}) {
    const ids = [...snapshot.keys()];
    const pairs = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (intersectsWithMargin(snapshot.get(ids[i]).box, snapshot.get(ids[j]).box, margin)) pairs.push([ids[i], ids[j]]);
      }
    }
    return pairs;
  }

  getSupportSurface(targetId, surfaceId, snapshot = null) {
    const record = this.store.get(targetId);
    if (!snapshot?.has(targetId)) record.object.updateWorldMatrix(true, true);
    const surface = surfaceId
      ? record.manifest.surfaces?.find((s) => s.id === surfaceId)
      : record.manifest.surfaces?.[0];
    if (!surface) return null;

    const local = new THREE.Vector3(...surface.localPosition);
    const center = local.clone().applyMatrix4(record.object.matrixWorld);
    const size = surface.size || [1, 1];
    const sx = Math.abs(record.object.scale.x || 1);
    const sz = Math.abs(record.object.scale.z || 1);
    return {
      targetId,
      id: surface.id,
      center,
      size: [size[0] * sx, size[1] * sz]
    };
  }

  supportStatus(subjectId, targetId, { surfaceId = null, tolerance = 0.12, snapshot = null } = {}) {
    const localSnapshot = snapshot || this.snapshot();
    const subject = localSnapshot.get(subjectId);
    if (!subject) return { on:false, reason:'SUBJECT_MISSING' };
    const surface = this.getSupportSurface(targetId, surfaceId, localSnapshot);
    if (!surface) return { on:false, reason:'SURFACE_MISSING' };
    const withinX = subject.box.min.x >= surface.center.x - surface.size[0] / 2 - 0.05 && subject.box.max.x <= surface.center.x + surface.size[0] / 2 + 0.05;
    const withinZ = subject.box.min.z >= surface.center.z - surface.size[1] / 2 - 0.05 && subject.box.max.z <= surface.center.z + surface.size[1] / 2 + 0.05;
    const verticalGap = subject.box.min.y - surface.center.y;
    const gap = Math.abs(verticalGap);
    // A surface relation is directional: an object resting below the declared
    // surface is not ON it, even when the absolute gap is small.
    const aboveSurface = verticalGap >= -0.03;
    return {
      on:withinX && withinZ && aboveSurface && gap <= tolerance,
      subjectId,targetId,surfaceId:surface.id,
      withinX,withinZ,aboveSurface,verticalGap:Number(verticalGap.toFixed(4)),gap:Number(gap.toFixed(4)),tolerance
    };
  }

  findFreeSpace(objectId, targetId, { surfaceId, clearance = 0.03, grid = 5, ignore = [] } = {}) {
    const objectRecord = this.store.get(objectId);
    const spatialSnapshot = this.snapshot();
    const surface = this.getSupportSurface(targetId, surfaceId, spatialSnapshot);
    if (!surface) return null;

    const originalPosition = objectRecord.object.position.clone();
    const entry = spatialSnapshot.get(objectId);
    const bounds = entry.box;
    const size = entry.size;
    const halfX = size.x / 2 + clearance;
    const halfZ = size.z / 2 + clearance;
    if (surface.size[0] < halfX * 2 || surface.size[1] < halfZ * 2) return null;
    const usableX = Math.max(0, surface.size[0] / 2 - halfX);
    const usableZ = Math.max(0, surface.size[1] / 2 - halfZ);
    const center = entry.center;
    const originToCenterX = originalPosition.x - center.x;
    const originToCenterZ = originalPosition.z - center.z;
    const originToBottomY = originalPosition.y - bounds.min.y;
    const candidates = [];

    for (let ix = 0; ix < grid; ix++) {
      for (let iz = 0; iz < grid; iz++) {
        const nx = grid === 1 ? 0 : (ix / (grid - 1)) * 2 - 1;
        const nz = grid === 1 ? 0 : (iz / (grid - 1)) * 2 - 1;
        candidates.push(new THREE.Vector3(
          surface.center.x + nx * usableX + originToCenterX,
          surface.center.y + clearance + originToBottomY,
          surface.center.z + nz * usableZ + originToCenterZ
        ));
      }
    }

    candidates.sort((a, b) => a.distanceToSquared(surface.center) - b.distanceToSquared(surface.center));
    for (const candidate of candidates) {
      objectRecord.object.position.copy(candidate);
      spatialSnapshot.set(objectId, snapshotEntry(objectId, objectRecord.object));
      const collisions = this.isColliding(objectId, { ignore: [targetId, ...ignore], margin: clearance / 2, snapshot: spatialSnapshot });
      if (!collisions.length) {
        objectRecord.object.position.copy(originalPosition);
        objectRecord.object.updateWorldMatrix(true, true);
        return candidate;
      }
    }

    objectRecord.object.position.copy(originalPosition);
    objectRecord.object.updateWorldMatrix(true, true);
    return null;
  }
}
