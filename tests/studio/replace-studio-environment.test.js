import { describe, expect, it, vi } from 'vitest';
import { replaceStudioEnvironment } from '../../studio/runtime/replaceStudioEnvironment.js';

function fixture({replaceFails=false,restoreFails=false,disposeFails=false}={}) {
  const previous={id:'previous-world',dispose:disposeFails?vi.fn(()=>{throw new Error('dispose failed');}):vi.fn()};
  const next={id:'generated-world',dispose:vi.fn()};
  const snapshot={metadata:{name:'Before'},objects:[{id:'chair_1'}]};
  const world={
    environment:previous,
    snapshot:vi.fn(()=>snapshot),
    store:{list:()=>[['chair_1',{}],['cup_1',{}]]},
    clearObjects:vi.fn(async()=>{}),
    replaceEnvironment:vi.fn(async(environment)=>{
      if(replaceFails) throw Object.assign(new Error('replace failed'),{code:'ENVIRONMENT_REPLACE_FAILED'});
      world.environment=environment;
      return {status:'environment-ready'};
    }),
    restore:restoreFails?vi.fn(async()=>{throw new Error('restore failed');}):vi.fn(async()=>{}),
    history:{clear:vi.fn()},
    events:{emit:vi.fn()}
  };
  return {world,previous,next,snapshot};
}

describe('replaceStudioEnvironment',()=>{
  it('clears objects, replaces the environment, disposes the previous environment, and resets history',async()=>{
    const {world,previous,next}=fixture();
    const result=await replaceStudioEnvironment(world,next,{reason:'test-open-world'});
    expect(result).toEqual({status:'world-opened',environmentId:'generated-world',previousEnvironmentId:'previous-world',clearedObjects:2});
    expect(world.clearObjects).toHaveBeenCalledWith({silent:true});
    expect(world.replaceEnvironment).toHaveBeenCalledWith(next,{disposePrevious:false,reason:'test-open-world'});
    expect(previous.dispose).toHaveBeenCalledOnce();
    expect(next.dispose).not.toHaveBeenCalled();
    expect(world.history.clear).toHaveBeenCalledOnce();
    expect(world.events.emit).toHaveBeenCalledWith('scene.cleared',{count:2,reason:'test-open-world'});
  });

  it('restores the previous scene and disposes the candidate environment when replacement fails',async()=>{
    const {world,next,snapshot}=fixture({replaceFails:true});
    await expect(replaceStudioEnvironment(world,next)).rejects.toMatchObject({code:'ENVIRONMENT_REPLACE_FAILED'});
    expect(world.restore).toHaveBeenCalledWith(snapshot);
    expect(next.dispose).toHaveBeenCalledOnce();
    expect(world.history.clear).not.toHaveBeenCalled();
  });

  it('does not invalidate a successful replacement when previous environment disposal fails',async()=>{
    const {world,next}=fixture({disposeFails:true});
    const result=await replaceStudioEnvironment(world,next);
    expect(result).toMatchObject({status:'world-opened',environmentId:'generated-world',warning:{code:'PREVIOUS_ENVIRONMENT_DISPOSE_FAILED',message:'dispose failed'}});
    expect(world.environment).toBe(next);
    expect(next.dispose).not.toHaveBeenCalled();
  });

  it('reports rollback failure as an aggregate error',async()=>{
    const {world,next}=fixture({replaceFails:true,restoreFails:true});
    await expect(replaceStudioEnvironment(world,next)).rejects.toMatchObject({code:'STUDIO_ENVIRONMENT_REPLACE_ROLLBACK_FAILED'});
  });
});
