import * as z from 'zod/v4';
import { AGENT_STUDIO_MCP_SET } from '../../application/agent/StudioMcpAllowlist.js';
import { allowedSkills } from './HeadlessWorldHost.js';
import { compileWorldAcceptance } from '../../modules/world/verification/WorldAcceptance.js';
import { definitionSchema, proceduralContract } from '../../application/programmatic-assets/ProgrammaticAssetContract.js';
import { assetAdmission } from '../../modules/asset/model/admission.js';
import { sceneObjectIdSchema, sceneTransformSchema, sceneVector3Schema } from '../../application/scene/SceneProject.js';
import { recipeSchema } from '../../modules/asset/model/AssetInputContracts.js';
import { createHeadlessGLTFLoader } from './HeadlessGLTFLoader.js';
import { publicMcpError } from './errorDiagnostics.js';
import { registerStudioProjectTools } from './StudioProjectToolContracts.js';
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
export function registerTools(server,manager,owner,assets,studioBridge=null,{agentOnly=false,projectScope}={}) {
 const session={worldSessionId:z.uuid()};
 const sceneSession={worldSessionId:z.uuid().optional()};
 const add=(name,description,shape,fn)=>agentOnly && !AGENT_STUDIO_MCP_SET.has(name) ? null : server.registerTool(name,{description,inputSchema:z.object(shape).strict()},async(a,extra)=>{
  try {
    const result=await fn(a,extra);
    if(name==='scene_capture'&&a.operation==='capture'&&a.imageMode==='mcp'&&result?.status==='captured'){
      const {imageBase64,...metadata}=result;
      return {content:[{type:'text',text:JSON.stringify(metadata)},{type:'image',data:imageBase64,mimeType:metadata.mime}]};
    }
    return {content:[{type:'text',text:JSON.stringify(result)}]};
  }
  catch(e) { return {isError:true,content:[{type:'text',text:JSON.stringify(publicMcpError(e))}]}; }
 });
 add('studio_pair_create','Create a short-lived one-time pairing code for an explicitly approved local Studio world. The bearer token is never delivered to the browser.',{},()=>studioBridge.pair(owner));
 add('studio_sessions_list','List connected Studio worlds visible to this MCP identity. Use a worldSessionId from this list when multiple worlds are open.',{},()=>({worlds:studioBridge.listSessions(owner)}));
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
 add('asset_publish_project','Explicitly publish one ready local Object Forge instance to the owner-scoped immutable global library. Publishing does not mutate the project or automatically upgrade any instance.',{
  ...session,objectId:id,requestId:z.uuid()
 },(a,e)=>manager.run(owner,a.worldSessionId,async s=>{
  if(!manager.repository)throw new Error('PERSISTENCE_UNAVAILABLE');
  const entry=s.forge.get(s.host.world,a.objectId);
  const module=s.host.world.assetModule;
  const manifest=module.getManifest(entry.assetId);
  const bytes=await module.readAssetBytes(entry.assetId);
  const prepared=await manager.repository.saveProjectAsset(owner,{definition:entry.definition,manifest,bytes});
  await manager.repository.publish(owner,prepared.manifest.id);
  return {published:true,scope:'owner-global',assetId:prepared.manifest.id,version:prepared.build.version,
    reference:'asset://sha256/'+prepared.build.version,sourceObjectId:a.objectId,
    sourceRevision:entry.revision,admission:prepared.build.admission};
 },{signal:e?.signal,requestId:a.requestId,fingerprint:JSON.stringify(['asset_publish_project',a.objectId])}));
 add('asset_list','List your published asset versions, paginated.',{offset:z.number().int().min(0).max(128).default(0),limit:z.number().int().min(1).max(20).default(20)},async a=>{const all=await assets.repository.list(owner);return {assets:all.slice(a.offset,a.offset+a.limit),total:all.length,nextOffset:a.offset+a.limit<all.length?a.offset+a.limit:null};});
 const run=(a,fn,extra)=>manager.run(owner,a.worldSessionId,fn,{signal:extra?.signal});
 const sceneRun=async(a,method,args,fn,extra)=>{
  const target=projectScope?.worldSessionId || a.worldSessionId || studioBridge.currentSession(owner).worldSessionId;
  if(projectScope)args={...args,expectedProjectId:projectScope.projectId};
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
  if(projectScope)throw new Error('STUDIO_NOT_CONNECTED');
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
 registerStudioProjectTools(add,(a,args,e)=>sceneRun(a,'project',args,()=>{throw new Error('STUDIO_PROJECTS_UNAVAILABLE');},e),{projectScope});
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
 const check=z.object({id,kind:z.enum(['world-valid','object-exists','state-equals','interaction-verified','relation-exists','no-unresolved']),targetId:targetId.optional(),stateKey:id.optional(),value:z.union([z.string().max(200),z.number().finite(),z.boolean(),z.null()]).optional(),capability:id.optional(),partName:id.optional(),source:z.string().min(1).max(64).optional(),subject:targetId.optional(),predicate:z.enum(['ON','NEAR','INSIDE','CONTAINS','SUPPORTS']).optional(),object:targetId.optional(),objectAnyOf:z.array(targetId).min(1).max(32).optional(),surfaceId:id.optional()}).strict();
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
 add('scene_navigation','Read-only live route and actor-eligible provisional articulation recovery. Partial-route-progress may advance a blocked route without making the destination reachable. Hypothetical target-pose routing does not move the actor or joint. After executing a justified recommended interaction, query again before navigating.',{
  ...sceneSession,actor:id,position:vec
 },(a,e)=>sceneRun(a,'navigation',{actor:a.actor,position:a.position},s=>s.host.scene.diagnoseNavigation({actor:a.actor,position:a.position}),e));
 add('scene_thermal','Read or run real thermal simulation in the active Scene: list entities, inspect per-part temperatures, get measured time-series, set heat power or advance up to 10 seconds of WorldRuntime. Write operations require requestId; thermal simulation is a declared model, not real-world proof.',{
  ...sceneSession,
  operation:z.enum(['list','inspect','series','setPower','run']),
  targetId:targetId.optional(),nodeId:id.optional(),limit:z.number().int().min(1).max(600).optional(),
  powerW:z.number().finite().min(-1e9).max(1e9).optional(),
  durationSec:z.number().positive().max(10).optional(),
  requestId:z.uuid().optional()
 },(a,e)=>{
  if(['setPower','run'].includes(a.operation)&&!a.requestId)throw new Error('REQUEST_ID_REQUIRED');
  const args=Object.fromEntries(Object.entries(a).filter(([key,value])=>!['worldSessionId','requestId'].includes(key)&&value!==undefined));
  return sceneRun(a,'thermal',args,s=>s.host.scene.thermalExperiment(args),e);
 });
 add('scene_apply','Apply structured scene edits with revision protection and explicit partial results.',{...sceneSession,requestId:z.uuid(),expectedRevision:z.number().int().nonnegative().optional(),operations:z.array(z.record(z.string(),z.unknown())).min(1).max(32)},(a,e)=>sceneRun(a,'apply',{requestId:a.requestId,expectedRevision:a.expectedRevision,operations:a.operations},async s=>{await attachSceneAssets(s,a.operations.map(op=>op.type==='add'?op.model?.asset:op.asset));return s.host.scene.apply({expectedRevision:a.expectedRevision,operations:a.operations});},e));
 add('scene_history','Read or undo/redo the shared Scene history. One timeline for Studio GUI changes, native Three.js registered properties, native physics interactions and managed Scene edits. Supply the current scene_observe revision for mutations to reject stale requests.',{
  ...sceneSession,operation:z.enum(['status','undo','redo']).default('status'),
  expectedRevision:z.number().int().nonnegative().optional(),requestId:z.uuid().optional()
 },(a,e)=>{
  if(a.operation!=='status' && !a.requestId)throw new Error('REQUEST_ID_REQUIRED');
  return sceneRun(a,'history',{operation:a.operation,expectedRevision:a.expectedRevision},
    s=>s.host.scene.history({operation:a.operation,expectedRevision:a.expectedRevision}),e);
 });
 add('scene_interact','Start a real action and return a queryable JobRef immediately.',{...sceneSession,requestId:z.uuid(),interaction:z.record(z.string(),z.unknown())},(a,e)=>sceneRun(a,'interact',{interaction:a.interaction},s=>s.host.startSceneInteraction(a.interaction),e));
 const job={...sceneSession,jobId:z.string().regex(/^job_[a-f0-9-]+$/)};
 add('scene_job','Read task completion and physical verification separately.',job,(a,e)=>sceneRun(a,'job',{jobId:a.jobId},s=>s.host.scene.getJob(a.jobId),e));
 add('scene_cancel','Request task cancellation and query until terminal.',job,(a,e)=>sceneRun(a,'cancel',{jobId:a.jobId},s=>s.host.scene.cancelJob(a.jobId),e));
 const sceneCheck=check.extend({kind:z.enum(['world-valid','visual-layout','object-exists','state-equals','interaction-verified','relation-exists']),
  expectedOverlaps:z.array(z.object({object:targetId,other:targetId,reason:z.string().trim().min(1).max(200)}).strict()).max(64).optional(),
  expectedFloating:z.array(z.object({object:targetId,reason:z.string().trim().min(1).max(200)}).strict()).max(64).optional()});
 add('scene_verify','Evaluate observable scene postconditions. visual-layout acknowledges explicitly declared findings only for visual-only objects, not physical validity. Optional snapshot=inspect or visual samples native evidence at the same code-world frame (visual includes JPEG). Snapshot is not continuous proof. Agent execution-log checks belong to the Host.',{...sceneSession,criteria:z.array(sceneCheck).min(1).max(32),snapshot:z.enum(['inspect','visual']).optional()},(a,e)=>sceneRun(a,'verify',{criteria:a.criteria,...(a.snapshot?{snapshot:a.snapshot}:{})},s=>{if(a.snapshot)throw new Error('PROJECT_SNAPSHOT_UNAVAILABLE');return s.host.scene.verify(a.criteria);},e));
 add('scene_add_model','Add a recipe using model={id,asset:{schema:"agentscape.asset-recipe",schemaVersion:1,id,parts:[{id,geometry:{type:"box",size:[1,1,1]}}]},position:[0,0,0]}. Analyze GLB/URDF with mode=prepare; mode=screen runs bounded, isolated Rapier tests of source-bound kinematic candidates (model.proposalId and optional model.hypothesisIds), never grants actions; mode=add imports reviewed assets. GLB uses bytesBase64.',{
  ...sceneSession,requestId:z.uuid(),mode:z.enum(['prepare','screen','add']).default('add'),model:z.object({
    id:sceneObjectIdSchema.optional(),position:sceneVector3Schema.optional(),transform:sceneTransformSchema.optional(),
    level:z.enum(['visual','physical','interactive']).optional(),
    asset:z.union([recipeSchema,z.string(),z.record(z.string(),z.unknown()).refine(asset=>asset.schema!=='agentscape.asset-recipe')])
  }).passthrough()
 },(a,e)=>sceneRun(a,'addModel',{model:a.model,mode:a.mode},async s=>{
  const model=decodeModel(a.model);
  if(a.mode==='prepare')return s.host.scene.prepareAsset(model.asset);
  if(a.mode==='screen')return s.host.scene.screenAsset({...model.asset,proposalId:model.proposalId,hypothesisIds:model.hypothesisIds});
  await attachSceneAssets(s,[model.asset]);
  const added=await s.host.scene.addModel(model);
  if(a.mode==='add' && added.status==='succeeded' && (['agentscape.mechanical-draft','agentscape.asset-recipe'].includes(model.asset?.schema) || model.asset?.kind==='three-code'))
    s.forge.record(model.id,model.asset,s.host.world.store.get(model.id).assetId,s.host.world);
  return added;
 },e));
 add('scene_object_definition','Inspect source evidence, preview precise field changes, or apply a single instance revision after asset compilation and runtime admission. Session-scoped AI-declared mechanical drafts, recipes and three-code definitions only.',{
  ...sceneSession,objectId:id,operation:z.enum(['inspect','preview','apply','fork']),expectedRevision:z.number().int().positive().optional(),
  changes:z.array(z.object({path:z.string().min(1).max(192),value:z.unknown()}).strict()).min(1).max(8).optional(),
  previewId:z.uuid().optional(),requestId:z.uuid().optional()
 },(a,e)=>{
  if(a.operation!=='inspect' && !a.requestId)throw new Error('REQUEST_ID_REQUIRED');
  if(a.operation==='fork'){
    if(!a.worldSessionId)throw new Error('FORK_REQUIRES_PRIVATE_WORLD');
    return manager.run(owner,a.worldSessionId,async session=>{
      const record=session.host.world.store.get(a.objectId);
      if(!record || !/^pa_[a-f0-9]{64}$/.test(record.assetId))
        throw new Error('OBJECT_DEFINITION_UNAVAILABLE');
      const published=await manager.repository.get(owner,record.assetId,{published:true});
      if(published.build.schema!=='agentscape.project-asset.v1')
        throw new Error('OBJECT_DEFINITION_UNAVAILABLE');
      return session.forge.fork(session.host.world,a.objectId,published.build.definition,record.assetId);
    },{signal:e?.signal,requestId:a.requestId,fingerprint:JSON.stringify(['object-fork',a.objectId])});
  }
  const args={operation:a.operation,objectId:a.objectId,expectedRevision:a.expectedRevision,changes:a.changes,previewId:a.previewId};
  return sceneRun(a,'objectDefinition',args,async s=>{
    if(a.operation==='inspect')return s.forge.inspect(s.host.world,a.objectId);
    if(a.operation==='preview')return s.forge.preview(s.host.world,a.objectId,a.expectedRevision,a.changes);
    return s.forge.apply(s.host.world,s.host.scene,a.objectId,a.expectedRevision,a.previewId,{executor:s.host.executor});
  },e);
 });
 add('scene_import','Import an inline scene_save bundle or an uploaded .asworld fileId (private offline session). Validates assets and environment before commit.',{...sceneSession,requestId:z.uuid(),bundle:z.record(z.string(),z.unknown()).optional(),fileId:z.string().regex(/^file_[a-f0-9-]{36}$/).optional()},(a,e)=>{
  if((a.bundle===undefined)===(a.fileId===undefined))throw new Error('INVALID_ARGUMENTS');
  if(a.fileId){
   if(projectScope||!a.worldSessionId||studioBridge?.isStudioSession(a.worldSessionId)||!manager.transfers)throw new Error('WORLD_FILE_OFFLINE_ONLY');
   return manager.run(owner,a.worldSessionId,async(s,signal)=>{
    const lease=manager.transfers.lease(owner,a.fileId);let staging;
    try{
     staging=await manager.transfers.worldStorage();
     const result=await s.host.scene.importWorld(staging.storage,lease.source(),{signal,gltfLoader:createHeadlessGLTFLoader()});
     const previous=s.archiveStorage;s.archiveStorage=staging;staging=null;s.forge.clear();
     await previous?.dispose();
     return result;
    }finally{lease.release();await staging?.dispose();}
   },{signal:e?.signal,requestId:a.requestId,fingerprint:JSON.stringify(['importWorld',a.fileId])});
  }
  if(Buffer.byteLength(JSON.stringify(a.bundle))>manager.maxExportBytes)throw new Error('IMPORT_LIMIT');
  return sceneRun(a,'importProject',{bundle:a.bundle},async s=>{
    const result=await s.host.scene.importProject(a.bundle);
    s.forge.restore(s.host.world,result.value.editable||[]);
    return {...result,value:{status:result.value.status,objects:result.value.objects,editableRestored:result.value.editable?.length||0}};
  },e);
 });
 add('scene_save','Export a small inline project bundle or a streamed .asworld file (format: world-file, private offline session). Download via GET /files/:id/content.',{...sceneSession,format:z.enum(['inline','world-file']).default('inline')},(a,e)=>{
  if(a.format==='world-file'){
   if(projectScope||!a.worldSessionId||studioBridge?.isStudioSession(a.worldSessionId)||!manager.transfers)throw new Error('WORLD_FILE_OFFLINE_ONLY');
   return manager.run(owner,a.worldSessionId,async(s,signal)=>{
    const staging=await manager.transfers.worldStorage();
    try{
     const {file,result}=await manager.transfers.createFile(owner,writer=>s.host.scene.exportWorld(staging.storage,writer,{signal}),signal);
     return {...result,value:{fileId:file.id,bytes:file.bytes,sha256:file.sha256,root:result.value}};
    }finally{await staging.dispose();}
   },{signal:e?.signal});
  }
  return sceneRun(a,'save',{},async s=>{
   const result=await s.host.scene.save({editable:s.forge.export(s.host.world),readResource:async url=>{
    const prefix='data:model/gltf-binary;base64,';
    if(!url?.startsWith(prefix)) throw new Error('RESOURCE_UNAVAILABLE');
    return new Uint8Array(Buffer.from(url.slice(prefix.length),'base64'));
   }});
   if(Buffer.byteLength(JSON.stringify(result))>manager.maxExportBytes) throw new Error('EXPORT_LIMIT');
   return result;
  },e);
 });
 add('scene_set_style','Select a declarative StylePack. Headless worlds report deferred rendering.',{...sceneSession,style:z.union([z.string().max(128),z.record(z.string(),z.unknown())]),fallback:z.enum(['reject','declared']).default('reject')},(a,e)=>sceneRun(a,'setStyle',{style:a.style,fallback:a.fallback},s=>s.host.scene.setStyle(a.style,{fallback:a.fallback}),e));
}
