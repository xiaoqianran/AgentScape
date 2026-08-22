export const TOOL_CATALOG = {
  validateWorld: {
    description: 'Run deterministic world validation for geometry, overlaps, support and semantic relation consistency.',
    parameters: { type: 'object', properties: {}, additionalProperties: false }, required: []
  },
  repairWorld: {
    description: 'Repair deterministic hard validation findings and reject repairs that increase hard failures.',
    parameters: { type: 'object', properties: { report: { type: 'object' }, maxRepairs: { type: 'integer' } }, additionalProperties: false }, required: []
  },
  executeBatch: {
    description: 'Execute multiple tool calls atomically. If any call fails, restore the world snapshot.',
    parameters: { type: 'object', properties: { calls: { type: 'array', items: { type: 'object' } } }, additionalProperties: false }, required: ['calls']
  },
  runWorldPipeline: {
    description: 'Run the staged resolve-assets → instantiate → relations → validate → repair → finalize world pipeline.',
    parameters: { type: 'object', properties: { plan: { type: 'object' }, stages: { type: 'array', items: { type: 'string' } } }, additionalProperties: false }, required: ['plan']
  },
  importEmbodiedGenAsset: {
    description: 'Normalize and register a browser-reachable EmbodiedGen-style asset payload.',
    parameters: { type: 'object', properties: { payload: { type: 'object' }, id: { type: 'string' }, glbUrl: { type: 'string' } }, additionalProperties: false }, required: ['payload']
  },
  getTrace: {
    description: 'Read recent auditable engine trace events.',
    parameters: { type: 'object', properties: { type: { type: 'string' }, actor: { type: 'string' }, sinceSeq: { type: 'integer' }, limit: { type: 'integer' } }, additionalProperties: false }, required: []
  },
  verifyTrace: {
    description: 'Verify the engine trace integrity chain.',
    parameters: { type: 'object', properties: {}, additionalProperties: false }, required: []
  },
  listRelations: {
    description: 'List semantic spatial relations in the current scene graph, such as ON, NEAR, INSIDE, SUPPORTS and CONTAINS.',
    parameters: { type: 'object', properties: { subject: { type: 'string' }, predicate: { type: 'string' }, object: { type: 'string' } }, additionalProperties: false },
    required: []
  },
  describeObjectRelations: {
    description: 'Describe all incoming and outgoing semantic spatial relations for one object.',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false },
    required: ['id']
  },
  listAssets: {
    description: 'List assets available in the AgentScape asset library.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    required: []
  },
  searchAssets: {
    description: 'Search the reusable asset library by natural-language name, type, alias or tag. Search before generating a new asset.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 20 } }, additionalProperties: false },
    required: ['query']
  },
  resolveAsset: {
    description: 'Resolve an asset request. Returns library matches first and may request generation only when generate=true and nothing matches.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, generate: { type: 'boolean' } }, additionalProperties: false },
    required: ['query']
  },
  generateAsset: {
    description: 'Generate and register a missing 3D asset using the configured Asset Generator gateway. Use only after searchAssets finds no suitable asset.',
    parameters: { type: 'object', properties: { prompt: { type: 'string' } }, additionalProperties: false },
    required: ['prompt']
  },
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
