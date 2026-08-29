import { PipelineEngine } from './PipelineEngine.js';
import { compileWorldIR, compileWorldInput } from './WorldCompilation.js';
import { assetAdmission } from '../../asset/admission.js';
import { composeNearPlacement, composeWorldLayout } from './WorldComposer.js';
import { buildAcceptanceEvidenceBundle, evaluateWorldAcceptance } from '../verification/WorldAcceptance.js';
import { buildWorldRevisionContext } from '../spec/WorldRevision.js';
import { compileAdmissionFindings } from '../verification/Finding.js';
import { admitWorldBehavior } from './WorldBehaviorCompiler.js';
import { admitWorldPhysics } from './WorldPhysicsAdmission.js';
import { assetIdFromRef, createAssetRef } from '../../asset/AssetRef.js';

const executionAdmissionRejected=(state)=>[
  state.reports.assetAdmission,
  state.reports.layoutAdmission,
  state.reports.behaviorAdmission,
  state.reports.physicsAdmission,
  state.reports.relationAdmission
].some((admission)=>admission?.status==='rejected');

const validationNotEvaluated=()=>({
  status:'not-evaluated',reason:'UPSTREAM_ADMISSION_REJECTED',
  counts:{hard:0,advisory:0},hard:[],advisory:[],findings:[]
});

const admissionNotEvaluated=(reason='UPSTREAM_ADMISSION_REJECTED',extra={})=>({
  status:'not-evaluated',reason,...extra
});

const resolveCanonicalAsset = async (runtime, request) => {
  const query = request.query || request.type || request.assetId || '';
  if (request.generate || request.provider) {
    return {
      status: 'generation_outside_world',
      query,
      assets: [],
      hint: 'Generate and publish the Asset before compiling canonical WorldIR.'
    };
  }
  if (request.assetId && runtime.assets.has(request.assetId)) {
    const manifest = runtime.assets.getManifest(request.assetId);
    return { status: 'found', query, assets: [runtime.assetCatalog?.summary?.(manifest) || { id: manifest.id }] };
  }
  if (runtime.assetCatalog?.resolveExisting) {
    return runtime.assetCatalog.resolveExisting(query, { assetId: request.assetId || null, limit: 5 });
  }
  return { status: 'missing', query, assets: [] };
};

const resolveLegacyAsset = (runtime, request) => {
  if (typeof runtime.generation?.resolveAssetRequest !== 'function') {
    const query=request.query || request.type || request.assetId || '';
    return Promise.resolve(runtime.assetCatalog.resolveExisting(query,{assetId:request.assetId || null,limit:5}));
  }
  return runtime.generation.resolveAssetRequest({
    query:request.query || request.type || '',
    generate:request.generate ?? false,
    ...(request.id ? {instanceId:request.id} : {}),
    ...(request.provider ? {provider:request.provider} : {}),
    ...(request.assetId ? {assetId:request.assetId} : {})
  });
};

