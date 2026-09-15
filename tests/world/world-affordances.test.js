import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMagicCabin } from '../../modules/world/content/magicCabin.js';
import { WorldAffordances } from '../../modules/world/runtime/interaction/WorldAffordances.js';
import { PhysicsSystem } from '../../modules/world/runtime/systems/PhysicsSystem.js';
import { RapierPhysicsBackend } from '../../modules/world/runtime/physics/RapierPhysicsBackend.js';
import { ObjectStore } from '../../modules/world/runtime/ObjectStore.js';
import { SkillRegistry } from '../../application/skills/SkillRegistry.js';
import { registerCoreSkills } from '../../application/skills/registerCoreSkills.js';
import { PolicyEngine } from '../../foundation/PolicyEngine.js';
import { cabinCanvasHost } from '../helpers/cabinCanvasHost.js';

const disposals=[];
afterEach(()=>{for(const dispose of disposals.splice(0).reverse())dispose();vi.useRealTimers();});
function fixture() {
  const environment=createMagicCabin(cabinCanvasHost());
  const store=new ObjectStore();
  store.add('agent_01',{manifest:{type:'agent'}});
  const runtime={environment,store,simulation:{running:true},events:{emit:vi.fn()},
    physics:{getPosition:()=>[0,0,0],hasCapability:()=>true,raycast:()=>null},
    mutate:async (_label,operation)=>operation()};
  runtime.affordances=new WorldAffordances(runtime);
  disposals.push(()=>{runtime.affordances.cancel();environment.dispose();});
  const registry=registerCoreSkills(new SkillRegistry({runtime,policy:new PolicyEngine()}),runtime);
  const invoke=async (name,args={})=>{
    const result=await registry.invoke(name,args,{profile:'builder',actor:'agent_01'});
    expect(result.success,result.error?.message).toBe(true);
    return result.result;
  };
  const standNear=id=>{
    const p=runtime.affordances.position(runtime.affordances.get(id));
    runtime.physics.getPosition=()=>[p[0],p[1]-1.2,p[2]+.6];
  };
  const tick=(count=240)=>{for(let i=0;i<count;i++){environment.step(1/60);runtime.affordances.update(1/60);}};
  return {runtime,environment,registry,invoke,standNear,tick};
}

