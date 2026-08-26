import { EmbodiedGenAdapter } from '../adapters/EmbodiedGenAdapter.js';
import { assetAdmission } from '../assets/admission.js';
import { WORLD_IR_TOOL_SCHEMA, WORLD_PLANNER_PROPOSAL_SCHEMA } from '../pipeline/WorldIRToolSchema.js';
import { buildWorldProposal } from '../pipeline/WorldPlannerProposal.js';
import { buildWorldRetryPlan } from '../pipeline/WorldRetry.js';
import { recompileWorldRevision } from '../pipeline/WorldRecompiler.js';
import { buildRecoveryProposals } from '../agent/buildRecoveryProposals.js';
import { compileInteractionIntent, executeBehaviorCommand, verifyBehaviorCommand } from '../runtime/behavior/BehaviorCompiler.js';
import { buildAcceptanceEvidenceBundle, compileWorldAcceptance, evaluateWorldAcceptance, replayAcceptanceEvidence } from '../validation/WorldAcceptance.js';
import { recordInteractionEvidence } from '../validation/InteractionEvidence.js';
import { sanitizeJobData } from '../jobs/GenerationJobProjection.js';

const string = { type: 'string' };
const number = { type: 'number' };
const vec3 = { type: 'array', items: number, minItems: 3, maxItems: 3 };
const meta = (description, permissions, required = [], properties = {}) => ({ description, permissions, required, properties });

const newWorldRevisionId=()=>{
  const id=globalThis.crypto?.randomUUID?.();
  if(!id){const error=new Error('Secure revision identity is unavailable');error.code='WORLD_PROPOSAL_ID_UNAVAILABLE';throw error;}
  return `world-${id}`;
};

const recordBehaviorEvidence = (runtime, command, result, source) => {
  const verification=verifyBehaviorCommand(command,result);
  const targetId=command.capability==='PLACE' ? command.supportId : command.targetId;
  recordInteractionEvidence(runtime,{
    targetId,capability:command.capability,verified:verification.verified===true,
    source,commandId:command.commandId,result
  });
  return verification;
};

const syncLiveVerification = (runtime, assetId, manifest) => {
  for (const record of runtime.store?.values?.() || []) {
    if (record.assetId !== assetId) continue;
    record.manifest.verification = structuredClone(manifest.verification || {});
    if (manifest.compiler?.quality && record.manifest.compiler) {
      record.manifest.compiler.quality = structuredClone(manifest.compiler.quality);
    }
    if (record.object?.userData?.manifest) {
      record.object.userData.manifest.verification = structuredClone(record.manifest.verification);
      if (record.manifest.compiler?.quality && record.object.userData.manifest.compiler) {
        record.object.userData.manifest.compiler.quality = structuredClone(record.manifest.compiler.quality);
      }
    }
  }
};

