import { describe, expect, it, vi } from 'vitest';
import { InteractionSystem } from '../../world/runtime/systems/InteractionSystem.js';

const system = ({ motion, support } = {}) => {
  const physics={ bodyMotionState:vi.fn(()=>motion || {sleeping:false,linearSpeed:0,angularSpeed:0}) };
  const spatial={ supportStatus:vi.fn(()=>support || {on:true,surfaceId:'top',gap:0}) };
  const events={emit:vi.fn()};
  return { interactions:new InteractionSystem({store:{},physics,spatial,events}), physics,spatial,events };
};

describe('placement settle state machine',()=>{
  it('resolves placed only after the body remains slow and support post-condition is true',async()=>{
    const {interactions,spatial}=system();
    const pending=interactions.waitForPlacementSettle('cup','table','top',{stableDuration:.1,timeout:1});
    interactions.updatePlacementSettles(.05);
    expect(interactions.settleTasks.has('cup')).toBe(true);
    interactions.updatePlacementSettles(.05);
    await expect(pending).resolves.toMatchObject({status:'placed',supportVerified:true,settled:true,support:{on:true,surfaceId:'top'}});
    expect(spatial.supportStatus).toHaveBeenCalledWith('cup','table',{surfaceId:'top'});
    expect(interactions.settleTasks.size).toBe(0);
  });

  it('returns place-unverified on timeout even if geometry happens to be over the surface',async()=>{
    const {interactions}=system({motion:{sleeping:false,linearSpeed:2,angularSpeed:1},support:{on:true,surfaceId:'top',gap:.01}});
    const pending=interactions.waitForPlacementSettle('cup','table','top',{stableDuration:.1,timeout:.1});
    interactions.updatePlacementSettles(.1);
    await expect(pending).resolves.toMatchObject({status:'place-unverified',reason:'SETTLE_TIMEOUT',supportVerified:false,settled:false,support:{on:true}});
  });

  it('cancels pending settle promises explicitly during teardown',async()=>{
    const {interactions}=system({motion:{sleeping:false,linearSpeed:1,angularSpeed:1}});
    const pending=interactions.waitForPlacementSettle('cup','table','top');
    interactions.cancelPending('RUNTIME_DISPOSED');
    await expect(pending).resolves.toMatchObject({status:'place-unverified',reason:'RUNTIME_DISPOSED',supportVerified:false,settled:false});
    expect(interactions.settleTasks.size).toBe(0);
  });

  it('cancels a place settle when its support target is removed',async()=>{
    const store={has:vi.fn(()=>false),get:vi.fn()};
    const physics={bodyMotionState:vi.fn(()=>({sleeping:false,linearSpeed:1,angularSpeed:1}))};
    const spatial={supportStatus:vi.fn(()=>({on:false,reason:'TARGET_REMOVED'}))};
    const interactions=new InteractionSystem({store,physics,spatial,events:{emit:vi.fn()}});
    const pending=interactions.waitForPlacementSettle('cup','table','top');
    interactions.beforeRemove('table');
    await expect(pending).resolves.toMatchObject({status:'place-unverified',reason:'OBJECT_REMOVED',supportVerified:false,settled:false});
    expect(interactions.settleTasks.size).toBe(0);
  });

  it('cancels a recovery cleanup settle when its failed-action target is removed',async()=>{
    const store={has:vi.fn((id)=>id==='blocker'),get:vi.fn(()=>({state:{}}))};
    const physics={bodyMotionState:vi.fn(()=>({sleeping:false,linearSpeed:1,angularSpeed:1})),articulationContacts:vi.fn(()=>[])};
    const spatial={getBounds:vi.fn(()=>({min:[0,0,0],max:[.2,.4,.2]}))};
    const interactions=new InteractionSystem({store,physics,spatial,events:{emit:vi.fn()}});
    const pending=interactions.waitForRecoveryCleanupSettle('agent_01','blocker','cabinet','door','open');
    interactions.beforeRemove('cabinet');
    await expect(pending).resolves.toMatchObject({status:'recovery-cleanup-unverified',reason:'OBJECT_REMOVED',released:true,settled:false});
    expect(interactions.settleTasks.size).toBe(0);
  });


  it('uses one direct settle-task owner for place and recovery-cleanup kinds',async()=>{
    const store={has:vi.fn(()=>false),get:vi.fn()};
    const physics={bodyMotionState:vi.fn(()=>({sleeping:false,linearSpeed:1,angularSpeed:1}))};
    const spatial={supportStatus:vi.fn(()=>({on:false}))};
    const interactions=new InteractionSystem({store,physics,spatial,events:{emit:vi.fn()}});
    const pending=interactions.waitForObjectSettle('blocker',{kind:'recovery-cleanup',actorId:'agent_01',targetId:'cabinet',partName:'door',action:'open'});
    expect(interactions.settleTasks.get('blocker')).toMatchObject({
      kind:'recovery-cleanup',objectId:'blocker',actorId:'agent_01',targetId:'cabinet',partName:'door',action:'open'
    });
    interactions.cancelPending('TEST_CANCEL');
    await expect(pending).resolves.toMatchObject({status:'recovery-cleanup-unverified',reason:'TEST_CANCEL',settled:false});
    expect(interactions.settleTasks.size).toBe(0);
  });

});