const createPipeline=(runtime,compileInput,resolveAsset)=>{
  const pipeline = new PipelineEngine({ events: runtime.events, trace: runtime.trace });

  pipeline.register('normalize_spec', async (state) => {
    const compilation = compileInput(state.input);
    const worldIR = compilation.worldIR;
    state.artifacts.compilation = compilation;
    state.artifacts.worldIR = structuredClone(worldIR);
    if(compilation.compatibility?.worldSpec) state.artifacts.worldSpec=structuredClone(compilation.compatibility.worldSpec);
    state.artifacts.behaviorBundle = structuredClone(compilation.behaviorBundle);
    state.artifacts.physicsRequirements = structuredClone(compilation.physicsRequirements);
    return state;
  });

  pipeline.register('resolve_assets', async (state) => {
    const requests = state.artifacts.compilation?.assetRequests || [];
    const entities = state.artifacts.compilation?.entities || [];
    const resolved = [];
    const resolutions = [];
    for (let index=0; index<entities.length; index++) {
      const request = requests[index] || {};
      const entity = entities[index] || {};
      const existingAssetId = assetIdFromRef(entity.assetRef);
      if (existingAssetId && runtime.assets.has(existingAssetId)) {
        resolved.push({ ...entity, assetRef:createAssetRef(existingAssetId), status:'found' });
        resolutions.push({ id:entity.id || null, query:request.query || existingAssetId, status:'found', assetId:existingAssetId });
        continue;
      }
      const result = await resolveAsset(runtime, request);
      const match = result.assets?.[0];
      const assetId = match?.id || null;
      resolved.push({ ...entity, ...(assetId ? { assetRef:createAssetRef(assetId) } : {}), status:result.status });
      resolutions.push({ id:entity.id || null, query:request.query || request.type || request.assetId || '', status:result.status, ...(assetId ? { assetId } : {}) });
    }
    state.artifacts.assets = resolved;
    state.artifacts.assetResolutions = resolutions;
    return state;
  });

  pipeline.register('asset_admission', async (state) => {
    const assets=state.artifacts.assets || [];
    const resolutions=state.artifacts.assetResolutions || [];
    const unresolved=resolutions.filter((item)=>!item.assetId);
    const provisional=[];
    for (const item of assets) {
      const assetId=assetIdFromRef(item.assetRef);
      if (!assetId || !runtime.assets.has(assetId)) continue;
      const manifest=runtime.assets.getManifest(assetId);
      const admission=assetAdmission(manifest);
      if (admission.status==='provisional') provisional.push({ assetId, reasons:[...admission.reasons] });
      if (admission.status==='rejected') {
        const resolution=resolutions.find((entry)=>entry.id===item.id) || {id:item.id || null,query:'',status:'asset_rejected'};
        unresolved.push({...resolution,status:'asset_rejected'});
      }
    }
    state.reports.assetAdmission={
      status:unresolved.length?'rejected':provisional.length?'provisional':'ready',
      unresolved:unresolved.map((item)=>({ id:item.id || null, query:item.query, status:item.status })),
      provisional
    };
    return state;
  });

  pipeline.register('compose_layout', async (state) => {
    if (state.reports.assetAdmission?.status==='rejected') {
      state.reports.layoutAdmission=admissionNotEvaluated('UPSTREAM_ASSET_ADMISSION_REJECTED',{placements:[],issues:[]});
      return state;
    }
    const report=composeWorldLayout(state.artifacts.assets || [],{
      getManifest:(assetId)=>runtime.assets.getManifest(assetId),
      poseClear:(manifest,position)=>runtime.physics.manifestPoseClear(manifest,position),
      layout:runtime.environment?.layout
    });
    state.reports.layoutAdmission=report;
    if (report.status!=='rejected') {
      const placements=report.placements || [];
      state.artifacts.assets=(state.artifacts.assets || []).map((item,index)=>{
        const placement=placements[index];
        return placement ? {...item,position:[...placement.position],placement:{mode:placement.mode,coverage:placement.coverage}} : item;
      });
    }
    return state;
  });

  pipeline.register('behavior_admission', async (state) => {
    if(state.reports.assetAdmission?.status==='rejected'){
      state.reports.behaviorAdmission=admissionNotEvaluated('UPSTREAM_ASSET_ADMISSION_REJECTED',{issues:[]});
      return state;
    }
    state.reports.behaviorAdmission=admitWorldBehavior(state.artifacts.behaviorBundle,{resolvedAssets:state.artifacts.assets||[],getManifest:(assetId)=>runtime.assets.getManifest(assetId)});
    return state;
  });

  pipeline.register('physics_admission', async (state) => {
    if(state.reports.assetAdmission?.status==='rejected'){
      state.reports.physicsAdmission=admissionNotEvaluated('UPSTREAM_ASSET_ADMISSION_REJECTED',{backend:null,requirements:structuredClone(state.artifacts.physicsRequirements?.requirements||[]),issues:[]});
      return state;
    }
    state.reports.physicsAdmission=admitWorldPhysics(state.artifacts.physicsRequirements,{profile:runtime.physics?.profile?.()||null,resolvedAssets:state.artifacts.assets||[],getManifest:(assetId)=>runtime.assets.getManifest(assetId)});
    return state;
  });

  pipeline.register('instantiate', async (state) => {
    const spawned = [];
    if (state.reports.assetAdmission?.status==='rejected' || state.reports.layoutAdmission?.status==='rejected' || state.reports.behaviorAdmission?.status==='rejected' || state.reports.physicsAdmission?.status==='rejected') {
      state.artifacts.spawned=spawned;
      return state;
    }
    for (const request of state.artifacts.assets || []) {
      const assetId=assetIdFromRef(request.assetRef);
      if (!assetId) continue;
      const options={position:request.position || [0,0,0],id:request.id};
      if(request.initialState && Object.keys(request.initialState).length) options.initialState=structuredClone(request.initialState);
      const id = await runtime.spawn(assetId, options);
      spawned.push(id);
    }
    state.artifacts.spawned = spawned;
    return state;
  });

  pipeline.register('apply_relations', async (state) => {
    if (state.reports.assetAdmission?.status==='rejected' || state.reports.layoutAdmission?.status==='rejected' || state.reports.behaviorAdmission?.status==='rejected' || state.reports.physicsAdmission?.status==='rejected') {
      state.reports.relationAdmission=admissionNotEvaluated('UPSTREAM_ADMISSION_REJECTED',{applied:[],issues:[]});
      return state;
    }
    const applied=[],issues=[];
    state.reports.relationAdmission={status:'ready',applied,issues};
    for (const relation of state.artifacts.compilation?.relations || []) {
      if (relation.predicate === 'ON') {
        const result=runtime.interactions.place(relation.subject,relation.object,{surfaceId:relation.surfaceId,silent:true});
        applied.push({...relation,result});
        continue;
      }
      if (relation.predicate === 'INSIDE') {
        const result=runtime.interactions.placeInside(relation.subject,relation.object,{receptacleId:relation.receptacleId,silent:true});
        if (result.status !== 'inside' || result.containmentVerified !== true) {
          issues.push({...relation,reason:result.reason || 'INSIDE_NOT_VERIFIED',details:result});
          state.reports.relationAdmission={status:'rejected',reason:result.reason || 'INSIDE_NOT_VERIFIED',applied,issues};
          return state;
        }
        applied.push({...relation,result});
        continue;
      }
      if (relation.predicate === 'NEAR') {
        const subject=runtime.store.get(relation.subject),target=runtime.store.get(relation.object);
        const targetPosition=target.object.position.toArray();
        const result=composeNearPlacement(subject.manifest,target.manifest,targetPosition,{
          subjectY:subject.object.position.y,distance:relation.distance,
          poseClear:(manifest,position)=>runtime.physics.manifestPoseClear(manifest,position,{excludeIds:[relation.subject]})
        });
        if (!result.checked) {
          issues.push({...relation,reason:result.reason,details:result});
          state.reports.relationAdmission={status:'rejected',reason:result.reason,applied,issues};
          return state;
        }
        runtime.interactions.move(relation.subject,result.position,{silent:true});
        applied.push({...relation,position:result.position,distance:result.distance,mode:result.mode});
      }
    }
    runtime.sceneGraph.changed();
    return state;
  });

  pipeline.register('validate', async (state) => {
    state.reports.validation=executionAdmissionRejected(state)?validationNotEvaluated():runtime.validator.run({worldRevisionId:state.artifacts.worldIR?.revision?.id || null});
    return state;
  });

  pipeline.register('repair', async (state) => {
    if(executionAdmissionRejected(state)){
      state.reports.validationAfterRepair=state.reports.validation || validationNotEvaluated();
      return state;
    }
    const report=state.reports.validation || runtime.validator.run({worldRevisionId:state.artifacts.worldIR?.revision?.id || null});
    if(report.counts.hard){
      state.reports.repair=await runtime.repair.repair(report,{worldRevisionId:state.artifacts.worldIR?.revision?.id || null,silent:true});
      state.reports.validationAfterRepair=runtime.validator.run({worldRevisionId:state.artifacts.worldIR?.revision?.id || null});
    } else state.reports.validationAfterRepair=report;
    return state;
  });

  pipeline.register('finalize', async (state) => {
    runtime.sceneGraph.update();
    const validation=state.reports.validationAfterRepair || state.reports.validation || (executionAdmissionRejected(state)?validationNotEvaluated():runtime.validator.run({worldRevisionId:state.artifacts.worldIR?.revision?.id || null}));
    const assetAdmission=state.reports.assetAdmission || { status:'ready', unresolved:[], provisional:[] };
    const layoutAdmission=state.reports.layoutAdmission || {status:'ready',placements:[],issues:[]};
    const relationAdmission=state.reports.relationAdmission || admissionNotEvaluated('RELATION_STAGE_NOT_RUN',{applied:[],issues:[]});
    const behaviorAdmission=state.reports.behaviorAdmission || {status:'ready',issues:[]};
    const physicsAdmission=state.reports.physicsAdmission || {status:'ready',backend:null,requirements:[],issues:[]};
    const worldIR=state.artifacts.worldIR;
    const acceptanceGraph=state.artifacts.compilation?.acceptanceGraph || null;
    const upstreamAdmissionRejected=[assetAdmission,layoutAdmission,behaviorAdmission,physicsAdmission,relationAdmission]
      .some((admission)=>admission.status==='rejected');
    let worldAcceptance=null;
    delete state.artifacts.acceptanceEvidence;
    if(acceptanceGraph){
      if(upstreamAdmissionRejected){
        worldAcceptance={status:'not-evaluated',reason:'UPSTREAM_ADMISSION_REJECTED'};
        state.reports.worldAcceptance=structuredClone(worldAcceptance);
      } else {
        worldAcceptance=evaluateWorldAcceptance(runtime,acceptanceGraph,{unresolvedMutations:undefined,worldRevisionId:worldIR?.revision?.id || null,validationEvidence:validation});
        state.reports.worldAcceptance=worldAcceptance;
        const bundle=buildAcceptanceEvidenceBundle(acceptanceGraph,worldAcceptance,{worldRevisionId:worldIR?.revision?.id || null,source:'world-pipeline',provenance:worldIR?.provenance || null});
        state.artifacts.acceptanceEvidence=structuredClone(bundle);
        runtime.trace?.emit?.('world.acceptance',{bundle:structuredClone(bundle)},{actor:'world-pipeline'});
      }
    }
    const acceptanceRejected=worldAcceptance?.status==='world-incomplete';
    const status=validation.counts.hard || assetAdmission.status==='rejected' || layoutAdmission.status==='rejected' || behaviorAdmission.status==='rejected' || physicsAdmission.status==='rejected' || relationAdmission.status==='rejected' || acceptanceRejected ? 'rejected'
      : validation.counts.advisory || assetAdmission.status==='provisional' || layoutAdmission.status==='provisional' ? 'provisional'
      : 'ready';
    state.reports.worldAdmission={
      status,
      reasons:[
        ...(validation.counts.hard?[`VALIDATION_HARD:${validation.counts.hard}`]:[]),
        ...(validation.counts.advisory?[`VALIDATION_ADVISORY:${validation.counts.advisory}`]:[]),
        ...(assetAdmission.status==='rejected'?['ASSET_UNRESOLVED']:[]),
        ...(assetAdmission.status==='provisional'?['ASSET_PROVISIONAL']:[]),
        ...(layoutAdmission.status==='rejected'?[layoutAdmission.reason || 'LAYOUT_REJECTED']:[]),
        ...(layoutAdmission.status==='provisional'?['LAYOUT_PROVISIONAL']:[]),
        ...(behaviorAdmission.status==='rejected'?[behaviorAdmission.reason || behaviorAdmission.issues?.[0]?.code || 'BEHAVIOR_REJECTED']:[]),
        ...(physicsAdmission.status==='rejected'?[physicsAdmission.reason || physicsAdmission.issues?.[0]?.code || 'PHYSICS_REJECTED']:[]),
        ...(relationAdmission.status==='rejected'?[relationAdmission.reason || 'RELATION_REJECTED']:[]),
        ...(acceptanceRejected?['WORLD_ACCEPTANCE_FAILED']:[])
      ],
      validation:{ hard:validation.counts.hard, advisory:validation.counts.advisory },
      assets:structuredClone(assetAdmission),
      layout:structuredClone(layoutAdmission),
      behavior:structuredClone(behaviorAdmission),
      physics:structuredClone(physicsAdmission),
      relations:structuredClone(relationAdmission),
      ...(worldAcceptance?{acceptance:structuredClone(worldAcceptance)}:{})
    };
    const admissionFindingOptions={worldRevisionId:worldIR?.revision?.id || null};
    const revisionFindings=[
      ...(validation.findings||[]).filter((finding)=>finding.severity==='hard'),
      ...compileAdmissionFindings(assetAdmission,{stage:'asset',...admissionFindingOptions}),
      ...compileAdmissionFindings(layoutAdmission,{stage:'layout',...admissionFindingOptions}),
      ...compileAdmissionFindings(behaviorAdmission,{stage:'behavior',...admissionFindingOptions}),
      ...compileAdmissionFindings(physicsAdmission,{stage:'physics',...admissionFindingOptions}),
      ...compileAdmissionFindings(relationAdmission,{stage:'relation',...admissionFindingOptions}),
      ...(state.artifacts.acceptanceEvidence?.findings||[])
    ];
    if(status==='rejected'&&revisionFindings.length) state.artifacts.revisionContext=buildWorldRevisionContext(worldIR,revisionFindings);
    if(status!=='rejected'){
      runtime.currentWorldRevision={revision:structuredClone(worldIR.revision),provenance:structuredClone(worldIR.provenance)};
      runtime.restoredAcceptanceEvidence=null;
      runtime.lastAcceptanceBundle=state.artifacts.acceptanceEvidence?structuredClone(state.artifacts.acceptanceEvidence):null;
      runtime.currentBehaviorBundle=structuredClone(state.artifacts.behaviorBundle);
      runtime.currentPhysicsRequirements=structuredClone(state.artifacts.physicsRequirements);
      runtime.loadRuleGraph?.(state.artifacts.behaviorBundle.ruleGraph);
    }
    state.artifacts.scene = runtime.serialize({ name: worldIR?.intent?.name || 'Generated World' });
    return state;
  });

  return pipeline;
};

export function createCanonicalWorldPipeline(runtime){return createPipeline(runtime,compileWorldIR,resolveCanonicalAsset);}

// Backward-compatible boundary for direct callers that still submit WorldSpec.
export function createWorldPipeline(runtime){return createPipeline(runtime,compileWorldInput,resolveLegacyAsset);}
