import * as THREE from 'three';

const roundVec = (v) => v.toArray().map((n) => Number(n.toFixed(3)));

export class SpatialSystem {
  constructor({ store, scene }) {
    this.store = store;
    this.scene = scene;
    this.raycaster = new THREE.Raycaster();
  }

  getBounds(id) {
    const record = this.store.get(id);
    record.object.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(record.object);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    return {
      id,
      min: roundVec(box.min),
      max: roundVec(box.max),
      center: roundVec(center),
      size: roundVec(size)
    };
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

  isColliding(id, { ignore = [], margin = 0.01 } = {}) {
    const a = new THREE.Box3().setFromObject(this.store.get(id).object).expandByScalar(-margin);
    if (a.isEmpty()) return [];
    const ignored = new Set([id, ...ignore]);
    const collisions = [];
    for (const [otherId, record] of this.store.entries()) {
      if (ignored.has(otherId)) continue;
      const b = new THREE.Box3().setFromObject(record.object).expandByScalar(-margin);
      if (!b.isEmpty() && a.intersectsBox(b)) collisions.push(otherId);
    }
    return collisions;
  }

  getSupportSurface(targetId, surfaceId) {
    const record = this.store.get(targetId);
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

  findFreeSpace(objectId, targetId, { surfaceId, clearance = 0.03, grid = 5 } = {}) {
    const objectRecord = this.store.get(objectId);
    const targetRecord = this.store.get(targetId);
    const surface = this.getSupportSurface(targetId, surfaceId);
    if (!surface) return null;

    const originalPosition = objectRecord.object.position.clone();
    const bounds = new THREE.Box3().setFromObject(objectRecord.object);
    const size = new THREE.Vector3();
    bounds.getSize(size);
    const halfX = size.x / 2 + clearance;
    const halfZ = size.z / 2 + clearance;
    const usableX = Math.max(0, surface.size[0] / 2 - halfX);
    const usableZ = Math.max(0, surface.size[1] / 2 - halfZ);
    const candidates = [];

    for (let ix = 0; ix < grid; ix++) {
      for (let iz = 0; iz < grid; iz++) {
        const nx = grid === 1 ? 0 : (ix / (grid - 1)) * 2 - 1;
        const nz = grid === 1 ? 0 : (iz / (grid - 1)) * 2 - 1;
        candidates.push(new THREE.Vector3(
          surface.center.x + nx * usableX,
          surface.center.y + size.y / 2 + clearance,
          surface.center.z + nz * usableZ
        ));
      }
    }

    candidates.sort((a, b) => a.distanceToSquared(surface.center) - b.distanceToSquared(surface.center));
    for (const candidate of candidates) {
      objectRecord.object.position.copy(candidate);
      objectRecord.object.updateWorldMatrix(true, true);
      const collisions = this.isColliding(objectId, { ignore: [targetId], margin: clearance / 2 });
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
