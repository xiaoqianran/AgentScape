import { PipelineEngine } from './PipelineEngine.js';
import { normalizeWorldSpec } from './WorldSpec.js';
import { assetAdmission } from '../assets/admission.js';

export function createWorldPipeline(runtime) {
  const pipeline = new PipelineEngine({ events: runtime.events, trace: runtime.trace });

  pipeline.register('normalize_spec', async (state) => {
    state.input = normalizeWorldSpec(state.input);
    state.artifacts.worldSpec = structuredClone(state.input);
    return state;
  });

  pipeline.register('resolve_assets', async (state) => {
    const requests = state.input.assets || [];
    const resolved = [];
    for (const request of requests) {
      if (request.assetId && runtime.assets.has(request.assetId)) {
        resolved.push({ ...request, assetId: request.assetId, status: 'found' });
        continue;
      }
      const result = await runtime.assetLibrary.resolve(request.query || request.type || '', {
        generate: request.generate ?? false,
        ...(request.provider ? { provider:request.provider } : {}),
        ...(request.assetId ? { id:request.assetId } : {})
      });
      const match = result.assets?.[0];
      resolved.push({ ...request, assetId: match?.id, status: result.status, resolution: result });
    }
    state.artifacts.assets = resolved;
    return state;
  });

  pipeline.register('asset_admission', async (state) => {
    const assets=state.artifacts.assets || [];
    const unresolved=assets.filter((item)=>!item.assetId);
    const provisional=[];
    for (const item of assets) {
      if (!item.assetId || !runtime.assets.has(item.assetId)) continue;
      const manifest=runtime.assets.getManifest(item.assetId);
      const admission=assetAdmission(manifest);
      if (admission.status==='provisional') provisional.push({ assetId:item.assetId, reasons:[...admission.reasons] });
      if (admission.status==='rejected') unresolved.push({ ...item, status:'asset_rejected' });
    }
    state.reports.assetAdmission={
      status:unresolved.length?'rejected':provisional.length?'provisional':'ready',
      unresolved:unresolved.map((item)=>({ id:item.id || null, query:item.query, status:item.status })),
      provisional
    };
    return state;
  });

  pipeline.register('instantiate', async (state) => {
    const spawned = [];
    if (state.reports.assetAdmission?.status==='rejected') {
      state.artifacts.spawned=spawned;
      return state;
    }
    for (const request of state.artifacts.assets || []) {
      if (!request.assetId) continue;
      const id = await runtime.spawn(request.assetId, { position: request.position || [0, 0, 0], id: request.id });
      spawned.push(id);
    }
    state.artifacts.spawned = spawned;
    return state;
  });

  pipeline.register('apply_relations', async (state) => {
    if (state.reports.assetAdmission?.status==='rejected') return state;
    for (const relation of state.input.relations || []) {
      if (relation.predicate === 'ON') runtime.interactions.place(relation.subject, relation.object, { surfaceId: relation.surfaceId });
      if (relation.predicate === 'NEAR' && relation.distance) {
        const target = runtime.store.get(relation.object).object.position;
        runtime.interactions.move(relation.subject, [target.x + relation.distance, target.y, target.z]);
      }
    }
    runtime.sceneGraph.changed();
    return state;
  });

  pipeline.register('validate', async (state) => {
    state.reports.validation = runtime.validator.run();
    return state;
  });

  pipeline.register('repair', async (state) => {
    if (state.reports.assetAdmission?.status==='rejected') {
      state.reports.validationAfterRepair=state.reports.validation || runtime.validator.run();
      return state;
    }
    const report = state.reports.validation || runtime.validator.run();
    if (report.counts.hard) state.reports.repair = await runtime.repair.repair(report);
    state.reports.validationAfterRepair = runtime.validator.run();
    return state;
  });

  pipeline.register('finalize', async (state) => {
    runtime.sceneGraph.update();
    const validation=state.reports.validationAfterRepair || state.reports.validation || runtime.validator.run();
    const assetAdmission=state.reports.assetAdmission || { status:'ready', unresolved:[], provisional:[] };
    const status=validation.counts.hard || assetAdmission.status==='rejected' ? 'rejected'
      : validation.counts.advisory || assetAdmission.status==='provisional' ? 'provisional'
      : 'ready';
    state.reports.worldAdmission={
      status,
      reasons:[
        ...(validation.counts.hard?[`VALIDATION_HARD:${validation.counts.hard}`]:[]),
        ...(validation.counts.advisory?[`VALIDATION_ADVISORY:${validation.counts.advisory}`]:[]),
        ...(assetAdmission.status==='rejected'?['ASSET_UNRESOLVED']:[]),
        ...(assetAdmission.status==='provisional'?['ASSET_PROVISIONAL']:[])
      ],
      validation:{ hard:validation.counts.hard, advisory:validation.counts.advisory },
      assets:structuredClone(assetAdmission)
    };
    state.artifacts.scene = runtime.serialize({ name: state.input.name || 'Generated World' });
    return state;
  });

  return pipeline;
}