export function registerCoreSkills(registry, runtime) {
  const add = (name, options, handler) => registry.register({ name, ...options, handler });

  add('compileAsset', {
    ...meta('把 GLB 编译为可运行的 Agent 资产。', ['asset.write'], [], { url:string, sourceName:string, assetId:string, label:string, partProposal:{type:'object'}, partSegmentation:{type:'object'} }),
    validate: (input) => input?.url || input?.bytes ? { ok: true } : { ok: false, message: 'url or bytes required' }
  }, async (input) => {
    const compiler = await runtime.getAssetCompiler();
    const result = await compiler.compile(input);
    runtime.assets.registerManifest(result.manifest);
    runtime.events.emit('asset.compiled', { assetId: result.manifest.id, report: result });
    return result;
  });
  add('verifyAssetArticulation', { ...meta('在隔离的 Rapier World 中执行 Part/Joint 运动轨迹验证（目标、碰撞、停滞、回程），并把结果写回 Manifest。', ['asset.write', 'physics.read'], ['assetId'], { assetId: string }), mutates: false }, async (a) => {
    const report = await runtime.articulationVerifier.verify(a.assetId);
    const manifest = structuredClone(runtime.assets.getManifest(a.assetId));
    manifest.verification = { ...(manifest.verification || {}), articulation: report };
    const quality = manifest.compiler?.quality;
    if (quality) {
      quality.advisory = (quality.advisory || []).filter((item) => item.code !== 'ARTICULATION_UNVERIFIED');
      if (!report.ok) quality.advisory.push({ code: 'ARTICULATION_VERIFICATION_FAILED', message: '可执行 Part/Joint 未通过运行时运动轨迹验证。' });
      quality.status = quality.hard?.length ? 'rejected' : quality.advisory.length ? 'provisional' : 'ready';
    }
    runtime.assets.registerManifest(manifest, { replace: true });
    syncLiveVerification(runtime, a.assetId, manifest);
    const admission=assetAdmission(manifest);
    runtime.events.emit('asset.verified', { assetId: a.assetId, articulation: report, admission:admission.status });
    return { ...report, readiness: admission.status, admission };
  });
  add('inspectCompiledAsset', meta('读取已编译资产的编译报告。', ['asset.read'], ['assetId'], { assetId: string }), (a) => runtime.assets.getManifest(a.assetId).compiler || null);
  add('listAssets', meta('列出资产库。', ['asset.read']), () => runtime.assetLibrary.list());
  add('searchAssets', meta('按名称、类型、标签或别名搜索可复用资产。', ['asset.read'], ['query'], { query: string, limit: { type: 'integer', minimum: 1, maximum: 20 } }), (a) => runtime.assetLibrary.search(a.query, { limit: a.limit ?? 8 }));
  add('generateAsset', meta('使用已配置的生成后端创建并注册缺失资产；调用前应先搜索。生成结果可能是 asset-provisional，不能因此假定世界已验证。', ['asset.write'], ['prompt'], { prompt: string }), async (a) => {
    const result=await runtime.assetLibrary.generate(a.prompt);
    const status=result.admission?.status || 'provisional';
    return { ...result, status:`asset-${status}` };
  });
  const requireGeneration=()=>{
    if (!runtime.generation) {
      const error=new Error("Generation orchestration is unavailable");
      error.code="CONNECTION_REQUIRED";
      throw error;
    }
    return runtime.generation;
  };
  const validateGenerationPayload=(a,requireTarget=false)=>{
    if (requireTarget && !a.jobId && !(a.provider && a.operation)) return {ok:false,message:"jobId or provider+operation required"};
    try {
      for (const key of ["inputs","options","parent","retention","metadata"]) {
        if (a[key]!=null) sanitizeJobData(a[key],key);
      }
      return {ok:true};
    } catch { return {ok:false,message:"Generation request contains forbidden secret-like fields"}; }
  };
  add("listGenerationProviders", meta("列出可用于异步生成的 Provider；只返回安全的规范化能力摘要。", ["generation.read"], [], { availableOnly:{type:"boolean"} }), (a)=>requireGeneration().listGenerationProviders(a));
  add("listGenerationCapabilities", meta("列出规范化生成能力；不会暴露 Provider 私有 API、凭据或签名 URL。", ["generation.read"], [], { provider:string, category:string, availableOnly:{type:"boolean"} }), (a)=>requireGeneration().listGenerationCapabilities(a));
  add("submitGenerationJob", { ...meta("提交可能计费的异步生成 Job；立即返回本地 jobId/pending 状态，不等待 Provider 完成。", ["generation.submit"], ["provider","operation"], { provider:string, operation:string, inputs:{type:"object"}, profile:string, options:{type:"object"}, outputRoles:{type:"array",items:string}, parent:{type:"object"}, retention:{type:"object"}, metadata:{type:"object"}, idempotencyKey:string, requestHash:string }), batchable:false, validate:(a)=>validateGenerationPayload(a) }, (a)=>requireGeneration().submitGenerationJob(a));
  add("getGenerationJob", meta("读取并恢复异步生成 Job；provider-succeeded 只表示结果可导入，不等于 asset-ready。", ["generation.read"], ["jobId"], { jobId:string, cachedOnly:{type:"boolean"} }), (a)=>requireGeneration().getGenerationJob(a.jobId,{cachedOnly:a.cachedOnly===true}));
  add("cancelGenerationJob", { ...meta("请求取消外部生成 Job；不会回滚 Scene，也不会删除已经导入的 Artifact。", ["generation.cancel"], ["jobId"], { jobId:string }), batchable:false }, (a)=>requireGeneration().cancelGenerationJob(a.jobId));
  add("importGenerationResult", { ...meta("把 provider-succeeded Job 的 Artifact 经 hash/MIME/bytes 校验导入本地；artifact-imported 仍不等于 asset-ready。", ["generation.read","artifact.import"], ["jobId"], { jobId:string, artifactId:string, role:string }), batchable:false }, (a)=>requireGeneration().importGenerationResult(a.jobId,{artifactId:a.artifactId,role:a.role}));
  add("generateAndCompileAsset", { ...meta("异步生成资产的高层编排：可提交或恢复 Job；pending 时立即返回，结果可用后才导入 Artifact、Compiler 编译并经过 Admission。", ["generation.read","generation.submit","artifact.import","asset.write"], ["assetId"], { assetId:string, label:string, jobId:string, provider:string, operation:string, inputs:{type:"object"}, profile:string, options:{type:"object"}, outputRoles:{type:"array",items:string}, artifactId:string, artifactRole:string, idempotencyKey:string, requestHash:string }), batchable:false, validate:(a)=>validateGenerationPayload(a,true) }, (a)=>requireGeneration().generateAndCompileAsset(a));
  add('importEmbodiedGenAsset', meta('把 EmbodiedGen 风格资产规范化并注册到浏览器运行时；Adapter fallback 资产是 provisional，不等于 Compiler verified。', ['asset.write'], ['payload'], { payload: { type: 'object' }, id: string, glbUrl: string }), (a) => {
    const manifest = new EmbodiedGenAdapter().toManifest(a.payload, { id: a.id, glbUrl: a.glbUrl });
    runtime.assets.registerManifest(manifest);
    const admission=assetAdmission(manifest);
    runtime.events.emit('asset.registered', { assetId: manifest.id, provider: 'embodiedgen', admission:admission.status });
    return { ...runtime.assetLibrary.summary(manifest), admission, status:`asset-${admission.status}` };
  });

  add('listObjects', meta('列出当前世界中的对象及其位置和能力。', ['world.read']), () => runtime.listObjects());
  add('spawnAsset', { ...meta('实例化一个已注册资产。若资产 admission 不是 ready，仍可作为编辑态实例化，但返回 asset-provisional，不能当作 verified world mutation。', ['world.write'], ['assetId', 'position'], { assetId: string, position: vec3, instanceId: string }), mutates: true }, async (a) => {
    const admission=assetAdmission(runtime.assets.getManifest(a.assetId));
    if (admission.status==='rejected') return {status:'asset-rejected',assetId:a.assetId,admission};
    const id=await runtime.spawn(a.assetId,{position:a.position,id:a.instanceId});
    return admission.status==='ready' ? id : {status:'asset-provisional',id,assetId:a.assetId,admission};
  });
  add('moveObject', { ...meta('移动对象到世界坐标。', ['world.write'], ['id', 'position'], { id: string, position: vec3 }), mutates: true }, (a) => runtime.interactions.move(a.id, a.position));
  add('pickup', { ...meta('低层 Human/scene pickup 原语：对象跟随 Human Camera；具身 Agent 不应调用它，应使用 approachAndPickup。', ['world.write'], ['id'], { id: string }), batchable:false, mutates: true }, (a) => runtime.interactions.pickup(a.id));
  add('drop', { ...meta('低层 Human/scene drop 原语；具身 Agent 应使用 dropHeld。', ['world.write'], [], { id: string }), batchable:false, mutates: true }, (a) => runtime.interactions.drop(a.id));
  add('place', { ...meta('低层 Human/scene deterministic place 原语：直接移动对象到支撑面；具身 Agent 持有物体时应使用 approachAndPlace。', ['world.write'], ['id', 'targetId'], { id: string, targetId: string, surfaceId: string, clearance: { type: 'number', minimum: 0 } }), mutates: true }, (a) => runtime.interactions.place(a.id, a.targetId, { surfaceId: a.surfaceId, clearance: a.clearance }));
  add('open', { ...meta('低层 articulation motor request：只请求 open target；不要把返回当成关节已完成。具身 Agent 应使用 approachAndInteract 获得 live completion。', ['world.write'], ['id'], { id: string, partName: string }), batchable:false, mutates: true }, (a) => runtime.interactions.setArticulationAction(a.id, 'open', { partName: a.partName }));
  add('close', { ...meta('低层 articulation motor request：只请求 close target；不要把返回当成关节已完成。具身 Agent 应使用 approachAndInteract 获得 live completion。', ['world.write'], ['id'], { id: string, partName: string }), batchable:false, mutates: true }, (a) => runtime.interactions.setArticulationAction(a.id, 'close', { partName: a.partName }));
  add('duplicateObject', { ...meta('复制对象。', ['world.write'], ['id'], { id: string }), mutates: true }, (a) => runtime.duplicate(a.id));
  add('removeObject', { ...meta('删除对象。', ['world.write'], ['id'], { id: string }), mutates: true }, (a) => runtime.remove(a.id));

  add('getBounds', meta('获取对象的世界空间包围盒。', ['spatial.read'], ['id'], { id: string }), (a) => runtime.spatial.getBounds(a.id));
  add('findNearby', meta('查询对象附近的其他对象。', ['spatial.read'], ['id'], { id: string, radius: { type: 'number', minimum: 0 } }), (a) => runtime.spatial.findNearby(a.id, a.radius ?? 2));
  add('raycast', meta('向场景发射射线并返回命中对象。', ['spatial.read'], ['origin', 'direction'], { origin: vec3, direction: vec3, maxDistance: { type: 'number', minimum: 0 } }), (a) => runtime.spatial.raycast(a.origin, a.direction, a.maxDistance ?? 100));
  add('isColliding', meta('检查对象是否与其他对象重叠。', ['physics.read'], ['id'], { id: string, ignore: { type: 'array', items: string }, margin: number }), (a) => runtime.spatial.isColliding(a.id, { ignore: a.ignore ?? [], margin: a.margin ?? 0.01 }));
  add('findSupportSurface', meta('查询目标对象的支撑面。', ['spatial.read'], ['targetId'], { targetId: string, surfaceId: string }), (a) => {
    const surface = runtime.spatial.getSupportSurface(a.targetId, a.surfaceId);
    return surface ? { ...surface, center: surface.center.toArray().map((value) => Number(value.toFixed(3))) } : null;
  });
  add('findFreeSpace', meta('在支撑面上寻找无碰撞放置位置。', ['spatial.read'], ['id', 'targetId'], { id: string, targetId: string, surfaceId: string, clearance: { type: 'number', minimum: 0 } }), (a) => runtime.spatial.findFreeSpace(a.id, a.targetId, { surfaceId: a.surfaceId, clearance: a.clearance })?.toArray() ?? null);
  add('canReach', meta('基于 Recast/Detour 与当前 Rapier 动态障碍判断两个世界位置是否可达；与 findFreeSpace 不同，它回答连通性。', ['spatial.read'], ['start', 'end'], { start: vec3, end: vec3, maxSnapDistance: { type: 'number', minimum: 0 } }), (a) => runtime.navigation.canReach(a.start, a.end, { maxSnapDistance: a.maxSnapDistance }));
  add('findPath', meta('基于 Recast/Detour 与当前 Rapier 动态障碍计算路径、路径长度与端点吸附信息。', ['spatial.read'], ['start', 'end'], { start: vec3, end: vec3, maxSnapDistance: { type: 'number', minimum: 0 } }), (a) => runtime.navigation.findPath(a.start, a.end, { maxSnapDistance: a.maxSnapDistance }));
  add('suggestNavigationActions', meta('当当前路径不可达时，基于动态障碍 provenance 做只读反事实诊断；建议是 provisional，执行真实动作后必须重新 findPath。', ['spatial.read'], ['start', 'end'], { start:vec3, end:vec3, maxSnapDistance:{type:'number',minimum:0}, maxCandidates:{type:'integer',minimum:1,maximum:8} }), (a) => runtime.navigation.suggestActions(a.start, a.end, { maxSnapDistance:a.maxSnapDistance, maxCandidates:a.maxCandidates }));
  add('navigateTo', { ...meta('纯坐标导航：让 Agent Body 沿 Detour 路径真实行走到明确世界坐标；Rapier CharacterController 负责碰撞/台阶，直到 arrived 或 blocked 才返回。若目的是靠近对象并 open/close，不要把对象中心当终点，应直接使用 approachAndInteract。', ['world.write', 'spatial.read', 'physics.read'], ['id', 'end'], { id:string, end:vec3, speed:{type:'number',exclusiveMinimum:0,maximum:8} }), batchable:false, mutates:true }, (a) => runtime.locomotion.navigate(a.id, a.end, { speed:a.speed }));
  add('getLocomotionStatus', meta('读取 Agent Body 当前或最近一次 locomotion 状态。', ['world.read', 'physics.read'], ['id'], { id:string }), (a) => runtime.locomotion.status(a.id));
  add('findInteractionPose', meta('只读诊断/预览：按 Runtime 固定 1.5m 交互距离，为 Agent 与目标寻找满足 Detour 可达和 Rapier 视线的交互位；可选 action/partName 时排除 Agent 阻挡 articulation sweep 的位姿。若目标是实际走过去并 open/close，应直接调用 approachAndInteract，不要手工拆链。', ['spatial.read', 'physics.read'], ['actorId','targetId'], { actorId:string, targetId:string, action:{type:'string',enum:['open','close']}, partName:string }), (a) => runtime.interactions.findInteractionPose(a.actorId, a.targetId, { action:a.action, partName:a.partName }));
  add('approachAndInteract', { ...meta('具身 open/close 的首选单一工具：内部完成交互位搜索、真实 navigate、距离/物理视线/action-sweep 二次验证，再请求 motor target 并等待 live joint completion。只有 status=action-completed 且 targetReached=true/settled=true 才表示动作最终完成；STALL 返回 action-failed，TIMEOUT 返回 action-unverified。整个任务是一个 mutation。', ['world.write','spatial.read','physics.read'], ['actorId','targetId','action'], { actorId:string, targetId:string, action:{type:'string',enum:['open','close']}, partName:string, speed:{type:'number',exclusiveMinimum:0,maximum:8} }), batchable:false, mutates:true }, async (a) => {
    const command=compileInteractionIntent({id:`direct-${a.action}`,actorId:a.actorId,targetId:a.targetId,capability:a.action},{worldRevisionId:runtime.currentWorldRevision?.revision?.id});
    const result=await runtime.interactions.approachAndInteract(a.actorId,a.targetId,a.action,{partName:a.partName,speed:a.speed});
    recordBehaviorEvidence(runtime,command,result,'approachAndInteract');
    return result;
  });
  add('executeBehaviorCommand', { ...meta('执行由 BehaviorCompiler 编译出的 typed RuntimeCommand。当前纵向切片只允许 OPEN/CLOSE interaction；命令必须包含 actorId/targetId，并且最终结果仍需 action-completed + targetReached + settled 才算验证完成。', ['world.write','spatial.read','physics.read'], ['command'], { command:{type:'object'} }), batchable:false, mutates:true }, async (a) => {
    const command=compileInteractionIntent(a.command?.source ? { id:a.command.source.interactionId, actorId:a.command.actorId, targetId:a.command.targetId, capability:a.command.capability } : a.command?.intent || a.command, { worldRevisionId:a.command?.source?.worldRevisionId });
    const result=await executeBehaviorCommand(runtime,command);
    const verification=recordBehaviorEvidence(runtime,command,result,'executeBehaviorCommand');
    return {...result,behaviorCommand:command,verification};
  });
  add('evaluateWorldAcceptance', { ...meta('对当前世界执行显式 world-level acceptance criteria。只读；返回逐项证据和最终 world-accepted/world-incomplete。', ['world.read','physics.read'], ['criteria'], { criteria:{type:'array'} }), batchable:true, mutates:false }, async (a) => {
    const graph=compileWorldAcceptance(a.criteria || []);
    const task=runtime.lastTaskObservation || {};
    const result=evaluateWorldAcceptance(runtime,graph,{unresolvedMutations:Array.isArray(task.unresolvedMutations)?task.unresolvedMutations:undefined});
    const revision=runtime.currentWorldRevision;
    const bundle=buildAcceptanceEvidenceBundle(graph,result,{source:'agent-tool',worldRevisionId:revision?.revision?.id || null,provenance:revision?.provenance || null});
    runtime.lastAcceptanceBundle=structuredClone(bundle);
    runtime.trace?.emit?.('world.acceptance',{bundle:structuredClone(bundle)},{actor:'agent'});
    return {...result,acceptanceBundle:bundle};
  });
  add('replayWorldAcceptance', { ...meta('重新验证已保存的 acceptance evidence。restore 后的 evidence 仅是 historical；只有 revision 绑定一致且当前 Runtime 重跑 criteria 后仍为 world-accepted，才会生成新的 current acceptance bundle。', ['world.read','physics.read'], [], { evidence:{type:'object'} }), batchable:true, mutates:false }, async (a) => {
    const source=a.evidence || runtime.restoredAcceptanceEvidence || runtime.lastAcceptanceBundle;
    const task=runtime.lastTaskObservation || {};
    let replay;
    if(source){
      replay=replayAcceptanceEvidence(runtime,source,{unresolvedMutations:Array.isArray(task.unresolvedMutations)?task.unresolvedMutations:undefined});
    } else {
      const graph=compileWorldAcceptance([]);
      const result={schema:'agentscape.world-acceptance',schemaVersion:1,status:'world-incomplete',checks:[{id:'acceptance-evidence',kind:'evidence',verified:false,reason:'ACCEPTANCE_EVIDENCE_MISSING'}],verifiedCount:0,failedCount:1};
      const revision=runtime.currentWorldRevision;
      const bundle=buildAcceptanceEvidenceBundle(graph,result,{source:'acceptance-replay',worldRevisionId:revision?.revision?.id || null,provenance:revision?.provenance || null});
      replay={...result,replay:{status:'unavailable',reason:'ACCEPTANCE_EVIDENCE_MISSING',evidenceRevisionId:null,currentRevisionId:revision?.revision?.id || null,previousStatus:null,changedCriteria:['acceptance-evidence']},acceptanceBundle:bundle};
    }
    runtime.lastAcceptanceBundle=structuredClone(replay.acceptanceBundle);
    runtime.trace?.emit?.('world.acceptance-replayed',{replay:structuredClone(replay.replay),bundle:structuredClone(replay.acceptanceBundle)},{actor:'agent'});
    return replay;
  });
  add('getArticulationStatus', meta('读取 articulated object 的 live joint 状态：当前 coordinate、requestedAction、verifiedAction，以及 moving/completed/failed/unverified observer 结果。STALL 若有当前 Rapier contact，会附 contact-evidence blockerCandidates；它表示失败时正在接触，不证明唯一因果。不会把 motor request 当成完成。', ['world.read','physics.read'], ['id'], { id:string, partName:string }), (a) => runtime.interactions.articulationStatus(a.id,a.partName));
  add('recoverPickupBlocker', { ...meta('执行一个窄范围的 articulated STALL recovery：仅当 blocker 仍是当前 external contact candidate、Policy 允许且具身 pickup preflight 仍通过时，才真实 approachAndPickup。它是辅助 mutation；成功只表示 blocker 被 held，不表示原始 open/close 已恢复，之后必须 retry 原始 action。', ['world.write','spatial.read','physics.read'], ['actorId','targetId','blockerId'], { actorId:string,targetId:string,partName:string,blockerId:string }), batchable:false,auxiliary:true,mutates:true }, async (a,{registry,context}) => {
    const recovery=await buildRecoveryProposals(runtime,registry,{actorId:a.actorId,targetId:a.targetId,partName:a.partName,profile:context.profile || 'builder'});
    const proposal=recovery.proposals.find((item)=>item.eligible && item.blocker?.kind==='object' && item.blocker.objectId===a.blockerId);
    if (!proposal) return {status:'recovery-stale',reason:recovery.proposals.find((item)=>item.blocker?.objectId===a.blockerId)?.reason || recovery.reason || 'RECOVERY_NOT_ELIGIBLE',actorId:a.actorId,targetId:a.targetId,blockerId:a.blockerId,retryOriginal:true};
    const pickup=await runtime.interactions.approachAndPickup(a.actorId,a.blockerId);
    if (pickup.status==='held') runtime.interactions.markRecoveryHeld(a.actorId,{
      blockerId:a.blockerId,targetId:a.targetId,partName:proposal.verification?.args?.partName || a.partName,
      action:proposal.verification?.args?.action || recovery.originalAction
    });
    return {...pickup,recovery:{kind:'pickup-blocker',blockerId:a.blockerId,evidence:proposal.evidence},retryOriginal:true,verification:proposal.verification};
  });
  add('recoverArticulatedBlocker', { ...meta('执行一个窄范围 articulated-Part blocker recovery：仅当该 blocker Part 仍是当前 contact candidate、当前 verified state 明确，且 Runtime 已通过唯一 alternate 或 counterfactual ranking 选出 blockerAction、Policy 与 interaction preflight 仍通过时，才真实 approachAndInteract 改变 blocker Part。它是 auxiliary mutation；成功只验证 blocker Part 改态，原始失败动作仍必须 fresh-replan 后 retry。', ['world.write','spatial.read','physics.read'], ['actorId','targetId','blockerId','blockerPartName','blockerAction'], {actorId:string,targetId:string,partName:string,blockerId:string,blockerPartName:string,blockerAction:{type:'string',enum:['open','close']},speed:{type:'number',exclusiveMinimum:0,maximum:8}}), batchable:false,auxiliary:true,mutates:true }, async(a,{registry,context})=>{
    const recovery=await buildRecoveryProposals(runtime,registry,{actorId:a.actorId,targetId:a.targetId,partName:a.partName,profile:context.profile || 'builder'});
    const proposal=recovery.proposals.find((item)=>
      item.eligible && item.recovery==='articulated-blocker'
      && item.blocker?.objectId===a.blockerId && item.blocker?.partName===a.blockerPartName
      && item.blockerAction===a.blockerAction
    );
    if (!proposal) {
      const current=recovery.proposals.find((item)=>item.blocker?.objectId===a.blockerId && item.blocker?.partName===a.blockerPartName);
      const selectionChanged=Boolean(current?.eligible && current.recovery==='articulated-blocker' && current.blockerAction && current.blockerAction!==a.blockerAction);
      return {
        status:'recovery-stale',
        reason:selectionChanged?'COUNTERFACTUAL_SELECTION_CHANGED':(current?.reason || recovery.reason || 'RECOVERY_NOT_ELIGIBLE'),
        actorId:a.actorId,targetId:a.targetId,blockerId:a.blockerId,blockerPartName:a.blockerPartName,blockerAction:a.blockerAction,
        ...(selectionChanged?{currentRecommendedAction:current.blockerAction}:{}),retryOriginal:true
      };
    }
    const interaction=await runtime.interactions.approachAndInteract(a.actorId,a.blockerId,a.blockerAction,{partName:a.blockerPartName,speed:a.speed});
    let counterfactualCalibration=null;
    const selectedEvidence=proposal.actionRanking?.actions?.find((item)=>item.action===a.blockerAction)?.physicsCounterfactual || null;
    const blockerActionVerified=interaction.status==='action-completed' && interaction.targetReached===true && interaction.settled===true;
    if (selectedEvidence?.checked && blockerActionVerified && typeof runtime.physics?.articulationContacts==='function') {
      const originalPartName=proposal.verification?.args?.partName || a.partName;
      const contacts=runtime.physics.articulationContacts(a.targetId,originalPartName) || [];
      const currentContactStillPresent=contacts.some((contact)=>{
        const target=contact?.target || {};
        return contact?.external===true && target.kind==='object' && target.objectId===a.blockerId
          && (target.partName || '$root')===a.blockerPartName;
      });
      const predictedClear=selectedEvidence.targetSweepClear===true;
      counterfactualCalibration={
        status:'observed',scope:'post-recovery-current-contact',causal:false,
        prediction:{
          strategy:proposal.actionRanking.strategy,basis:proposal.actionRanking.basis,
          targetSweepClear:predictedClear,
          targetConflictSamples:selectedEvidence.target?.conflictSamples ?? null,
          conflictReduction:selectedEvidence.conflictReduction ?? null,
          samples:structuredClone(selectedEvidence.samples || null)
        },
        observed:{blockerActionVerified:true,currentContactStillPresent},
        consistency:predictedClear ? (currentContactStillPresent?'contradicted':'consistent') : 'not-comparable',
        originalRetryRequired:true
      };
    }
    return {
      ...interaction,
      recovery:{kind:'articulated-blocker',blockerId:a.blockerId,blockerPartName:a.blockerPartName,blockerAction:a.blockerAction,evidence:proposal.evidence},
      ...(counterfactualCalibration?{counterfactualCalibration}:{}),
      retryOriginal:true,verification:proposal.verification
    };
  });
  add('suggestRecoveryCleanup', meta('只读为当前通过 recoverPickupBlocker 持有的 blocker 规划安全 cleanup。候选必须由 Rapier 向下射线找到 Environment 支撑、位于原 articulation action sweep 外、Agent 可达且 carried-body endpoint clear。Proposal 不修改世界。', ['world.read','spatial.read','physics.read'], ['actorId','targetId'], {actorId:string,targetId:string,partName:string,blockerId:string,action:{type:'string',enum:['open','close']}}), (a)=>runtime.interactions.findRecoveryCleanupPlan(a.actorId,a.targetId,{partName:a.partName,blockerId:a.blockerId,action:a.action}));
  add('cleanupRecoveryBlocker', { ...meta('对当前 recovery-held blocker 执行 verified cleanup：真实导航到 cleanup pose，经共享三段 Rapier body-motion transfer 释放为 Dynamic，等待 settle，并验证 blocker 已释放、离开原 action sweep 且不再接触失败 Part。recovery-cleaned 只表示 cleanup 成功，不表示原始任务成功。', ['world.write','spatial.read','physics.read'], ['actorId','targetId','blockerId'], {actorId:string,targetId:string,partName:string,blockerId:string,action:{type:'string',enum:['open','close']},speed:{type:'number',exclusiveMinimum:0,maximum:8}}), batchable:false,auxiliary:true,mutates:true }, async(a)=>{
    const result=await runtime.interactions.cleanupRecoveryBlocker(a.actorId,a.targetId,{partName:a.partName,blockerId:a.blockerId,action:a.action,speed:a.speed});
    if (result.status==='cleanup-unavailable') return {status:'recovery-cleanup-blocked',reason:result.reason || 'CLEANUP_UNAVAILABLE',actorId:a.actorId,targetId:a.targetId,blockerId:a.blockerId,plan:result};
    return result;
  });
  add('suggestRecoveryActions', meta('针对最近一次 articulated STALL 只读生成恢复候选。对当前仍接触的 blocker 做 typed recovery eligibility：Dynamic root Object 可走 pickup recovery，具有 verified current state 且唯一 alternate open/close 的 articulated Part 可走 articulated recovery；Environment、stale/ambiguous/Policy denied 均明确拒绝。Recovery proposal 不是成功，执行后必须 retry 原始 action 并重新验证 post-condition。', ['world.read','physics.read'], ['actorId','targetId'], { actorId:string,targetId:string,partName:string }), (a,{registry,context}) => buildRecoveryProposals(runtime,registry,{actorId:a.actorId,targetId:a.targetId,partName:a.partName,profile:context.profile || 'builder'}));
  add('approachAndPickup', { ...meta('具身 pickup：Agent 先走到固定 1.5m 交互位并复核 Rapier LOS，再对对象到 hold anchor 做 shape-sweep；成功后记录 heldBy 并以 kinematic anchor 携带。不是 grasp force verification。', ['world.write','spatial.read','physics.read'], ['actorId','targetId'], { actorId:string, targetId:string, speed:{type:'number',exclusiveMinimum:0,maximum:8} }), batchable:false, mutates:true }, async (a) => {
    const command=compileInteractionIntent({id:'direct-pickup',actorId:a.actorId,targetId:a.targetId,capability:'PICKUP'},{worldRevisionId:runtime.currentWorldRevision?.revision?.id});
    const result=await runtime.interactions.approachAndPickup(a.actorId,a.targetId,{speed:a.speed});
    recordBehaviorEvidence(runtime,command,result,'approachAndPickup');
    return result;
  });
  add('approachAndPlace', { ...meta('具身 place 的首选单一工具：被放置物由 actor 当前 held ownership 自动推导，不要传 held object id。supportId 是接收物体的支撑对象 ID（例如 table_01）；surfaceId 只是该支撑对象 Manifest 中可选的 surface 名（例如 top），绝不是对象 ID。内部完成 carry-aware approach、三段 Rapier shape-cast release、Dynamic settle 与 ON/SUPPORTS post-condition。只有 status=placed 且 supportVerified=true 才表示最终放置成功。', ['world.write','spatial.read','physics.read'], ['actorId','supportId'], { actorId:{type:'string',description:'持有物体的 Agent ID，例如 agent_01'}, supportId:{type:'string',description:'接收放置物的支撑对象 ID，例如 table_01；不要填 cup_01'}, surfaceId:{type:'string',description:'可选 surface 名，例如 top；不要填对象 ID'}, speed:{type:'number',exclusiveMinimum:0,maximum:8} }), batchable:false, mutates:true }, async (a) => {
    const command=compileInteractionIntent({id:'direct-place',actorId:a.actorId,supportId:a.supportId,capability:'PLACE'},{worldRevisionId:runtime.currentWorldRevision?.revision?.id});
    const result=await runtime.interactions.approachAndPlace(a.actorId,a.supportId,{surfaceId:a.surfaceId,speed:a.speed});
    recordBehaviorEvidence(runtime,command,result,'approachAndPlace');
    return result;
  });
  add('dropHeld', { ...meta('释放 Agent 当前 kinematic-anchor held object，恢复其原始 Physics body type。', ['world.write','physics.read'], ['actorId'], { actorId:string }), batchable:false, mutates:true }, (a) => runtime.interactions.dropHeld(a.actorId));
  add('getCarryStatus', meta('读取 Agent 当前 held-object ownership；held 只表示 kinematic-anchor attachment，不等于 graspVerified。', ['world.read','physics.read'], ['actorId'], { actorId:string }), (a) => runtime.interactions.carryStatus(a.actorId));
  add('getNavigationStatus', meta('读取 NavMesh 派生状态、构建版本与 Agent 导航配置。', ['spatial.read']), () => runtime.navigation.status());
  add('listRelations', meta('查询 ON、NEAR、INSIDE 等语义空间关系。', ['spatial.read'], [], { subject: string, predicate: string, object: string }), (a) => { runtime.sceneGraph.update(); return runtime.sceneGraph.list(a); });
  add('describeObjectRelations', meta('查询一个对象的全部语义空间关系。', ['spatial.read'], ['id'], { id: string }), (a) => { runtime.sceneGraph.update(); return runtime.sceneGraph.describe(a.id); });

  add('validateWorld', meta('执行确定性的几何、物理与关系校验。', ['world.read', 'physics.read']), () => runtime.validator.run());
  add('repairWorld', { ...meta('修复硬错误，并拒绝使结果更差的修复。', ['world.write', 'physics.read'], [], { report: { type: 'object' }, maxRepairs: { type: 'integer' } }), mutates: true }, (a) => runtime.repair.repair(a.report || runtime.validator.run(), { maxRepairs: a.maxRepairs ?? 20 }));
  add('getTrace', meta('读取近期引擎审计事件。', ['world.read'], [], { type: string, actor: string, sinceSeq: { type: 'integer' }, limit: { type: 'integer' } }), (a) => runtime.trace.list(a));
  add('verifyTrace', meta('验证审计事件链的一致性。', ['world.read']), () => runtime.trace.verify());

  add('executeBatch', { ...meta('把可同步回滚的 scene/world edits 作为一个原子批次执行；具身长动作、导航和 request-only articulation 不允许进入 batch。任一调用失败或返回 blocked/failed/unverified/requested 则回滚。', ['world.write'], ['calls'], { calls: { type: 'array', items: { type: 'object' } } }), batchable:false, mutates:true }, async (a, { context }) => {
    for (const call of a.calls) {
      const policy = registry.executionPolicy(call.name);
      if (!policy.batchable) return { committed:false, rolledBack:false, reason:'UNBATCHABLE_SKILL', skill:call.name, results:[] };
    }
    const before = runtime.snapshot();
    const results = [];
    for (const call of a.calls) {
      const result = await registry.invoke(call.name, call.args || {}, { ...context, skipHistory: true });
      const policy = registry.executionPolicy(call.name, result.result);
      results.push({ name:call.name, ...result, outcome:policy.outcome });
      if (!result.success || !policy.batchAcceptable) {
        await runtime.restore(before);
        return { committed:false, rolledBack:true, reason:result.success ? 'SEMANTIC_STEP_NOT_VERIFIED' : 'SKILL_ERROR', results };
      }
    }
    runtime.sceneGraph.changed();
    return { committed:true, rolledBack:false, results };
  });

  add('recompileWorldRevision', { ...meta('接受一个 bounded WorldRevision proposal，并在显式 acceptChangedPlan=true 后替换当前 world、重新执行完整 canonical pipeline 与 fresh verification/acceptance。proposal/gate 在任何 Runtime mutation 前校验；新 revision rejected 或执行异常时恢复原 scene。', ['world.write','asset.read','asset.write','physics.read'], ['baseWorldIR','proposal','acceptChangedPlan'], { baseWorldIR:{type:'object'}, proposal:{type:'object'}, acceptChangedPlan:{type:'boolean'} }), batchable:false, mutates:true }, async (a) => {
    return recompileWorldRevision(runtime,{baseWorldIR:a.baseWorldIR,proposal:a.proposal,acceptChangedPlan:a.acceptChangedPlan===true});
  });


  add('proposeWorldIR', meta('把 Planner 的世界语义提案封装为 Runtime-issued revision/provenance，并执行 strict normalize/reference/canonical compile 预检；不修改 Scene。只有 status=world-proposal-ready 的 worldIR 才应提交 runWorldPipeline。模型不能自行指定 revision/provenance/parent lineage。', [], ['proposal'], { proposal:WORLD_PLANNER_PROPOSAL_SCHEMA }), (a,{context}) => {
    const lineage=context?.worldProposalLineage || {};
    return buildWorldProposal(a.proposal,{
      revisionId:newWorldRevisionId(),
      parentRevisionId:lineage.parentRevisionId,
      reason:lineage.reason,
      evidenceRefs:lineage.evidenceRefs
    });
  });

  add('runWorldPipeline', { ...meta('提交 strict World IR v1 到 canonical compiler：统一解析资产、Behavior、Physics、Acceptance，再实例化、校验、修复并序列化。Agent 只执行 proposeWorldIR 已颁发的 revision/provenance；不支持的语义 fail-closed。若唯一 rejection 是可生成的 search miss，Runtime 最多自动重跑一次，只为缺失 asset 开启 generation。world-ready 才视为 verified；world-provisional 不冒充验证；world-rejected 恢复调用前 scene。', ['world.write', 'asset.read', 'asset.write', 'physics.read'], ['plan'], { plan: WORLD_IR_TOOL_SCHEMA }), mutates: true }, async (a) => {
    const before=runtime.snapshot();
    const budget=2,attempts=[];
    let plan=a.plan;
    for (let attempt=1;attempt<=budget;attempt++) {
      const pipeline=await runtime.worldPipeline.run(plan);
      const admission=pipeline.state?.reports?.worldAdmission;
      if (!admission) return pipeline;
      const record={attempt,admission:structuredClone(admission)};
      attempts.push(record);
      if (admission.status!=='rejected') {
        return {status:`world-${admission.status}`,admission,pipeline,attempts,retry:attempts.length>1?attempts.at(-2).retry:null};
      }
      await runtime.restore(before);
      const retry=buildWorldRetryPlan(pipeline,{
        generatorConfigured:runtime.assetLibrary?.generator?.isConfigured?.()===true,
        attempt,budget
      });
      record.retry=retry;
      if (retry.status!=='retry-proposed') {
        return {status:'world-rejected',reason:admission.reasons?.[0] || 'WORLD_REJECTED',rolledBack:true,admission,pipeline,attempts,retry};
      }
      plan=retry.nextIR || retry.nextPlan;
    }
    throw new Error('World retry loop exceeded its fixed budget');
  });
  return registry;
}
