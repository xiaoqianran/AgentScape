import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createSession } from '../../application/createSession.js';
import { createBlankWorld } from '../../modules/world/content/blankWorld.js';

describe('Scene API batched edits',()=>{
  it('coalesces graph rebuilds across a batch while preserving relations',async()=>{
    const session=createSession(null,{environmentFactory:()=>createBlankWorld({id:'batch-performance'})});
    const {world,scene}=session;
    try{
      await world.init();
      const rebuild=vi.spyOn(world.sceneGraph,'rebuild');
      const operations=[0,3,6].map(index=>({
        type:'add',model:{id:'batch_cup_'+index,asset:'builtin://cup',position:[index,0,0]}
      }));
      const applied=await scene.apply({requestId:randomUUID(),operations});
      expect(applied.status).toBe('succeeded');
      expect(applied.value.applied).toHaveLength(3);
      expect(rebuild).toHaveBeenCalledTimes(1);
      expect(world.sceneGraph.batchDepth).toBe(0);
      expect(world.store.has('batch_cup_3')).toBe(true);
    }finally{
      scene.close();
      world.dispose();
    }
  });

  it('still reports partial failures and closes the graph batch',async()=>{
    const session=createSession(null,{environmentFactory:()=>createBlankWorld({id:'batch-failure'})});
    const {world,scene}=session;
    try{
      await world.init();
      const result=await scene.apply({requestId:randomUUID(),operations:[
        {type:'add',model:{id:'once',asset:'builtin://cup',position:[1,0,0]}},
        {type:'add',model:{id:'once',asset:'builtin://cup',position:[2,0,0]}},
        {type:'add',model:{id:'never',asset:'builtin://cup',position:[3,0,0]}}
      ]});
      expect(result.status).toBe('failed');
      expect(result.value.failed.index).toBe(1);
      expect(result.value.notRun).toEqual([2]);
      expect(world.store.has('once')).toBe(true);
      expect(world.store.has('never')).toBe(false);
      expect(world.sceneGraph.batchDepth).toBe(0);
    }finally{
      scene.close();
      world.dispose();
    }
  });
});
