import { Errors } from '../core/errors.js';

const BODY_TYPES = new Set(['fixed', 'dynamic', 'kinematic']);
const SHAPES = new Set(['box', 'cylinder', 'convexHull']);
const ARTICULATION_ACTIONS = new Set(['open', 'close']);

function validatePhysics(physics, context) {
  if (!physics) return;
  if (physics.body && !BODY_TYPES.has(physics.body)) throw Errors.invalidManifest(`Unsupported physics body: ${physics.body}`, context);
  for (const collider of physics.colliders || []) {
    if (!SHAPES.has(collider.shape)) throw Errors.invalidManifest(`Unsupported collider shape: ${collider.shape}`, context);
    if (collider.shape === 'box' && (collider.halfExtents?.length !== 3 || !collider.halfExtents.every((v) => Number.isFinite(v) && v > 0))) throw Errors.invalidManifest('Box collider requires positive finite halfExtents[3]', context);
    if (collider.shape === 'cylinder' && (!Number.isFinite(collider.halfHeight) || collider.halfHeight <= 0 || !Number.isFinite(collider.radius) || collider.radius <= 0)) throw Errors.invalidManifest('Cylinder collider requires positive finite halfHeight and radius', context);
    if (collider.shape === 'convexHull' && (!Array.isArray(collider.vertices) || collider.vertices.length < 12 || collider.vertices.length % 3 !== 0 || !collider.vertices.every(Number.isFinite))) throw Errors.invalidManifest('Convex hull collider requires finite flat vertices[] with at least 4 points', context);
  }
}

export function validateAssetManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw Errors.invalidManifest('Manifest must be an object');
  if (!manifest.id || typeof manifest.id !== 'string') throw Errors.invalidManifest('Manifest requires string id');
  if (!manifest.type || typeof manifest.type !== 'string') throw Errors.invalidManifest('Manifest requires string type', { id: manifest.id });
  if (!Array.isArray(manifest.actions)) throw Errors.invalidManifest('Manifest actions must be an array', { id: manifest.id });
  if (new Set(manifest.actions).size !== manifest.actions.length) throw Errors.invalidManifest('Manifest actions must be unique', { id: manifest.id });
  if (!['builtin', 'glb', 'compiled'].includes(manifest.source?.kind)) throw Errors.invalidManifest('Manifest source.kind must be builtin, glb or compiled', { id: manifest.id });
  if (manifest.source.kind === 'glb' && !manifest.source.url) throw Errors.invalidManifest('GLB source requires url', { id: manifest.id });
  if (manifest.source.kind === 'compiled' && !manifest.source.key) throw Errors.invalidManifest('Compiled source requires key', { id: manifest.id });
  validatePhysics(manifest.physics, { id: manifest.id });
  for (const [name, part] of Object.entries(manifest.parts || {})) {
    const context = { id: manifest.id, part: name };
    if (!part.node) throw Errors.invalidManifest(`Part ${name} requires node`, context);
    if (part.actions && (!Array.isArray(part.actions) || new Set(part.actions).size !== part.actions.length)) throw Errors.invalidManifest(`Part ${name} actions must be a unique array`, context);
    if (part.joint && !['revolute', 'prismatic'].includes(part.joint.type)) throw Errors.invalidManifest(`Unsupported joint type: ${part.joint.type}`, context);
    if (part.joint && (!Array.isArray(part.joint.axis) || part.joint.axis.length !== 3 || !part.joint.axis.every(Number.isFinite))) throw Errors.invalidManifest(`Part ${name} joint requires finite axis[3]`, context);
    if (part.joint?.limits && (part.joint.limits.length !== 2 || !part.joint.limits.every(Number.isFinite) || part.joint.limits[0] >= part.joint.limits[1])) throw Errors.invalidManifest(`Part ${name} joint requires ascending finite limits[2]`, context);
    for (const [action, target] of Object.entries(part.targets || {})) {
      if (!part.actions?.includes(action)) throw Errors.invalidManifest(`Part ${name} target ${action} requires matching action`, context);
      if (!Number.isFinite(target)) throw Errors.invalidManifest(`Part ${name} target ${action} must be finite`, context);
      if (!part.joint?.limits || target < part.joint.limits[0] || target > part.joint.limits[1]) throw Errors.invalidManifest(`Part ${name} target ${action} must be within joint limits`, context);
    }
    for (const action of part.actions || []) {
      if (ARTICULATION_ACTIONS.has(action) && (!part.joint || !part.physics?.colliders?.length || !Number.isFinite(part.targets?.[action]))) throw Errors.invalidManifest(`Part ${name} action ${action} requires physics, joint and explicit target`, context);
    }
    validatePhysics(part.physics, context);
  }
  for (const action of manifest.actions.filter((action) => ARTICULATION_ACTIONS.has(action))) {
    const executable = Object.values(manifest.parts || {}).some((part) => part.actions?.includes(action) && Number.isFinite(part.targets?.[action]));
    if (!executable) throw Errors.invalidManifest(`Top-level action ${action} requires an executable part target`, { id: manifest.id, action });
  }
  return manifest;
}