describe('Agent world affordance contracts',()=>{
  it('discovers stable identities through production tool registration and completes a stateful sequence',async()=>{
    const {runtime,invoke,standNear,tick,registry}=fixture();
    const ids=runtime.affordances.contracts().map(entry=>entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(runtime.affordances.contracts().filter(entry=>entry.kind==='drawer')).toHaveLength(2);
    const discovery=await invoke('listWorldAffordances',{query:'front-door'});
    expect(discovery.entities[0].id).toBe('cabin:front-door');
    const doorId=discovery.entities[0].id;
    standNear(doorId);
    const opening=invoke('executeWorldAction',{targetId:doorId,action:'open'});
    expect(opening).toBeInstanceOf(Promise);
    await vi.waitFor(()=>expect(runtime.affordances.inspect(doorId).pending).toBe(true));
    expect(runtime.affordances.inspect(doorId).pending).toBe(true);
    expect(runtime.affordances.get(doorId).read().openness).toBe(0);
    tick();
    const opened=await opening;
    expect(opened).toMatchObject({verified:true,physicsVerified:false,evidenceKind:'animated-transform'});
    expect(registry.executionPolicy('executeWorldAction',opened).outcome.state).toBe('verified');
    standNear('cabin:note-1');
    expect(await invoke('executeWorldAction',{targetId:'cabin:note-1',action:'write',text:'请打开餐桌灯'})).toMatchObject({verified:true,after:{text:'请打开餐桌灯'}});
    expect(await invoke('executeWorldAction',{targetId:'cabin:note-1',action:'read'})).toMatchObject({state:{text:'请打开餐桌灯'}});
    standNear('cabin:table-lamp');
    await invoke('executeWorldAction',{targetId:'cabin:table-lamp',action:'turn_off'});
    expect(await invoke('executeWorldAction',{targetId:'cabin:table-lamp',action:'turn_on'})).toMatchObject({verified:true,before:{on:false},after:{on:true}});
    expect(runtime.events.emit).toHaveBeenCalledWith('world.action.completed',expect.objectContaining({targetId:'cabin:table-lamp'}));
  });

  it('blocks remote, occluded, invalid and unsupported actions without changing source state',async()=>{
    const {runtime,invoke,standNear}=fixture();
    const id='cabin:note-1';
    const before=runtime.affordances.get(id).read();
    runtime.physics.getPosition=()=>[100,0,100];
    expect(await invoke('executeWorldAction',{targetId:id,action:'write',text:'bad'})).toMatchObject({reason:'OUT_OF_REACH',verified:false});
    expect((await invoke('inspectWorldAffordance',{targetId:id})).state.text).toBe(null);
    standNear(id);
    runtime.physics.raycast=()=>({distance:.1,provenance:{environmentId:'wall'}});
    expect(await invoke('executeWorldAction',{targetId:id,action:'read'})).toMatchObject({reason:'OCCLUDED'});
    runtime.physics.raycast=()=>null;
    expect(await invoke('executeWorldAction',{targetId:id,action:'write',text:42})).toMatchObject({reason:'TEXT_MUST_BE_AT_MOST_100_CHARACTERS'});
    expect(await invoke('executeWorldAction',{targetId:id,action:'pickup'})).toMatchObject({reason:'ACTION_UNSUPPORTED'});
    expect(runtime.affordances.get(id).read()).toEqual(before);
    expect(runtime.affordances.execute({targetId:id,action:'read'})).toMatchObject({reason:'ACTOR_NOT_FOUND'});
  });

  it('never reports stalled or cancelled animations as successful',async()=>{
    vi.useFakeTimers();
    const {runtime,standNear}=fixture();
    standNear('cabin:front-door');
    const command={targetId:'cabin:front-door',action:'open',actorId:'agent_01'};
    runtime.simulation.running=false;
    expect(runtime.affordances.execute(command)).toMatchObject({reason:'SIMULATION_PAUSED'});
    runtime.simulation.running=true;
    const stalled=runtime.affordances.execute(command);
    expect(runtime.affordances.execute(command)).toMatchObject({reason:'ACTION_IN_PROGRESS'});
    await vi.advanceTimersByTimeAsync(12000);
    expect(await stalled).toMatchObject({status:'world-action-unverified',reason:'SIMULATION_NOT_ADVANCING',verified:false});
    const cancelled=runtime.affordances.execute(command);
    runtime.affordances.cancel('SCENE_RESTORE');
    expect(await cancelled).toMatchObject({reason:'SCENE_RESTORE',verified:false});
    expect(runtime.affordances.pending.size).toBe(0);
  });

  it('round-trips actual text, switches and spring poses, not just desired states',()=>{
    const {environment,runtime,tick}=fixture();
    const door=runtime.affordances.get('cabin:front-door');
    door.request('open');tick();
    runtime.affordances.get('cabin:table-lamp').request('turn_off');
    runtime.affordances.get('cabin:note-1').request('write',{text:'保存后的任务'});
    const saved=structuredClone(environment.snapshot());
    door.request('close');tick();
    runtime.affordances.get('cabin:table-lamp').request('turn_on');
    environment.restore(saved);
    expect(environment.snapshot()).toEqual(saved);
    expect(door.verify('open')).toBe(true);
  });

  it('uses production Rapier occlusion and permits touching the target door collider',async()=>{
    const {runtime,environment}=fixture();
    const physics=new PhysicsSystem({backend:new RapierPhysicsBackend()});
    await physics.init();disposals.push(()=>physics.dispose());
    runtime.physics=physics;
    physics.addEnvironment(environment.colliders,{id:environment.id});
    const actor=new THREE.Group();
    runtime.store.get('agent_01').object=actor;
    const target=runtime.affordances.position(runtime.affordances.get('cabin:front-door'));
    actor.position.set(target[0],0,target[2]+.75);
    physics.attach('agent_01',{physics:{body:'fixed',colliders:[{shape:'capsule',radius:.15,halfHeight:.4}]}},actor);
    environment.step(1/60,{physics});physics.step(1/60,runtime.store);
    const access=runtime.affordances.access(runtime.affordances.get('cabin:front-door'),'agent_01');
    expect(access).toMatchObject({available:true});
    physics.addEnvironment([{shape:'box',halfExtents:[.4,1,.05],translation:[target[0],1,target[2]+.4]}],{id:'test-wall'});
    physics.step(1/60,runtime.store);
    expect(runtime.affordances.execute({targetId:'cabin:front-door',action:'open',actorId:'agent_01'})).toMatchObject({reason:'OCCLUDED',access:{blocker:{environmentId:'test-wall'}}});
    // Scene restoration replaces Rapier handles; animated environment bodies must be recreated.
    physics.resetWorld();physics.addEnvironment(environment.colliders,{id:environment.id});
    environment.step(1/60,{physics});physics.step(1/60,runtime.store);
    let count=0;physics.world.forEachCollider(()=>count++);
    expect(count).toBeGreaterThan(environment.colliders.length);
  });

  it('rejects malformed spring snapshots atomically and connects device state to native light output',()=>{
    const {environment,runtime,tick}=fixture();
    const saved=structuredClone(environment.snapshot());
    const invalid=structuredClone(saved);
    invalid.affordances['cabin:front-door'].cur='broken';
    expect(()=>environment.restore(invalid)).toThrow(/Invalid affordance snapshot/);
    expect(environment.snapshot()).toEqual(saved);
    const lamp=runtime.affordances.get('cabin:table-lamp');
    lamp.request('turn_on');tick();
    const light=environment.root.getObjectByName('CabinTableLight');
    expect(light.intensity).toBeGreaterThan(5);
    lamp.request('turn_off');tick();
    expect(light.intensity).toBeLessThan(.01);
  });

  it('exposes the wardrobe interlock and verifies every advertised state-changing action',async()=>{
    const {runtime,tick,environment}=fixture();
    const execute=(targetId,action,args={})=>runtime.affordances.execute({targetId,action,args},{editor:true});
    expect(execute('cabin:wardrobe-drawer','open')).toMatchObject({reason:'WARDROBE_DOORS_MUST_BE_OPEN'});
    expect(runtime.affordances.inspect('cabin:wardrobe-drawer').actions[0]).toMatchObject({available:false,reason:'WARDROBE_DOORS_MUST_BE_OPEN'});
    for(const entry of runtime.affordances.contracts()) {
      for(const action of entry.actions.filter(action=>action!=='read')) {
        if(entry.id==='cabin:wardrobe-drawer' && action==='open') {
          for(const id of ['cabin:wardrobe-left','cabin:wardrobe-right']){const pending=execute(id,'open');tick();await pending;}
        }
        const pending=execute(entry.id,action,{text:'契约回归'});
        for(let i=0;i<480 && runtime.affordances.pending.size;i++)tick(1);
        expect(await pending,`${entry.id}: ${action}`).toMatchObject({verified:true});
      }
    }
    // A delayed source callback from a closing door must not mutate a restored scene.
    const drawer=execute('cabin:wardrobe-drawer','open');tick();await drawer;
    const saved=structuredClone(environment.snapshot());
    const close=execute('cabin:wardrobe-left','close');
    runtime.affordances.cancel('SCENE_RESTORE');environment.restore(saved);tick();
    expect(await close).toMatchObject({verified:false});
    expect(runtime.affordances.get('cabin:wardrobe-left').read().requestedOpen).toBe(true);
  },30000);
});
