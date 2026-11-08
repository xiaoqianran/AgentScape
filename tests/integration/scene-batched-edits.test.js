import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createSession } from '../../application/createSession.js';
import { createBlankWorld } from '../../modules/world/content/blankWorld.js';

describe('Scene API batched edits',()=>{
  it('does not roll back a committed edit if an optional snapshot cache callback throws',async()=>{
    const session=createSession(null,{environmentFactory:()=>createBlankWorld({id:'cache-hook'})});
    const {world,scene}=session;
    try{
      await world.init();
      await world.mutate('scene:add',async()=>world.commands.spawn('cup',{id:'cached_cup',position:[0,0,0]}),{},{
        onSnapshot:()=>{throw new Error('cache-not-available');}
      });
      expect(world.store.has('cached_cup')).toBe(true);
      expect(world.history.status().undo).toBe(1);
      await world.history.undo();
      expect(world.store.has('cached_cup')).toBe(false);
    }finally{scene.close();world.dispose();}
  });
  it('coalesces graph rebuilds across a batch while preserving relations',async()=>{
    const session=createSession(null,{environmentFactory:()=>createBlankWorld({id:'batch-performance'})});
    const {world,scene}=session;
    try{
      await world.init();
      const rebuild=vi.spyOn(world.sceneGraph,'rebuild');
      const snapshot=vi.spyOn(world,'snapshot');
      const operations=[0,3,6].map(index=>({
        type:'add',model:{id:'batch_cup_'+index,asset:'builtin://cup',position:[index,0,0]}
      }));
      const applied=await scene.apply({requestId:randomUUID(),operations});
      expect(applied.status).toBe('succeeded');
      expect(applied.value.applied).toHaveLength(3);
      expect(rebuild).toHaveBeenCalledTimes(1);
      expect(snapshot).toHaveBeenCalledTimes(4);
      expect(world.sceneGraph.batchDepth).toBe(0);
      expect(world.store.has('batch_cup_3')).toBe(true);
    }finally{
      scene.close();
      world.dispose();
    }
  });

  it('keeps each successful edit undoable after a later operation fails',async()=>{
    const session=createSession(null,{environmentFactory:()=>createBlankWorld({id:'batch-history'})});
    const {world,scene}=session;
    try{
      await world.init();
      const outcome=await scene.apply({operations:[
        {type:'add',model:{id:'one',asset:'builtin://cup',position:[0,0,0]}},
        {type:'add',model:{id:'two',asset:'builtin://cup',position:[3,0,0]}},
        {type:'add',model:{id:'one',asset:'builtin://cup',position:[6,0,0]}}
      ]});
      expect(outcome.status).toBe('failed');
      expect(outcome.value.applied).toHaveLength(2);
      expect(world.history.status().undo).toBe(2);
      await world.history.undo();
      expect(world.store.has('one')).toBe(true);
      expect(world.store.has('two')).toBe(false);
      await world.history.undo();
      expect(world.store.has('one')).toBe(false);
    }finally{scene.close();world.dispose();}
  });

  it('rolls back a partially applied failing edit without discarding an earlier successful edit',async()=>{
    const session=createSession(null,{environmentFactory:()=>createBlankWorld({id:'batch-rollback'})});
    const {world,scene}=session;
    try{
      await world.init();
      const transform=world.commands.transform.bind(world.commands);
      let injected=false;
      world.commands.transform=(...args)=>{
        const changed=transform(...args);
        if(!injected){injected=true;throw new Error('injected-after-write');}
        return changed;
      };
      const output=await scene.apply({operations:[
        {type:'add',model:{id:'one',asset:'builtin://cup',position:[1,0,0]}},
        {type:'setTransform',id:'one',transform:{position:[9,0,0]}},
        {type:'add',model:{id:'never',asset:'builtin://cup',position:[3,0,0]}}
      ]});
      expect(output.status).toBe('failed');
      expect(output.value.failed.index).toBe(1);
      expect(world.store.has('one')).toBe(true);
      expect(world.store.has('never')).toBe(false);
      expect(world.store.get('one').object.position.toArray()).toEqual([1,0,0]);
      expect(world.history.status().undo).toBe(1);
    }finally{scene.close();world.dispose();}
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
