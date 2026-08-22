export const TOOL_CATALOG = {
  listObjects: {
    description: 'List all objects currently in the 3D world with ids, assets, positions and supported actions.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    required: []
  },
  spawnAsset: {
    description: 'Spawn an asset from the registered asset library at a world position.',
    parameters: {
      type: 'object',
      properties: {
        assetId: { type: 'string' },
        position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        instanceId: { type: 'string' }
      },
      additionalProperties: false
    },
    required: ['assetId', 'position']
  },
  moveObject: {
    description: 'Move an existing object to an exact world position.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }
      },
      additionalProperties: false
    },
    required: ['id', 'position']
  },
  pickup: { description: 'Pick up a pickupable object.', parameters: { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false }, required: ['id'] },
  drop: { description: 'Drop the currently held object, or the supplied object id.', parameters: { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false }, required: [] },
  place: {
    description: 'Place an object on a target support surface using collision-aware spatial placement.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' }, targetId: { type: 'string' }, surfaceId: { type: 'string' }, clearance: { type: 'number', minimum: 0 } },
      additionalProperties: false
    },
    required: ['id', 'targetId']
  },
  open: { description: 'Open an openable articulated object.', parameters: { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false }, required: ['id'] },
  close: { description: 'Close an openable articulated object.', parameters: { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false }, required: ['id'] },
  duplicateObject: { description: 'Duplicate an object.', parameters: { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false }, required: ['id'] },
  removeObject: { description: 'Remove an object from the world.', parameters: { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false }, required: ['id'] },
  getBounds: { description: 'Get an object world-space bounding box, center and size.', parameters: { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false }, required: ['id'] },
  findNearby: { description: 'Find objects near another object.', parameters: { type: 'object', properties: { id: { type: 'string' }, radius: { type: 'number', minimum: 0 } }, additionalProperties: false }, required: ['id'] },
  raycast: {
    description: 'Cast a ray through the scene and return hit objects.',
    parameters: {
      type: 'object',
      properties: {
        origin: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        direction: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        maxDistance: { type: 'number', minimum: 0 }
      },
      additionalProperties: false
    },
    required: ['origin', 'direction']
  },
  isColliding: { description: 'Check whether an object overlaps other world objects.', parameters: { type: 'object', properties: { id: { type: 'string' }, ignore: { type: 'array', items: { type: 'string' } }, margin: { type: 'number' } }, additionalProperties: false }, required: ['id'] },
  findSupportSurface: { description: 'Inspect a target support surface.', parameters: { type: 'object', properties: { targetId: { type: 'string' }, surfaceId: { type: 'string' } }, additionalProperties: false }, required: ['targetId'] },
  findFreeSpace: { description: 'Find a collision-free position for an object on a target support surface.', parameters: { type: 'object', properties: { id: { type: 'string' }, targetId: { type: 'string' }, surfaceId: { type: 'string' }, clearance: { type: 'number', minimum: 0 } }, additionalProperties: false }, required: ['id', 'targetId'] }
};

export function toolDefinitionsForLLM() {
  return Object.entries(TOOL_CATALOG).map(([name, spec]) => ({
    name,
    description: spec.description,
    parameters: { ...spec.parameters, required: spec.required }
  }));
}
