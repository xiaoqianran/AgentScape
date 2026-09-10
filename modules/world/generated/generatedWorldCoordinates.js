import * as THREE from 'three';

const SUPPORTED_GENERATED_WORLD_COORDINATES = new Set(['y-up', 'z-up']);

export function validateGeneratedWorldCoordinates(coordinateSystem = 'y-up', metersPerUnit = 1) {
  if (!SUPPORTED_GENERATED_WORLD_COORDINATES.has(coordinateSystem)) {
    throw new TypeError('coordinateSystem must be y-up or z-up');
  }
  if (!Number.isFinite(metersPerUnit) || metersPerUnit <= 0) {
    throw new TypeError('metersPerUnit must be a positive finite number');
  }
  return { coordinateSystem, metersPerUnit };
}

export function generatedWorldTransformMatrix(coordinateSystem = 'y-up', metersPerUnit = 1) {
  validateGeneratedWorldCoordinates(coordinateSystem, metersPerUnit);
  const matrix = new THREE.Matrix4();
  if (coordinateSystem === 'z-up') matrix.makeRotationX(-Math.PI / 2);
  if (metersPerUnit !== 1) matrix.premultiply(new THREE.Matrix4().makeScale(metersPerUnit, metersPerUnit, metersPerUnit));
  return matrix;
}

export function applyGeneratedWorldGeometryTransform(geometry, coordinateSystem = 'y-up', metersPerUnit = 1) {
  if (!geometry?.applyMatrix4) throw new TypeError('Generated world geometry must support applyMatrix4');
  geometry.applyMatrix4(generatedWorldTransformMatrix(coordinateSystem, metersPerUnit));
  return geometry;
}

export function applyGeneratedWorldObjectTransform(object, coordinateSystem = 'y-up', metersPerUnit = 1) {
  if (!object?.applyMatrix4) throw new TypeError('Generated world visual must be an Object3D');
  object.applyMatrix4(generatedWorldTransformMatrix(coordinateSystem, metersPerUnit));
  object.updateMatrixWorld?.(true);
  return object;
}
export function transformGeneratedWorldPoint(point, coordinateSystem = 'y-up', metersPerUnit = 1) {
  if (!Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite)) {
    throw new TypeError('Generated world point must contain 3 finite numbers');
  }
  return new THREE.Vector3(...point).applyMatrix4(generatedWorldTransformMatrix(coordinateSystem, metersPerUnit)).toArray();
}

export function transformGeneratedWorldBounds(bounds, coordinateSystem = 'y-up', metersPerUnit = 1) {
  if (!bounds || !Array.isArray(bounds.min) || !Array.isArray(bounds.max) || bounds.min.length !== 3 || bounds.max.length !== 3
    || !bounds.min.every(Number.isFinite) || !bounds.max.every(Number.isFinite)) {
    throw new TypeError('Generated world bounds require finite min/max vec3 values');
  }
  const box = new THREE.Box3(new THREE.Vector3(...bounds.min), new THREE.Vector3(...bounds.max));
  box.applyMatrix4(generatedWorldTransformMatrix(coordinateSystem, metersPerUnit));
  return { min:box.min.toArray(), max:box.max.toArray() };
}
