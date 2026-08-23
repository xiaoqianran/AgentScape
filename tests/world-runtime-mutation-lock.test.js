import { expect, it, vi } from 'vitest';
import { WorldRuntime } from '../src/runtime/WorldRuntime.js';

it('keeps one async world mutation owner until locomotion-like work finishes', async () => {
  let release;
  const deferred = new Promise((resolve)=>{ release=resolve; });
  let pending=false;
  const runtime={
    mutationOwner:null,
    history:{
      suspended:false,
      begin:vi.fn(()=>{ if(pending) return false; pending=true; return true; }),
      commit:vi.fn(()=>{ pending=false; return true; }),
      cancel:vi.fn(()=>{ pending=false; })
    },
    snapshot:vi.fn(()=>({tick:Date.now()})),
    sceneGraph:{batch:async(operation)=>operation(),changed:vi.fn()}
  };

  const first=WorldRuntime.prototype.mutate.call(runtime,'skill:navigateTo',async()=>{
    await deferred;
    return {status:'arrived'};
  });
  await Promise.resolve();
  expect(runtime.mutationOwner).toBe('skill:navigateTo');
  expect(runtime.history.commit).not.toHaveBeenCalled();

  const second=WorldRuntime.prototype.mutate.call(runtime,'skill:moveObject',async()=>true);
  await expect(second).rejects.toMatchObject({code:'WORLD_MUTATION_BUSY'});
  expect(runtime.history.commit).not.toHaveBeenCalled();

  release();
  await expect(first).resolves.toEqual({status:'arrived'});
  expect(runtime.history.commit).toHaveBeenCalledOnce();
  expect(runtime.mutationOwner).toBeNull();
});
