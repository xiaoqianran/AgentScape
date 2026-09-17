import * as THREE from 'three';

const rounded = (vector) => vector.toArray().map((value) => Number(value.toFixed(3)));

export function spatialSnapshotEntry(id, object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  return {
    id,
    box,
    center,
    size,
    bounds: { id, min: rounded(box.min), max: rounded(box.max), center: rounded(center), size: rounded(size) }
  };
}

export function objectWorldPosition(object) {
  return object.getWorldPosition(new THREE.Vector3());
}

export function translateSpatialEntry(entry, delta) {
  const offset = delta?.isVector3 ? delta : new THREE.Vector3(...delta);
  const box = entry.box.clone().translate(offset);
  const center = entry.center.clone().add(offset);
  const size = entry.size.clone();
  return {
    id: entry.id,
    box,
    center,
    size,
    bounds: {
      id: entry.id,
      min: rounded(box.min),
      max: rounded(box.max),
      center: rounded(center),
      size: rounded(size)
    }
  };
}

export function spatialEntryAtRootPosition(entry, currentRootPosition, candidateRootPosition) {
  const current = currentRootPosition?.isVector3 ? currentRootPosition : new THREE.Vector3(...currentRootPosition);
  const candidate = candidateRootPosition?.isVector3 ? candidateRootPosition : new THREE.Vector3(...candidateRootPosition);
  return translateSpatialEntry(entry, candidate.clone().sub(current));
}

export function boxesOverlap(left, right, margin = 0) {
  const inset = Math.max(0, Number.isFinite(margin) ? margin : 0);
  const aminX = left.min.x + inset, aminY = left.min.y + inset, aminZ = left.min.z + inset;
  const amaxX = left.max.x - inset, amaxY = left.max.y - inset, amaxZ = left.max.z - inset;
  const bminX = right.min.x + inset, bminY = right.min.y + inset, bminZ = right.min.z + inset;
  const bmaxX = right.max.x - inset, bmaxY = right.max.y - inset, bmaxZ = right.max.z - inset;
  if (aminX > amaxX || aminY > amaxY || aminZ > amaxZ || bminX > bmaxX || bminY > bmaxY || bminZ > bmaxZ) return false;
  return aminX <= bmaxX && amaxX >= bminX && aminY <= bmaxY && amaxY >= bminY && aminZ <= bmaxZ && amaxZ >= bminZ;
}
