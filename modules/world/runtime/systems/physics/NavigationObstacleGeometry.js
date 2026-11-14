import * as THREE from 'three';

export const vector3Array = (v) => [v.x, v.y, v.z];
export const isUprightRotation = (q) => {
  const upX = 2 * (q.x * q.y - q.z * q.w);
  const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
  const upZ = 2 * (q.y * q.z + q.x * q.w);
  return upY > 0.999 && Math.abs(upX) < 0.02 && Math.abs(upZ) < 0.02;
};
export const yawFromQuaternion = (q) => Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
export const boxAabbHalfExtents = (half, q) => {
  const xx = 1 - 2 * (q.y * q.y + q.z * q.z), xy = 2 * (q.x * q.y - q.z * q.w), xz = 2 * (q.x * q.z + q.y * q.w);
  const yx = 2 * (q.x * q.y + q.z * q.w), yy = 1 - 2 * (q.x * q.x + q.z * q.z), yz = 2 * (q.y * q.z - q.x * q.w);
  const zx = 2 * (q.x * q.z - q.y * q.w), zy = 2 * (q.y * q.z + q.x * q.w), zz = 1 - 2 * (q.x * q.x + q.y * q.y);
  return [
    Math.abs(xx) * half.x + Math.abs(xy) * half.y + Math.abs(xz) * half.z,
    Math.abs(yx) * half.x + Math.abs(yy) * half.y + Math.abs(yz) * half.z,
    Math.abs(zx) * half.x + Math.abs(zy) * half.y + Math.abs(zz) * half.z
  ];
};
export const cylinderAabbHalfExtents = (radius, halfHeight, q) => {
  const axis = [2 * (q.x * q.y - q.z * q.w), 1 - 2 * (q.x * q.x + q.z * q.z), 2 * (q.y * q.z + q.x * q.w)];
  return axis.map((component) => radius * Math.sqrt(Math.max(0, 1 - component * component)) + halfHeight * Math.abs(component));
};
export const capsuleAabbHalfExtents = (radius, halfHeight, q) => {
  const axis = [2 * (q.x * q.y - q.z * q.w), 1 - 2 * (q.x * q.x + q.z * q.z), 2 * (q.y * q.z + q.x * q.w)];
  return axis.map((component) => radius + halfHeight * Math.abs(component));
};
export const convexHullAabb = (vertices, position, rotation) => {
  const q = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
  const v = new THREE.Vector3();
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < vertices.length; i += 3) {
    v.set(vertices[i], vertices[i + 1], vertices[i + 2]).applyQuaternion(q).add(position);
    min.min(v); max.max(v);
  }
  return { position:min.clone().add(max).multiplyScalar(0.5).toArray(), halfExtents:max.clone().sub(min).multiplyScalar(0.5).toArray() };
};

/** Stateless navigation projection of a live backend collider snapshot. */
export function projectNavigationObstacle({objectId,partName,colliderIndex,shape,position,rotation}) {
  const id=[objectId,partName,colliderIndex].join(':');
  const meta={id,objectId,part:partName,collider:colliderIndex};
  if(shape.kind==='box') {
    const exact=isUprightRotation(rotation);
    return {item:{...meta,shape:'box',sourceShape:'box',quality:exact?'exact-yaw':'conservative-aabb',
      position:vector3Array(position),halfExtents:exact?vector3Array(shape.halfExtents):boxAabbHalfExtents(shape.halfExtents,rotation),
      angle:exact?yawFromQuaternion(rotation):0}};
  }
  if(shape.kind==='cylinder') {
    if(isUprightRotation(rotation)) return {item:{...meta,shape:'cylinder',sourceShape:'cylinder',quality:'exact-upright',
      position:[position.x,position.y-shape.halfHeight,position.z],radius:shape.radius,height:shape.halfHeight*2}};
    return {item:{...meta,shape:'box',sourceShape:'cylinder',quality:'conservative-aabb',
      position:vector3Array(position),halfExtents:cylinderAabbHalfExtents(shape.radius,shape.halfHeight,rotation),angle:0}};
  }
  if(shape.kind==='capsule') {
    const extentY=shape.halfHeight+shape.radius;
    if(isUprightRotation(rotation)) return {item:{...meta,shape:'cylinder',sourceShape:'capsule',quality:'conservative-upright',
      position:[position.x,position.y-extentY,position.z],radius:shape.radius,height:extentY*2}};
    return {item:{...meta,shape:'box',sourceShape:'capsule',quality:'conservative-aabb',
      position:vector3Array(position),halfExtents:capsuleAabbHalfExtents(shape.radius,shape.halfHeight,rotation),angle:0}};
  }
  if(shape.kind==='convexHull' && shape.vertices?.length) {
    const box=convexHullAabb(shape.vertices,new THREE.Vector3(position.x,position.y,position.z),rotation);
    return {item:{...meta,shape:'box',sourceShape:'convexHull',quality:'conservative-aabb',...box,angle:0}};
  }
  return {skipped:{id,objectId,part:partName,collider:colliderIndex,reason:'unsupported-shape',shapeType:shape.kind}};
}
