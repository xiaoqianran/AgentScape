import { readFile } from 'node:fs/promises';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { createSession } from '../../application/createSession.js';
import { AgentTools } from '../../application/AgentTools.js';
import { createAssetModule } from '../../modules/asset/AssetModule.js';
import { assetManifests } from '../../modules/asset/registry/manifests/index.js';
import { createMonumentHall } from '../../modules/world/content/monumentHall.js';
import { WorldBuilder } from '../../modules/world/build/WorldBuilder.js';
export const allowedSkills = ['spawnAsset','moveObject','approachAndInteract','approachAndPickup','approachAndPlace','navigateTo'];
export const criteria = [
 {id:'valid',kind:'world-valid'},
 {id:'open',kind:'interaction-verified',targetId:'cabinet_01',capability:'OPEN'},
 {id:'pickup',kind:'interaction-verified',targetId:'cup_01',capability:'PICKUP'},
 {id:'place',kind:'interaction-verified',targetId:'table_01',capability:'PLACE'},
 {id:'support',kind:'relation-exists',subject:'cup_01',predicate:'ON',object:'table_01',surfaceId:'top'},
 {id:'unresolved',kind:'no-unresolved'}
];
export class HeadlessWorldHost {
 static async create(options = {}) {
  globalThis.ProgressEvent ||= class ProgressEvent { constructor(type,init={}) { this.type=type; Object.assign(this,init); } };
  const manifests=structuredClone(assetManifests);
  const bytes=await readFile(new URL('../../public/assets/cabinet.glb',import.meta.url));
  manifests.cabinet.source={kind:'glb',url:`data:model/gltf-binary;base64,${bytes.toString('base64')}`};
  // Only these trusted, local assets are reachable from remote tools.
  const local=Object.fromEntries(['agent','cabinet','cup','table'].map(id=>[id,manifests[id]]));
  const {world}=createSession(null,{assetModule:createAssetModule({manifests:local,manifestStore:null,libraryStore:null}),environmentFactory:o=>createMonumentHall({...o,loadAssets:false})});
  const host=new HeadlessWorldHost(world,options);
  try { await world.init(); await host.prepare(); return host; }
  catch(error) { world.dispose(); throw error; }
 }
 constructor(world,{maxSteps=12000,timeoutMs=30000,maxObjects=64}={}) {
  this.world=world; this.maxSteps=maxSteps; this.timeoutMs=timeoutMs; this.maxObjects=maxObjects;
  world.policy.profiles.set('remote',new Set(['world.read','world.write','spatial.read','physics.read']));
  this.actionCount=0; this.unresolved=new Map();
  world.lastTaskObservation={unresolvedMutations:[]};
  this.tools=new AgentTools(world,{profile:'remote',actor:'agent_01',source:'remote-mcp'});
 }
 async prepare() {
  const ir={schema:'agentscape.world-ir',schemaVersion:1,revision:{id:'remote-monument-r1',reason:'trusted offline template'},provenance:{source:'remote-mcp',createdBy:'AgentScape',evidenceRefs:[]},intent:{name:'Remote Monument Hall',description:'Open cabinet, pick up cup, place on table'},policy:{generation:{generate:false},physics:{fallbackPolicy:'deny'}},entities:[
   {id:'agent_01',asset:{assetId:'agent'},transform:{position:[0,0,9]},capabilityIntent:[],initialState:{}},
   {id:'cabinet_01',asset:{assetId:'cabinet'},transform:{position:[-5.2,0,3.9]},capabilityIntent:['OPEN'],initialState:{}},
   {id:'cup_01',asset:{assetId:'cup'},capabilityIntent:['PICKUP'],initialState:{}},
   {id:'table_01',asset:{assetId:'table'},transform:{position:[5.2,0,4.2]},capabilityIntent:[],initialState:{}}
  ],spatial:{relations:[{subject:'cup_01',predicate:'INSIDE',object:'cabinet_01',receptacleId:'interior'}],constraints:[]},interactions:[],rules:[],acceptance:[]};
  const result=await new WorldBuilder(this.world).run(ir);
  if(result.pipeline.state.reports.worldAdmission.status==='rejected') throw new Error('TEMPLATE_REJECTED');
 }
 async execute(skill,args,signal) {
  if(this.closed) throw new Error('HOST_CLOSED');
  if(!allowedSkills.includes(skill)) throw new Error('SKILL_FORBIDDEN');
  if(++this.actionCount>256) throw new Error('ACTION_BUDGET_EXHAUSTED');
  if(skill==='spawnAsset' && this.world.store.list().length>=this.maxObjects) throw new Error('OBJECT_LIMIT');
  let done=false,result,error;
  const pending=this.tools.call(skill,args).then(v=>{done=true;result=v;},e=>{done=true;error=e;});
  const start=performance.now();
  let steps=0;
  let termination=null,cleanupSteps=0;
  while(!done) {
   if(signal?.aborted || steps>=this.maxSteps || performance.now()-start>this.timeoutMs) termination ||= signal?.aborted?'ACTION_CANCELLED':'ACTION_TIMEOUT';
   if(termination) {
    this.world.interactions.cancelPending('REMOTE_CANCELLED'); this.world.locomotion.cancelAll('REMOTE_CANCELLED');
    if(++cleanupSteps>240) { this.closed=true; this.world.dispose(); break; }
   }
   this.world.simulation.step(); steps++;
   if(steps%12===0) await yieldLoop(); else await Promise.resolve();
  }
  if(termination) {
   this.unresolved.set(JSON.stringify([skill,args]),{tool:skill,args,state:'failed',reason:termination});
   this.world.lastTaskObservation={unresolvedMutations:[...this.unresolved.values()]};
   throw new Error(termination);
  }
  const outcome=error?{state:'failed'}:this.tools.executionPolicy(skill,result).outcome;
  const key=JSON.stringify([skill,args]);
  if(outcome.state==='verified') this.unresolved.delete(key); else this.unresolved.set(key,{tool:skill,args,state:outcome.state});
  this.world.lastTaskObservation={unresolvedMutations:[...this.unresolved.values()]};
  if(error) throw error;
  return {state:outcome.state,result,steps,tick:this.world.simulation.tick};
 }
 observe(offset=0,limit=25) {
  const ids=this.world.store.list().map(([id])=>id),page=ids.slice(offset,offset+limit);
  return {environmentId:this.world.environment.id,tick:this.world.simulation.tick,objects:page.map(id=>this.world.queries.getObjectInfo(id)),agent:this.world.observation.actor('agent_01'),relations:this.world.observation.relations(page,{limit:100}),total:ids.length,nextOffset:offset+limit<ids.length?offset+limit:null};
 }
 inspect(id) { if(!this.world.queries.hasObject(id)) throw new Error('OBJECT_NOT_FOUND'); return {object:this.world.queries.getObjectInfo(id),articulation:this.world.observation.articulation(id),relations:this.world.observation.relations([id],{limit:100})}; }
 async verify() {
  const evidence=await this.tools.call('evaluateWorldAcceptance',{criteria});
  const carry=this.world.queries.carryStatus('agent_01');
  return {state:evidence.status==='world-accepted' && carry.status==='empty'?'verified':'unverified',evidence,carry};
 }
 close() { if(!this.closed) {this.closed=true; this.world.dispose();} }
}
