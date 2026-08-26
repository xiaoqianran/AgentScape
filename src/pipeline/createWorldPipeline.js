import { PipelineEngine } from './PipelineEngine.js';
import { compileWorldIR, compileWorldInput } from './WorldCompilation.js';
import { assetAdmission } from '../assets/admission.js';
import { composeNearPlacement, composeWorldLayout } from './WorldComposer.js';
import { buildAcceptanceEvidenceBundle, evaluateWorldAcceptance } from '../validation/WorldAcceptance.js';
import { buildWorldRevisionContext } from './WorldRevision.js';
import { compileAdmissionFindings } from '../validation/Finding.js';
import { admitWorldBehavior } from './WorldBehaviorCompiler.js';
import { admitWorldPhysics } from './WorldPhysicsAdmission.js';

const createPipeline=(runtime,compileInput)=>{
  const pipeline = new PipelineEngine({ events: runtime.events, trace: runtime.trace });

  pipeline.register('normalize_spec', async (state) => {
    const compilation = compileInput(state.input);
    const worldIR = compilation.worldIR;
    state.artifacts.compilation = compilation;
    state.artifacts.worldIR = structuredClone(worldIR);
    if(compilation.compatibility?.worldSpec) state.artifacts.worldSpec=structuredClone(compilation.compatibility.worldSpec);
    state.artifacts.behaviorBundle = structuredClone(compilation.behaviorBundle);
    state.artifacts.physicsRequirements = structuredClone(compilation.physicsRequirements);
    runtime.currentWorldRevision={revision:structuredClone(worldIR.revision),provenance:structuredClone(worldIR.provenance)};
    runtime.restoredAcceptanceEvidence=null;
    return state;
  });

  pipeline.register('resolve_assets', async (state) => {
    const requests = state.artifacts.compilation?.entities || [];
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

  pipeline.register('compose_layout', async (state) => {
    if (state.reports.assetAdmission?.status==='rejected') {
      state.reports.layoutAdmission={status:'rejected',reason:'ASSET_ADMISSION_REJECTED',placements:[],issues:[]};
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
      state.reports.behaviorAdmission={status:'rejected',reason:'ASSET_ADMISSION_REJECTED',issues:[]};
      return state;
    }
    state.reports.behaviorAdmission=admitWorldBehavior(state.artifacts.behaviorBundle,{resolvedAssets:state.artifacts.assets||[],getManifest:(assetId)=>runtime.assets.getManifest(assetId)});
    return state;
  });

  pipeline.register('physics_admission', async (state) => {
    if(state.reports.assetAdmission?.status==='rejected'){
      state.reports.physicsAdmission={status:'rejected',reason:'ASSET_ADMISSION_REJECTED',backend:null,requirements:structuredClone(state.artifacts.physicsRequirements?.requirements||[]),issues:[]};
      return state;
    }
    state.reports.physicsAdmission=admitWorldPhysics(state.artifacts.physicsRequirements,{backend:runtime.physics?.backend||null,resolvedAssets:state.artifacts.assets||[],getManifest:(assetId)=>runtime.assets.getManifest(assetId)});
    return state;
  });

  pipeline.register('instantiate', async (state) => {
    const spawned = [];
    if (state.reports.assetAdmission?.status==='rejected' || state.reports.layoutAdmission?.status==='rejected' || state.reports.behaviorAdmission?.status==='rejected' || state.reports.physicsAdmission?.status==='rejected') {
      state.artifacts.spawned=spawned;
      return state;
    }
    for (const request of state.artifacts.assets || []) {
      if (!request.assetId) continue;
      const options={position:request.position || [0,0,0],id:request.id};
      if(request.initialState && Object.keys(request.initialState).length) options.initialState=structuredClone(request.initialState);
      const id = await runtime.spawn(request.assetId, options);
      spawned.push(id);
    }
    state.artifacts.spawned = spawned;
    return state;
  });

  pipeline.register('apply_relations', async (state) => {
    if (state.reports.assetAdmission?.status==='rejected' || state.reports.layoutAdmission?.status==='rejected' || state.reports.behaviorAdmission?.status==='rejected' || state.reports.physicsAdmission?.status==='rejected') return state;
    const applied=[],issues=[];
    state.reports.relationAdmission={status:'ready',applied,issues};
    for (const relation of state.artifacts.compilation?.relations || []) {
      if (relation.predicate === 'ON') {
        const result=runtime.interactions.place(relation.subject,relation.object,{surfaceId:relation.surfaceId});
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
        runtime.interactions.move(relation.subject,result.position);
        applied.push({...relation,position:result.position,distance:result.distance,mode:result.mode});
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
    if (state.reports.assetAdmission?.status==='rejected' || state.reports.layoutAdmission?.status==='rejected' || state.reports.behaviorAdmission?.status==='rejected' || state.reports.physicsAdmission?.status==='rejected' || state.reports.relationAdmission?.status==='rejected') {
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
    const layoutAdmission=state.reports.layoutAdmission || {status:'ready',placements:[],issues:[]};
    const relationAdmission=state.reports.relationAdmission || {status:'ready',applied:[],issues:[]};
    const behaviorAdmission=state.reports.behaviorAdmission || {status:'ready',issues:[]};
    const physicsAdmission=state.reports.physicsAdmission || {status:'ready',backend:null,requirements:[],issues:[]};
    const worldIR=state.artifacts.worldIR;
    const acceptanceGraph=state.artifacts.compilation?.acceptanceGraph || null;
    const upstreamAdmissionRejected=[assetAdmission,layoutAdmission,behaviorAdmission,physicsAdmission,relationAdmission]
      .some((admission)=>admission.status==='rejected');
    let worldAcceptance=null;
    runtime.lastAcceptanceBundle=null;
    delete state.artifacts.acceptanceEvidence;
    if(acceptanceGraph){
      if(upstreamAdmissionRejected){
        worldAcceptance={status:'not-evaluated',reason:'UPSTREAM_ADMISSION_REJECTED'};
        state.reports.worldAcceptance=structuredClone(worldAcceptance);
      } else {
        worldAcceptance=evaluateWorldAcceptance(runtime,acceptanceGraph,{unresolvedMutations:undefined});
        state.reports.worldAcceptance=worldAcceptance;
        const bundle=buildAcceptanceEvidenceBundle(acceptanceGraph,worldAcceptance,{worldRevisionId:worldIR?.revision?.id || null,source:'world-pipeline',provenance:worldIR?.provenance || null});
        state.artifacts.acceptanceEvidence=structuredClone(bundle);
        runtime.lastAcceptanceBundle=structuredClone(bundle);
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
        ...(behaviorAdmission.status==='rejected'&&behaviorAdmission.reason!=='ASSET_ADMISSION_REJECTED'?[behaviorAdmission.reason || behaviorAdmission.issues?.[0]?.code || 'BEHAVIOR_REJECTED']:[]),
        ...(physicsAdmission.status==='rejected'&&physicsAdmission.reason!=='ASSET_ADMISSION_REJECTED'?[physicsAdmission.reason || physicsAdmission.issues?.[0]?.code || 'PHYSICS_REJECTED']:[]),
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
      ...(layoutAdmission.reason==='ASSET_ADMISSION_REJECTED'?[]:compileAdmissionFindings(layoutAdmission,{stage:'layout',...admissionFindingOptions})),
      ...(behaviorAdmission.reason==='ASSET_ADMISSION_REJECTED'?[]:compileAdmissionFindings(behaviorAdmission,{stage:'behavior',...admissionFindingOptions})),
      ...(physicsAdmission.reason==='ASSET_ADMISSION_REJECTED'?[]:compileAdmissionFindings(physicsAdmission,{stage:'physics',...admissionFindingOptions})),
      ...compileAdmissionFindings(relationAdmission,{stage:'relation',...admissionFindingOptions}),
      ...(state.artifacts.acceptanceEvidence?.findings||[])
    ];
    if(status==='rejected'&&revisionFindings.length) state.artifacts.revisionContext=buildWorldRevisionContext(worldIR,revisionFindings);
    if(status!=='rejected'){
      runtime.currentBehaviorBundle=structuredClone(state.artifacts.behaviorBundle);
      runtime.currentPhysicsRequirements=structuredClone(state.artifacts.physicsRequirements);
      runtime.loadRuleGraph?.(state.artifacts.behaviorBundle.ruleGraph);
    }
    state.artifacts.scene = runtime.serialize({ name: worldIR?.intent?.name || 'Generated World' });
    return state;
  });

  return pipeline;
};

export function createCanonicalWorldPipeline(runtime){return createPipeline(runtime,compileWorldIR);}

// Backward-compatible boundary for direct callers that still submit WorldSpec.
export function createWorldPipeline(runtime){return createPipeline(runtime,compileWorldInput);}
