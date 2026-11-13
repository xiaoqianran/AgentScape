import * as z from 'zod/v4';
import { allowedSkills } from './HeadlessWorldHost.js';
import { compileWorldAcceptance } from '../../modules/world/verification/WorldAcceptance.js';
import { definitionSchema, proceduralContract } from '../../application/programmatic-assets/ProgrammaticAssetContract.js';
import { assetAdmission } from '../../modules/asset/model/admission.js';
const id=z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const targetId=z.string().min(1).max(256);
const vec=z.array(z.number().finite().min(-100).max(100)).length(3);
const speed=z.number().positive().max(8).optional();
export const actionSchemas={
 spawnAsset:z.object({assetId:id,position:vec,instanceId:id.optional()}).strict(),
 moveObject:z.object({id,position:vec}).strict(),
 replaceAsset:z.object({id,assetId:id}).strict(),
 navigateTo:z.object({id,end:vec,speed}).strict(),
 approachAndInteract:z.object({actorId:id,targetId:id,action:z.enum(['open','close']),partName:id.optional(),speed}).strict(),
 approachAndPickup:z.object({actorId:id,targetId:id,speed}).strict(),
 approachAndPlace:z.object({actorId:id,supportId:id,surfaceId:id.optional(),speed}).strict()
};
export function registerTools(server,manager,owner,assets,studioBridge=null) {
 const session={worldSessionId:z.uuid()};
 const sceneSession={worldSessionId:z.uuid().optional()};
 const add=(name,description,shape,fn)=>server.registerTool(name,{description,inputSchema:z.object(shape).strict()},async(a,extra)=>{
  try { const result=await fn(a,extra); return {content:[{type:'text',text:JSON.stringify(result)}]}; }
  catch(e) { const code=e instanceof z.ZodError?'INVALID_ARGUMENTS':/^[A-Z_]+$/.test(e.code || '')?e.code:/^[A-Z_]+$/.test(e.message)?e.message:'RUNTIME_ERROR'; return {isError:true,content:[{type:'text',text:JSON.stringify({state:'failed',code})}]}; }
 });
 add('studio_pair_create','Create a short-lived one-time pairing code for an explicitly approved local Studio world. The bearer token is never delivered to the browser.',{},()=>studioBridge.pair(owner));
 add('studio_session_status','Check a Studio connection, or inspect the automatically connected local world without passing an ID.',sceneSession,a=>a.worldSessionId?studioBridge.status(owner,a.worldSessionId):studioBridge.currentSession(owner));
 add('session_attach','Attach the local current Studio automatically or resolve an explicit paired world.',sceneSession,a=>{
  const state=a.worldSessionId?studioBridge.status(owner,a.worldSessionId):studioBridge.currentSession(owner);
  if(!state.connected)throw new Error('STUDIO_DISCONNECTED');
  return state;
 });
 add('studio_session_close','Revoke the paired Studio capability and reject outstanding Scene requests.',{worldSessionId:z.uuid()},a=>studioBridge.close(owner,a.worldSessionId));
 add('session_create','Create a private offline monument-hall world with agent, cabinet, cup and table.',{template:z.literal('monument-hall').default('monument-hall')},()=>manager.create(owner));
 add('session_status','Read world session lifecycle.',session,a=>manager.status(owner,a.worldSessionId));
 add('session_close','Cancel work and release your world.',session,a=>manager.close(owner,a.worldSessionId));
 add('asset_build_submit','Submit versioned createAsset(THREE) source to the configured code executor. Optional definition enables physical admission; inspect execution and physics evidence separately.',{contract:z.literal(proceduralContract),source:z.string().min(1).max(32768),definition:definitionSchema.optional(),requestId:z.uuid(),forceRebuild:z.boolean().default(false)},a=>assets.submit(owner,a));
 add('asset_build_status','Read your build status, immutable asset version, admission or diagnostic code.',{buildId:z.uuid()},a=>assets.status(owner,a.buildId));
 add('asset_build_cancel','Cancel your build and terminate its execution Worker or container.',{buildId:z.uuid()},a=>assets.cancel(owner,a.buildId));
 add('asset_publish','Publish a successful immutable asset for your worlds. Provisional requires explicit editing-state opt-in.',{buildId:z.uuid(),allowProvisional:z.boolean().default(false)},a=>assets.publish(owner,a.buildId,a.allowProvisional));
 add('asset_inspect','Inspect your asset, original source (optional), hashes, Manifest and runtime verification evidence.',{assetId:id,includeSource:z.boolean().default(false)},a=>assets.inspect(owner,a.assetId,a.includeSource));
 add('asset_list','List your published asset versions, paginated.',{offset:z.number().int().min(0).max(128).default(0),limit:z.number().int().min(1).max(20).default(20)},async a=>{const all=await assets.repository.list(owner);return {assets:all.slice(a.offset,a.offset+a.limit),total:all.length,nextOffset:a.offset+a.limit<all.length?a.offset+a.limit:null};});
 const run=(a,fn,extra)=>manager.run(owner,a.worldSessionId,fn,{signal:extra?.signal});
 const sceneRun=async(a,method,args,fn,extra)=>{
  const target=a.worldSessionId || studioBridge.currentSession(owner).worldSessionId;
  if(studioBridge?.isStudioSession(target)) {
   studioBridge.ownerSession(owner,target);
   const ref=args.model?.asset;
   if(method==='addModel' && typeof ref==='string' && /^asset:\/\/sha256\/[a-f0-9]{64}$/.test(ref)) {
    const published=await assets.repository.get(owner,`pa_${ref.slice('asset://sha256/'.length)}`,{published:true});
    const {id}=published.manifest;
    const definition=Object.fromEntries(['type','label','actions','physics','parts','surfaces','receptacles','requiredNodes','interactionContract','capabilityLevel'].filter(key=>published.manifest[key]!=null).map(key=>[key,published.manifest[key]]));
    args={...args,model:{...args.model,asset:{kind:'compiled-code',id,bytesBase64:Buffer.from(published.bytes).toString('base64'),definition}}};
   }
   return studioBridge.call(owner,target,method,args,{signal:extra?.signal,requestId:a.requestId});
  }
  return manager.run(owner,target,fn,{signal:extra?.signal,
    ...(a.requestId?{requestId:a.requestId,fingerprint:JSON.stringify([method,args])}:{})});
 };
 const attachSceneAssets=async(s,references)=>{
  for(const ref of references) if(typeof ref==='string' && /^asset:\/\/sha256\/[a-f0-9]{64}$/.test(ref)) {
   const hash=ref.slice('asset://sha256/'.length), assetId=`pa_${hash}`;
   if(!s.host.world.assetModule.hasAsset(`asset_${hash}`) && !s.host.world.assetModule.hasAsset(assetId)) {
    await assets.repository.get(owner,assetId,{published:true});
    await assets.repository.attach(owner,s.host.world.assetModule,[assetId]);
   }
  }
 };
 add('studio_project','Create, edit, run, save and reopen complete trusted code worlds in the active Studio workbench. Read first for source, revision and createProject API guide. file/file_read edit named JavaScript and shader files, resource imports embedded binary resources. write saves a draft; patch applies a unique exact-fragment edit with expectedRevision; run activates it; save persists live state and assets. Not a sandbox. Use scene_observe/interact for dynamic actions.',{
  ...sceneSession, operation:z.enum(['read','write','patch','file_read','file','resource','run','save','open','close']), requestId:z.uuid().optional(),
  create:z.boolean().optional(), source:z.string().min(1).optional(), name:z.string().min(1).optional(),
  oldText:z.string().min(1).optional(), newText:z.string().optional(),
  action:z.enum(['create','write','patch','rename','delete','add']).optional(), path:z.string().min(1).max(180).optional(),
  newPath:z.string().max(180).optional(), content:z.string().optional(), mime:z.string().optional(), base64:z.string().optional(),
  offset:z.number().int().min(0).optional(), limit:z.number().int().min(1).max(65536).optional(),
  expectedRevision:z.number().int().nonnegative().optional(), id:z.string().optional(), project:z.record(z.string(),z.unknown()).optional()
 },(a,e)=>{
  const {worldSessionId,requestId,...args}=a;
  return sceneRun(a,'project',args,()=>{throw new Error('STUDIO_PROJECTS_UNAVAILABLE');},e);
 });
 const decodeModel=model=>{
  if(model?.asset?.kind!=='glb') return model;
  const source=z.object({kind:z.literal('glb'),name:z.string().min(1).max(128).optional(),bytesBase64:z.string().min(1).max(45*1024*1024),urdfBase64:z.string().min(1).max(2*1024*1024).optional(),review:z.record(z.string(),z.unknown()).optional()}).strict().parse(model.asset);
  const decode=text=>{const bytes=Buffer.from(text,'base64');if(bytes.toString('base64')!==text) throw new Error('INVALID_RESOURCE_ENCODING');return new Uint8Array(bytes);};
  return {...model,asset:{kind:'glb',bytes:decode(source.bytesBase64),...(source.name?{name:source.name}:{}),...(source.urdfBase64?{urdfBytes:decode(source.urdfBase64)}:{}),...(source.review?{review:source.review}:{})}};
 };
 const authoringAction=(a,skill,args,e)=>manager.run(owner,a.worldSessionId,(s,signal)=>s.host.execute(skill,args,signal),{requestId:a.requestId,fingerprint:JSON.stringify([skill,args]),signal:e.signal});
 add('authoring_execute','Build static Three.js draft in a bounded isolated WASM runtime. Supports THREE, scene, clear; no network, imports, runtime callbacks or model references. Nothing enters physics until explicitly promoted.',{...session,code:z.string().min(1).max(32768),label:z.string().max(100).default('AI 创作'),requestId:z.uuid()},(a,e)=>authoringAction(a,'runAuthoringCode',{code:a.code,label:a.label},e));
 add('authoring_observe','List draft node IDs, prepared assets, world entities and admission/verification states.',session,(a,e)=>run(a,s=>s.host.tools.call('listAuthoringNodes',{}),e));
 const selection={...session,nodeId:id,usage:z.enum(['static','movable']),requestId:z.uuid()};
 add('authoring_prepare','Compile one draft subtree as a local asset. Provisional admission is reported honestly; preparation does not insert an entity.',selection,(a,e)=>authoringAction(a,'prepareAuthoringAsset',{nodeId:a.nodeId,usage:a.usage},e));
 for(const [name,skill] of [['authoring_promote','promoteAuthoringNode'],['authoring_update','updateAuthoringEntity']]) {
  add(name,'Install or explicitly update one prepared draft entity through world commands. allowProvisional opts into editing state, never verified admission.',{...selection,allowProvisional:z.boolean().default(false)},(a,e)=>authoringAction(a,skill,{nodeId:a.nodeId,usage:a.usage,allowProvisional:a.allowProvisional},e));
 }
 add('authoring_verify','Check entity physics and navigation. Unexercised interaction remains unverified; use action_execute to exercise it.',{...session,nodeId:id},(a,e)=>run(a,s=>s.host.tools.call('verifyAuthoringEntity',{nodeId:a.nodeId}),e));
 add('authoring_export','Save original successful code revisions, editable draft and promotion links. Does not bundle compiled assets or import a world.',session,(a,e)=>run(a,s=>manager.exportAuthoring(s),e));
 add('world_observe','Observe bounded objects and physical relations.',{...session,offset:z.number().int().min(0).max(64).default(0),limit:z.number().int().min(1).max(50).default(25)},(a,e)=>run(a,s=>({worldSessionId:s.id,execution:s.host.world.mutationOwner?'running':'idle',...s.host.observe(a.offset,a.limit)}),e));
 add('object_inspect','Inspect a real object and articulation evidence.',{...session,id},(a,e)=>run(a,s=>s.host.inspect(a.id),e));
 add('skills_list','List audited remote actions and their argument schemas.',session,(a,e)=>run(a,()=>allowedSkills.map(name=>({name,inputSchema:z.toJSONSchema(actionSchemas[name])})),e));
 add('action_execute','Execute an audited skill. Transport success is not physical verification.',{...session,skill:z.enum(allowedSkills),args:z.record(z.string(),z.unknown()),requestId:z.uuid()},(a,e)=>{
  const args=actionSchemas[a.skill].parse(a.args);
  return manager.run(owner,a.worldSessionId,async(s,signal)=>{
   if(['spawnAsset','replaceAsset'].includes(a.skill)&&args.assetId.startsWith('pa_')){
    const asset=await assets.repository.get(owner,args.assetId,{published:true});
    if(assetAdmission(asset.manifest).status!=='ready')throw new Error('ASSET_NOT_READY');
    await assets.repository.attach(owner,s.host.world.assetModule,[args.assetId]);
   }
   return s.host.execute(a.skill,args,signal);
  },{requestId:a.requestId,fingerprint:JSON.stringify([a.skill,args]),signal:e.signal});
 });
 const check=z.object({id,kind:z.enum(['world-valid','object-exists','state-equals','interaction-verified','relation-exists','no-unresolved']),targetId:targetId.optional(),stateKey:id.optional(),value:z.union([z.string().max(200),z.number().finite(),z.boolean(),z.null()]).optional(),capability:id.optional(),subject:targetId.optional(),predicate:z.enum(['ON','NEAR','INSIDE','CONTAINS','SUPPORTS']).optional(),object:targetId.optional(),objectAnyOf:z.array(targetId).min(1).max(32).optional(),surfaceId:id.optional()}).strict();
 add('world_verify','Verify caller-supplied criteria using Runtime evidence. With no criteria, runs the original cabinet/cup preset.',{...session,criteria:z.array(check).min(1).max(32).optional()},(a,e)=>{if(a.criteria) compileWorldAcceptance(a.criteria); return run(a,s=>s.host.verify(a.criteria),e);});
 add('world_export','Atomically save and return SceneSerializer JSON; assets are not bundled.',session,(a,e)=>run(a,s=>manager.export(s),e));
 add('world_save','Save an owned world and immutable published asset dependencies for recovery after service restart.',session,(a,e)=>run(a,s=>manager.save(owner,s),e));
 add('world_restore','Create a new private session from your server-issued save ID. Verifies all hashes and restores via SceneSerializer; historical action evidence is not reused.',{saveId:z.uuid(),requestId:z.uuid()},a=>manager.restore(owner,a.saveId,a.requestId));
 add('scene_observe','Observe a target, the full scene, or a lightweight paginated object list. Use limit and offset to avoid global relations and affordance expansion.',{...sceneSession,target:z.string().min(1).max(256).optional(),actor:id.optional(),offset:z.number().int().nonnegative().max(1000000).optional(),limit:z.number().int().min(1).max(1000).optional()},(a,e)=>{
  if(a.target && (a.offset!=null||a.limit!=null))throw new Error('SCENE_OBSERVE_MODE_CONFLICT');
  if(a.offset!=null && a.limit==null)throw new Error('PAGE_LIMIT_REQUIRED');
  const query={actor:a.actor,...(a.limit!=null?{limit:a.limit,offset:a.offset||0}:{})};
  return sceneRun(a,'observe',{target:a.target,...query},s=>a.target?s.host.scene.inspect(a.target,{actor:a.actor}):s.host.scene.observe(query),e);
 });
 add('scene_apply','Apply structured scene edits with revision protection and explicit partial results.',{...sceneSession,requestId:z.uuid(),expectedRevision:z.number().int().nonnegative().optional(),operations:z.array(z.record(z.string(),z.unknown())).min(1).max(32)},(a,e)=>sceneRun(a,'apply',{requestId:a.requestId,expectedRevision:a.expectedRevision,operations:a.operations},async s=>{await attachSceneAssets(s,a.operations.map(op=>op.type==='add'?op.model?.asset:op.asset));return s.host.scene.apply({expectedRevision:a.expectedRevision,operations:a.operations});},e));
 add('scene_interact','Start a real action and return a queryable JobRef immediately.',{...sceneSession,requestId:z.uuid(),interaction:z.record(z.string(),z.unknown())},(a,e)=>sceneRun(a,'interact',{interaction:a.interaction},s=>s.host.startSceneInteraction(a.interaction),e));
 const job={...sceneSession,jobId:z.string().regex(/^job_[a-f0-9-]+$/)};
 add('scene_job','Read task completion and physical verification separately.',job,(a,e)=>sceneRun(a,'job',{jobId:a.jobId},s=>s.host.scene.getJob(a.jobId),e));
 add('scene_cancel','Request task cancellation and query until terminal.',job,(a,e)=>sceneRun(a,'cancel',{jobId:a.jobId},s=>s.host.scene.cancelJob(a.jobId),e));
 add('scene_verify','Evaluate explicit postconditions through the common verifier.',{...sceneSession,criteria:z.array(check).min(1).max(32)},(a,e)=>sceneRun(a,'verify',{criteria:a.criteria},s=>s.host.scene.verify(a.criteria),e));
 add('scene_add_model','Prepare a GLB/URDF capability proposal with mode=prepare, or add an AssetRef, Recipe, MechanicalDraft or reviewed GLB with mode=add. GLB bytes use bytesBase64; optional URDF uses urdfBase64. Review is configuration, never physics verification.',{...sceneSession,requestId:z.uuid(),mode:z.enum(['prepare','add']).default('add'),model:z.record(z.string(),z.unknown())},(a,e)=>sceneRun(a,'addModel',{model:a.model,mode:a.mode},async s=>{const model=decodeModel(a.model);if(a.mode==='prepare')return s.host.scene.prepareAsset(model.asset);await attachSceneAssets(s,[model.asset]);return s.host.scene.addModel(model);},e));
 add('scene_save','Export a complete portable project with bounded embedded dependencies.',sceneSession,(a,e)=>sceneRun(a,'save',{},async s=>{
  const result=await s.host.scene.save({readResource:async url=>{
   const prefix='data:model/gltf-binary;base64,';
   if(!url?.startsWith(prefix)) throw new Error('RESOURCE_UNAVAILABLE');
   return new Uint8Array(Buffer.from(url.slice(prefix.length),'base64'));
  }});
  if(Buffer.byteLength(JSON.stringify(result))>manager.maxExportBytes) throw new Error('EXPORT_LIMIT');
  return result;
 },e));
 add('scene_set_style','Select a declarative StylePack. Headless worlds report deferred rendering.',{...sceneSession,style:z.union([z.string().max(128),z.record(z.string(),z.unknown())]),fallback:z.enum(['reject','declared']).default('reject')},(a,e)=>sceneRun(a,'setStyle',{style:a.style,fallback:a.fallback},s=>s.host.scene.setStyle(a.style,{fallback:a.fallback}),e));
}
