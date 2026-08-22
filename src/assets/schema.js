import { Errors } from '../core/errors.js';

const BODY_TYPES = new Set(['fixed', 'dynamic', 'kinematic']);

export function validateAssetManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw Errors.invalidManifest('Manifest must be an object');
  if (!manifest.id || typeof manifest.id !== 'string') throw Errors.invalidManifest('Manifest requires string id');
  if (!manifest.type || typeof manifest.type !== 'string') throw Errors.invalidManifest('Manifest requires string type', { id: manifest.id });
  if (!Array.isArray(manifest.actions)) throw Errors.invalidManifest('Manifest actions must be an array', { id: manifest.id });
  if (new Set(manifest.actions).size !== manifest.actions.length) throw Errors.invalidManifest('Manifest actions must be unique', { id: manifest.id });
  if (manifest.physics?.body && !BODY_TYPES.has(manifest.physics.body)) {
    throw Errors.invalidManifest(`Unsupported physics body: ${manifest.physics.body}`, { id: manifest.id });
  }
  for (const [name, part] of Object.entries(manifest.parts || {})) {
    if (!part.node) throw Errors.invalidManifest(`Part ${name} requires node`, { id: manifest.id, part: name });
    if (part.joint && !['revolute', 'prismatic'].includes(part.joint.type)) {
      throw Errors.invalidManifest(`Unsupported joint type: ${part.joint.type}`, { id: manifest.id, part: name });
    }
  }
  return manifest;
}
