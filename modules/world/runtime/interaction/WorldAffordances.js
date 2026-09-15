import * as THREE from 'three';

const clone=value=>structuredClone(value);
const failure=(id,reason,extra={})=>({status:'world-action-blocked',targetId:id,verified:false,reason,...extra});

export class WorldAffordances {
  constructor(runtime) {this.runtime=runtime;this.pending=new Map();this.sequence=0;this.lastResult=null;}
  contracts() {return this.runtime.environment?.affordances || [];}
  get(id) {return this.contracts().find(entry=>entry.id===id);}
  position(entry) {
    if(entry.position) return [...entry.position];
    const box=new THREE.Box3().setFromObject(entry.object);
    return box.getCenter(new THREE.Vector3()).toArray();
  }
  access(entry,actorId) {
    const runtime=this.runtime;
    if(!runtime.store?.has(actorId)) return {available:false,reason:'ACTOR_NOT_FOUND'};
    const actor=runtime.store.get(actorId);
    if(actor.manifest?.type!=='agent') return {available:false,reason:'ACTOR_NOT_AGENT'};
    const feet=runtime.physics?.getPosition(actorId);
    if(!feet) return {available:false,reason:'ACTOR_PHYSICS_UNAVAILABLE'};
    const target=this.position(entry);
    const origin=[feet[0],feet[1]+1.2,feet[2]];
    const distance=Math.hypot(...target.map((v,i)=>v-origin[i]));
    if(distance>1.5) return {available:false,reason:'OUT_OF_REACH',distance,targetPosition:target,maxDistance:1.5};
    if(!runtime.physics.hasCapability?.('scene-query')) return {available:false,reason:'VISIBILITY_UNAVAILABLE'};
    const hit=runtime.physics.raycast(origin,target,{excludeId:actorId});
    if(hit && hit.distance < distance-.12 && !(entry.colliderId && hit.provenance?.environmentId===entry.colliderId)) return {available:false,reason:'OCCLUDED',blocker:hit.provenance || {id:hit.id},distance};
    return {available:true,distance};
  }
  inspect(id,{actorId=null}={}) {
    const entry=this.get(id);
    if(!entry) return null;
    const access=actorId?this.access(entry,actorId):{available:null,reason:'ACTOR_REQUIRED_FOR_REACH_CHECK'};
    const state=entry.kind==='text' && actorId && !access.available ? {text:null,reason:access.reason} : clone(entry.read());
    return {id:entry.id,label:entry.label,kind:entry.kind,position:this.position(entry),state,
      actions:entry.actions.map(action=>{const reason=entry.precondition?.(action);return {action,...access,...(reason?{available:false,reason}:{})};}),evidenceKind:entry.evidenceKind,
      physicsVerified:false,pending:this.pending.has(id)};
  }
  list({query='',actorId=null,limit=40}={}) {
    const term=String(query).toLocaleLowerCase();
    const matches=this.contracts().filter(entry=>`${entry.id} ${entry.label} ${entry.kind}`.toLocaleLowerCase().includes(term));
    return {schema:'agentscape.affordances.v1',total:matches.length,entities:matches.slice(0,Math.min(100,Math.max(1,limit))).map(entry=>this.inspect(entry.id,{actorId}))};
  }
  execute({targetId,action,args={},actorId=null},{editor=false}={}) {
    const entry=this.get(targetId);
    if(!entry) return failure(targetId,'TARGET_NOT_FOUND');
    if(!entry.actions.includes(action)) return failure(targetId,'ACTION_UNSUPPORTED');
    if(!editor) {const access=this.access(entry,actorId);if(!access.available)return failure(targetId,access.reason,{access});}
    const precondition=entry.precondition?.(action);
    if(precondition)return failure(targetId,precondition);
    const invalid=entry.validate?.(action,args);
    if(invalid) return failure(targetId,invalid);
    if(action==='read') return {status:'world-state-read',targetId,state:clone(entry.read()),evidenceKind:entry.evidenceKind};
    if(this.pending.has(targetId)) return failure(targetId,'ACTION_IN_PROGRESS');
    const before=clone(entry.read());
    const commandId=`world-action-${++this.sequence}`;
    const complete=()=>{
      const result={status:'world-action-completed',commandId,targetId,action,verified:true,physicsVerified:false,evidenceKind:entry.evidenceKind,before,after:clone(entry.read())};
      this.lastResult=result;
      this.runtime.events?.emit('world.action.completed',result);
      return result;
    };
    if(this.runtime.simulation?.running===false && entry.evidenceKind==='animated-transform') return failure(targetId,'SIMULATION_PAUSED');
    entry.request(action,args);
    if(entry.verify(action,args)) return complete();
    return new Promise(resolve=>{
      const pending={entry,action,args,elapsed:0,resolve,complete,commandId};
      pending.timer=setTimeout(()=>this.finishUnverified(targetId,'SIMULATION_NOT_ADVANCING'),12000);
      pending.timer.unref?.();
      this.pending.set(targetId,pending);
    });
  }
  finishUnverified(id,reason) {
    const item=this.pending.get(id);if(!item)return;
    clearTimeout(item.timer);this.pending.delete(id);
    const result={status:'world-action-unverified',commandId:item.commandId,targetId:id,verified:false,reason,after:clone(item.entry.read())};
    this.lastResult=result;item.resolve(result);
  }
  update(dt) {
    for(const [id,item] of this.pending) {
      item.elapsed+=dt;
      if(item.entry.verify(item.action,item.args)) {clearTimeout(item.timer);this.pending.delete(id);item.resolve(item.complete());}
      else if(item.elapsed>=8)this.finishUnverified(id,'POSTCONDITION_TIMEOUT');
    }
  }
  cancel(reason='WORLD_REPLACED') {for(const id of [...this.pending.keys()])this.finishUnverified(id,reason);}
}
