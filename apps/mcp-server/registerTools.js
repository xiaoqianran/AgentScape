import * as z from 'zod/v4';
import { allowedSkills } from './HeadlessWorldHost.js';
import { compileWorldAcceptance } from '../../modules/world/verification/WorldAcceptance.js';
const id=z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const vec=z.array(z.number().finite().min(-100).max(100)).length(3);
const speed=z.number().positive().max(8).optional();
export const actionSchemas={
 spawnAsset:z.object({assetId:id,position:vec,instanceId:id.optional()}).strict(),
 moveObject:z.object({id,position:vec}).strict(),
 navigateTo:z.object({id,end:vec,speed}).strict(),
 approachAndInteract:z.object({actorId:id,targetId:id,action:z.enum(['open','close']),partName:id.optional(),speed}).strict(),
 approachAndPickup:z.object({actorId:id,targetId:id,speed}).strict(),
 approachAndPlace:z.object({actorId:id,supportId:id,surfaceId:id.optional(),speed}).strict()
};
export function registerTools(server,manager,owner) {
 const session={worldSessionId:z.uuid()};
 const add=(name,description,shape,fn)=>server.registerTool(name,{description,inputSchema:z.object(shape).strict()},async(a,extra)=>{
  try { const result=await fn(a,extra); return {content:[{type:'text',text:JSON.stringify(result)}]}; }
  catch(e) { const code=e instanceof z.ZodError?'INVALID_ARGUMENTS':/^[A-Z_]+$/.test(e.code || '')?e.code:/^[A-Z_]+$/.test(e.message)?e.message:'RUNTIME_ERROR'; return {isError:true,content:[{type:'text',text:JSON.stringify({state:'failed',code})}]}; }
 });
 add('session_create','Create a private offline monument-hall world with agent, cabinet, cup and table.',{template:z.literal('monument-hall').default('monument-hall')},()=>manager.create(owner));
 add('session_status','Read world session lifecycle.',session,a=>manager.status(owner,a.worldSessionId));
 add('session_close','Cancel work and release your world.',session,a=>manager.close(owner,a.worldSessionId));
 const run=(a,fn,extra)=>manager.run(owner,a.worldSessionId,fn,{signal:extra?.signal});
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
 add('world_observe','Observe bounded objects and physical relations.',{...session,offset:z.number().int().min(0).max(64).default(0),limit:z.number().int().min(1).max(50).default(25)},(a,e)=>run(a,s=>({worldSessionId:s.id,execution:'idle',...s.host.observe(a.offset,a.limit)}),e));
 add('object_inspect','Inspect a real object and articulation evidence.',{...session,id},(a,e)=>run(a,s=>s.host.inspect(a.id),e));
 add('skills_list','List audited remote actions and their argument schemas.',session,(a,e)=>run(a,()=>allowedSkills.map(name=>({name,inputSchema:z.toJSONSchema(actionSchemas[name])})),e));
 add('action_execute','Execute an audited skill. Transport success is not physical verification.',{...session,skill:z.enum(allowedSkills),args:z.record(z.string(),z.unknown()),requestId:z.uuid()},(a,e)=>{
  const args=actionSchemas[a.skill].parse(a.args);
  return manager.run(owner,a.worldSessionId,(s,signal)=>s.host.execute(a.skill,args,signal),{requestId:a.requestId,fingerprint:JSON.stringify([a.skill,args]),signal:e.signal});
 });
 const check=z.object({id,kind:z.enum(['world-valid','object-exists','state-equals','interaction-verified','relation-exists','no-unresolved']),targetId:id.optional(),stateKey:id.optional(),value:z.union([z.string().max(200),z.number().finite(),z.boolean(),z.null()]).optional(),capability:id.optional(),subject:id.optional(),predicate:z.enum(['ON','NEAR','INSIDE','CONTAINS','SUPPORTS']).optional(),object:id.optional(),surfaceId:id.optional()}).strict();
 add('world_verify','Verify caller-supplied criteria using Runtime evidence. With no criteria, runs the original cabinet/cup preset.',{...session,criteria:z.array(check).min(1).max(32).optional()},(a,e)=>{if(a.criteria) compileWorldAcceptance(a.criteria); return run(a,s=>s.host.verify(a.criteria),e);});
 add('world_export','Atomically save and return SceneSerializer JSON; assets are not bundled.',session,(a,e)=>run(a,s=>manager.export(s),e));
}
