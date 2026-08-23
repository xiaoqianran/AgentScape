import { describe, expect, it, vi } from 'vitest';
import { InteractionSystem } from '../src/runtime/systems/InteractionSystem.js';

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
});
