import { PipelineEngine } from './PipelineEngine.js';

export function createWorldPipeline(runtime) {
  const pipeline = new PipelineEngine({ events: runtime.events, trace: runtime.trace });

  pipeline.register('resolve_assets', async (state) => {
    const requests = state.input.assets || [];
    const resolved = [];
    for (const request of requests) {
      if (request.assetId && runtime.assets.has(request.assetId)) {
        resolved.push({ ...request, assetId: request.assetId, status: 'found' });
        continue;
      }
      const result = await runtime.assetLibrary.resolve(request.query || request.type || '', { generate: request.generate ?? false });
      const match = result.assets?.[0];
      resolved.push({ ...request, assetId: match?.id, status: result.status, resolution: result });
    }
    state.artifacts.assets = resolved;
    return state;
  });

  pipeline.register('instantiate', async (state) => {
    const spawned = [];
    for (const request of state.artifacts.assets || []) {
      if (!request.assetId) continue;
      const id = await runtime.spawn(request.assetId, { position: request.position || [0, 0, 0], id: request.id });
      spawned.push(id);
    }
    state.artifacts.spawned = spawned;
    return state;
  });

  pipeline.register('apply_relations', async (state) => {
    for (const relation of state.input.relations || []) {
      if (relation.predicate === 'ON') runtime.interactions.place(relation.subject, relation.object, { surfaceId: relation.surfaceId });
      if (relation.predicate === 'NEAR' && relation.distance) {
        const target = runtime.store.get(relation.object).object.position;
        runtime.interactions.move(relation.subject, [target.x + relation.distance, target.y, target.z]);
      }
    }
    runtime.sceneGraph.update();
    return state;
  });

  pipeline.register('validate', async (state) => {
    state.reports.validation = runtime.validator.run();
    return state;
  });

  pipeline.register('repair', async (state) => {
    const report = state.reports.validation || runtime.validator.run();
    if (report.counts.hard) state.reports.repair = await runtime.repair.repair(report);
    state.reports.validationAfterRepair = runtime.validator.run();
    return state;
  });

  pipeline.register('finalize', async (state) => {
    runtime.sceneGraph.update();
    state.artifacts.scene = runtime.serialize({ name: state.input.name || 'Generated World' });
    return state;
  });

  return pipeline;
}
