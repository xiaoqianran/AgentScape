import { EmbodiedGenAdapter } from '../adapters/EmbodiedGenAdapter.js';

const required = (...keys) => (input) => {
  const missing = keys.filter((key) => input?.[key] == null);
  return missing.length ? { ok: false, message: `Missing required fields: ${missing.join(', ')}` } : { ok: true };
};

export function registerCoreSkills(registry, runtime) {
  const add = (name, options, handler) => registry.register({ name, ...options, handler: (input, ctx) => handler(input, ctx) });

  add('listAssets', { description: 'List registered assets.', permissions: ['asset.read'] }, () => runtime.assetLibrary.list());
  add('searchAssets', { description: 'Search reusable assets.', permissions: ['asset.read'], validate: required('query') }, (a) => runtime.assetLibrary.search(a.query, { limit: a.limit ?? 8 }));
  add('resolveAsset', { description: 'Resolve an asset from the library or generator.', permissions: ['asset.read'], validate: required('query') }, (a) => runtime.assetLibrary.resolve(a.query, { generate: a.generate ?? false }));
  add('generateAsset', { description: 'Generate and register an asset.', permissions: ['asset.write'], validate: required('prompt') }, (a) => runtime.assetLibrary.generate(a.prompt));
  add('importEmbodiedGenAsset', { description: 'Register an EmbodiedGen-style asset payload for browser runtime use.', permissions: ['asset.write'], validate: required('payload') }, (a) => {
    const manifest = new EmbodiedGenAdapter().toManifest(a.payload, { id: a.id, glbUrl: a.glbUrl });
    runtime.assets.registerManifest(manifest);
    runtime.events.emit('asset.registered', { assetId: manifest.id, provider: 'embodiedgen' });
    return runtime.assetLibrary.summary(manifest);
  });

  add('listObjects', { description: 'List world objects.', permissions: ['world.read'] }, () => runtime.listObjects());
  add('spawnAsset', { description: 'Spawn an asset.', permissions: ['world.write'], mutates: true, validate: required('assetId', 'position') }, (a) => runtime.spawn(a.assetId, { position: a.position, id: a.instanceId }));
  add('moveObject', { description: 'Move an object.', permissions: ['world.write'], mutates: true, validate: required('id', 'position') }, (a) => runtime.interactions.move(a.id, a.position));
  add('pickup', { description: 'Pick up an object.', permissions: ['world.write'], mutates: true, validate: required('id') }, (a) => runtime.interactions.pickup(a.id));
  add('drop', { description: 'Drop a held object.', permissions: ['world.write'], mutates: true }, (a) => runtime.interactions.drop(a.id));
  add('place', { description: 'Collision-aware placement on a support surface.', permissions: ['world.write'], mutates: true, validate: required('id', 'targetId') }, (a) => runtime.interactions.place(a.id, a.targetId, { surfaceId: a.surfaceId, clearance: a.clearance }));
  add('open', { description: 'Open an articulated object.', permissions: ['world.write'], mutates: true, validate: required('id') }, (a) => runtime.interactions.setDoor(a.id, true));
  add('close', { description: 'Close an articulated object.', permissions: ['world.write'], mutates: true, validate: required('id') }, (a) => runtime.interactions.setDoor(a.id, false));
  add('duplicateObject', { description: 'Duplicate a world object.', permissions: ['world.write'], mutates: true, validate: required('id') }, (a) => runtime.duplicate(a.id));
  add('removeObject', { description: 'Remove a world object.', permissions: ['world.write'], mutates: true, validate: required('id') }, (a) => runtime.remove(a.id));

  add('getBounds', { description: 'Get world-space bounds.', permissions: ['spatial.read'], validate: required('id') }, (a) => runtime.spatial.getBounds(a.id));
  add('findNearby', { description: 'Find nearby objects.', permissions: ['spatial.read'], validate: required('id') }, (a) => runtime.spatial.findNearby(a.id, a.radius ?? 2));
  add('raycast', { description: 'Raycast into the world.', permissions: ['spatial.read'], validate: required('origin', 'direction') }, (a) => runtime.spatial.raycast(a.origin, a.direction, a.maxDistance ?? 100));
  add('isColliding', { description: 'Check object overlaps.', permissions: ['physics.read'], validate: required('id') }, (a) => runtime.spatial.isColliding(a.id, { ignore: a.ignore ?? [], margin: a.margin ?? 0.01 }));
  add('findSupportSurface', { description: 'Inspect support surface.', permissions: ['spatial.read'], validate: required('targetId') }, (a) => {
    const s = runtime.spatial.getSupportSurface(a.targetId, a.surfaceId);
    return s ? { ...s, center: s.center.toArray().map((v) => Number(v.toFixed(3))) } : null;
  });
  add('findFreeSpace', { description: 'Find collision-free support placement.', permissions: ['spatial.read'], validate: required('id', 'targetId') }, (a) => runtime.spatial.findFreeSpace(a.id, a.targetId, { surfaceId: a.surfaceId, clearance: a.clearance })?.toArray() ?? null);
  add('listRelations', { description: 'List semantic scene relations.', permissions: ['spatial.read'] }, (a) => runtime.sceneGraph.list({ subject: a.subject, predicate: a.predicate, object: a.object }));
  add('describeObjectRelations', { description: 'Describe semantic relations for one object.', permissions: ['spatial.read'], validate: required('id') }, (a) => runtime.sceneGraph.describe(a.id));

  add('validateWorld', { description: 'Run deterministic geometry/physics/relation validation.', permissions: ['world.read', 'physics.read'] }, () => runtime.validator.run());
  add('repairWorld', { description: 'Repair deterministic hard validation findings, guarded against regression.', permissions: ['world.write', 'physics.read'], mutates: true }, async (a) => runtime.repair.repair(a.report || runtime.validator.run(), { maxRepairs: a.maxRepairs ?? 20 }));
  add('getTrace', { description: 'Inspect recent auditable engine events.', permissions: ['world.read'] }, (a) => runtime.trace.list(a));
  add('verifyTrace', { description: 'Verify the trace integrity chain.', permissions: ['world.read'] }, () => runtime.trace.verify());

  add('executeBatch', { description: 'Execute multiple registered skills atomically as one world mutation.', permissions: ['world.write'], mutates: true, validate: required('calls') }, async (a, { context }) => {
    const before = runtime.snapshot();
    const results = [];
    for (const call of a.calls) {
      const result = await registry.invoke(call.name, call.args || {}, { ...context, skipHistory: true });
      results.push({ name: call.name, ...result });
      if (!result.success) {
        await runtime.restore(before);
        return { committed: false, results, rolledBack: true };
      }
    }
    runtime.sceneGraph.update();
    return { committed: true, results, rolledBack: false };
  });

  add('runWorldPipeline', { description: 'Run the staged world-building/validation pipeline.', permissions: ['world.write'], mutates: true, validate: required('plan') }, (a) => runtime.worldPipeline.run(a.plan, { stages: a.stages }));

  return registry;
}
