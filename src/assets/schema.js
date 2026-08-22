import { Errors } from '../core/errors.js';

const BODY_TYPES = new Set(['fixed', 'dynamic', 'kinematic']);
const SHAPES = new Set(['box', 'cylinder', 'convexHull']);

function validatePhysics(physics, context) {
  if (!physics) return;
  if (physics.body && !BODY_TYPES.has(physics.body)) throw Errors.invalidManifest(`Unsupported physics body: ${physics.body}`, context);
  for (const collider of physics.colliders || []) {
    if (!SHAPES.has(collider.shape)) throw Errors.invalidManifest(`Unsupported collider shape: ${collider.shape}`, context);
    if (collider.shape === 'box' && collider.halfExtents?.length !== 3) throw Errors.invalidManifest('Box collider requires halfExtents[3]', context);
    if (collider.shape === 'cylinder' && (collider.halfHeight == null || collider.radius == null)) throw Errors.invalidManifest('Cylinder collider requires halfHeight and radius', context);
    if (collider.shape === 'convexHull' && (!Array.isArray(collider.vertices) || collider.vertices.length < 12 || collider.vertices.length % 3 !== 0)) throw Errors.invalidManifest('Convex hull collider requires flat vertices[] with at least 4 points', context);
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
    if (!part.node) throw Errors.invalidManifest(`Part ${name} requires node`, { id: manifest.id, part: name });
    if (part.joint && !['revolute', 'prismatic'].includes(part.joint.type)) throw Errors.invalidManifest(`Unsupported joint type: ${part.joint.type}`, { id: manifest.id, part: name });
    if (part.joint && (!Array.isArray(part.joint.axis) || part.joint.axis.length !== 3)) throw Errors.invalidManifest(`Part ${name} joint requires axis[3]`, { id: manifest.id, part: name });
    validatePhysics(part.physics, { id: manifest.id, part: name });
  }
  return manifest;
}
