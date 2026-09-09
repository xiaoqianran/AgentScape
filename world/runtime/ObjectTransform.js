const SCALE_EPSILON = 1e-6;
export const MIN_UNIFORM_SCALE = 0.05;
export const MAX_UNIFORM_SCALE = 20;

const scaled = (values, factor) => Array.isArray(values) ? values.map((value) => value * factor) : values;

export function uniformScaleValue(value, fallback = 1) {
  const values = typeof value === 'number' ? [value, value, value] : value;
  if (!Array.isArray(values) || values.length !== 3 || !values.every(Number.isFinite)) {
    const error = new TypeError('Object scale must be a finite uniform number or vec3');
    error.code = 'OBJECT_SCALE_INVALID';
    throw error;
  }
  const [x, y, z] = values;
  if (Math.max(Math.abs(x - y), Math.abs(x - z), Math.abs(y - z)) > SCALE_EPSILON) {
    const error = new Error('AgentScape currently supports uniform object scaling only');
    error.code = 'OBJECT_SCALE_NON_UNIFORM_UNSUPPORTED';
    throw error;
  }
  const scale = (x + y + z) / 3;
  if (!Number.isFinite(scale) || scale < MIN_UNIFORM_SCALE || scale > MAX_UNIFORM_SCALE) {
    const error = new RangeError(`Object scale must be within ${MIN_UNIFORM_SCALE}..${MAX_UNIFORM_SCALE}`);
    error.code = 'OBJECT_SCALE_OUT_OF_RANGE';
    throw error;
  }
  return Number.isFinite(scale) ? scale : fallback;
}

function scaleCollider(collider, factor) {
  const result = structuredClone(collider);
  if (Array.isArray(result.translation)) result.translation = scaled(result.translation, factor);
  if (result.shape === 'box' && Array.isArray(result.halfExtents)) result.halfExtents = scaled(result.halfExtents, factor);
  if (['cylinder', 'capsule'].includes(result.shape)) {
    if (Number.isFinite(result.radius)) result.radius *= factor;
    if (Number.isFinite(result.halfHeight)) result.halfHeight *= factor;
  }
  if (result.shape === 'convexHull' && Array.isArray(result.vertices)) result.vertices = scaled(result.vertices, factor);
  return result;
}

export function physicsManifestForUniformScale(manifest, scaleValue) {
  const factor = uniformScaleValue(scaleValue);
  const result = structuredClone(manifest);
  if (Math.abs(factor - 1) <= SCALE_EPSILON) return result;

  const articulatedParts = Object.values(result.parts || {}).filter((part) => part?.joint || part?.physics?.colliders?.length);
  if (articulatedParts.length) {
    const error = new Error(`Uniform scale is not yet supported for articulated asset: ${result.id || 'unknown'}`);
    error.code = 'OBJECT_SCALE_ARTICULATED_UNSUPPORTED';
    throw error;
  }

  if (result.physics) {
    result.physics.colliders = (result.physics.colliders || []).map((collider) => scaleCollider(collider, factor));
    if (Number.isFinite(result.physics.mass)) result.physics.mass *= factor ** 3;
  }
  return result;
}

export function scalesEqual(a, b) {
  return Math.abs(Number(a) - Number(b)) <= SCALE_EPSILON;
}
