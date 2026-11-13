import { assetAdmission } from '../../../asset/model/admission.js';

// Kinematic-anchor carrying is not force-verified grasping. These conservative
// defaults describe the existing single-anchor humanoid, not every robot.
export const DEFAULT_CARRY_LIMITS = Object.freeze({ mass: 15, span: 1.25, colliderCount: 16 });
const shapes = new Set(['box', 'cylinder', 'capsule']);
const deny = reason => ({ eligible: false, reason, mode: 'kinematic-anchor', graspVerified: false });
const positive = n => Number.isFinite(n) && n > 0;

function colliderExtents(collider) {
  if (collider.shape === 'box' && collider.halfExtents?.length === 3
    && collider.halfExtents.every(positive)) return collider.halfExtents;
  if (collider.shape === 'cylinder' && positive(collider.radius) && positive(collider.halfHeight))
    return [collider.radius, collider.halfHeight, collider.radius];
  if (collider.shape === 'capsule' && positive(collider.radius) && positive(collider.halfHeight))
    return [collider.radius, collider.halfHeight + collider.radius, collider.radius];
  return null;
}

/** Physical eligibility only; reach, occupied hands, and motion sweeps are live checks. */
export function inferCarryCapability(manifest, { scale = 1, limits = DEFAULT_CARRY_LIMITS, allowProvisional = false } = {}) {
  const physics = manifest?.physics;
  if (physics?.carryable === false) return deny('CARRY_DISABLED');
  if (manifest?.capabilityLevel === 'visual') return deny('TARGET_PHYSICS_UNAVAILABLE');
  if (physics?.body !== 'dynamic') return deny('TARGET_NOT_DYNAMIC');
  if (physics.sensor === true) return deny('CARRY_SENSOR_UNSUPPORTED');
  if (physics.lockTranslation?.some(Boolean)) return deny('CARRY_TRANSLATION_LOCKED');
  if (Object.keys(manifest.parts || {}).length) return deny('ARTICULATED_TARGET_UNSUPPORTED');
  if (!positive(physics.mass)) return deny('CARRY_MASS_UNDECLARED');
  if (!positive(scale)) return deny('CARRY_SCALE_INVALID');
  if (physics.mass * scale ** 3 > limits.mass) return deny('CARRY_MASS_EXCEEDED');
  const colliders = physics.colliders || [];
  if (!colliders.length || colliders.length > limits.colliderCount || colliders.some(c => !shapes.has(c.shape)))
    return deny('CARRY_COLLIDER_UNSUPPORTED');
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  for (const collider of colliders) {
    const extents = colliderExtents(collider);
    if (!extents) return deny('CARRY_COLLIDER_UNSUPPORTED');
    const rotation = collider.rotation || [0, 0, 0, 1];
    if (!Array.isArray(rotation) || rotation.length !== 4 || !rotation.every(Number.isFinite)
      || Math.abs(rotation[0]) > 1e-6 || Math.abs(rotation[2]) > 1e-6)
      return deny('CARRY_COLLIDER_ROTATION_UNSUPPORTED');
    const t = collider.translation || [0, 0, 0];
    if (t.length !== 3 || !t.every(Number.isFinite)) return deny('CARRY_COLLIDER_UNSUPPORTED');
    // A yaw-rotated collider is bounded conservatively by its horizontal radius.
    const horizontal = Math.hypot(extents[0], extents[2]);
    for (let axis = 0; axis < 3; axis++) {
      const extent = axis === 1 ? extents[1] : horizontal;
      low[axis] = Math.min(low[axis], (t[axis] - extent) * scale);
      high[axis] = Math.max(high[axis], (t[axis] + extent) * scale);
    }
  }
  const span = high.map((value, axis) => value - low[axis]);
  if (span.some(value => value > limits.span)) return deny('CARRY_SIZE_EXCEEDED');
  if (manifest.source?.kind === 'compiled') {
    const admission = assetAdmission(manifest);
    const approvedEditing = allowProvisional && admission.status === 'provisional'
      && manifest.provenance?.authoringIntent?.usage === 'movable';
    if (admission.status !== 'ready' && !approvedEditing) return deny('CARRY_ASSET_UNVERIFIED');
  }
  return { eligible: true, reason: null, source: 'physical-geometry', mode: 'kinematic-anchor',
    graspVerified: false, mass: physics.mass, span: span.map(value => Number(value.toFixed(4))) };
}

export const isCarryOperation = action => ['pickup', 'drop', 'place'].includes(action);
