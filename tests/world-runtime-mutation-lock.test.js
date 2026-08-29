import { expect, it, vi } from 'vitest';
import { WorldRuntime } from '../world/runtime/WorldRuntime.js';

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


it('restores the before snapshot when an async world mutation partially changes state then throws', async () => {
  let pending=false;
  const runtime={
    mutationOwner:null,
    state:{position:[0,0,0],mode:'idle'},
    history:{
      suspended:false,
      undoStack:[],
      begin:vi.fn(() => { if(pending) return false; pending=true; return true; }),
      commit:vi.fn((after) => { pending=false; runtime.history.undoStack.push(after); return true; }),
      cancel:vi.fn(() => { pending=false; })
    },
    snapshot:vi.fn(() => structuredClone(runtime.state)),
    restore:vi.fn(async(before) => { runtime.state=structuredClone(before); }),
    sceneGraph:{batch:async(operation)=>operation(),changed:vi.fn()}
  };
  const original=new Error('partial mutation failed');

  const mutation=WorldRuntime.prototype.mutate.call(runtime,'skill:partial',async()=>{
    runtime.state.position=[4,2,-1];
    runtime.state.mode='dirty';
    throw original;
  });

  await expect(mutation).rejects.toBe(original);
  expect(runtime.restore).toHaveBeenCalledOnce();
  expect(runtime.restore).toHaveBeenCalledWith({position:[0,0,0],mode:'idle'});
  expect(runtime.state).toEqual({position:[0,0,0],mode:'idle'});
  expect(runtime.history.cancel).toHaveBeenCalledOnce();
  expect(runtime.history.commit).not.toHaveBeenCalled();
  expect(runtime.history.undoStack).toEqual([]);
  expect(runtime.mutationOwner).toBeNull();
});

it('fails closed when mutation rollback cannot restore the before snapshot', async () => {
  let pending=false;
  const original=new Error('operation failed');
  const rollback=new Error('restore failed');
  const runtime={
    mutationOwner:null,
    history:{
      suspended:false,
      begin:vi.fn(() => { if(pending) return false; pending=true; return true; }),
      commit:vi.fn(() => { pending=false; return true; }),
      cancel:vi.fn(() => { pending=false; })
    },
    snapshot:vi.fn(() => ({world:'before'})),
    restore:vi.fn(async()=>{ throw rollback; }),
    sceneGraph:{batch:async(operation)=>operation(),changed:vi.fn()}
  };

  let failure;
  try {
    await WorldRuntime.prototype.mutate.call(runtime,'skill:rollback-failure',async()=>{ throw original; });
  } catch (error) { failure=error; }

  expect(failure).toBeInstanceOf(AggregateError);
  expect(failure).toMatchObject({code:'WORLD_MUTATION_ROLLBACK_FAILED',cause:original,rollbackError:rollback});
  expect(failure.errors).toEqual([original,rollback]);
  expect(runtime.history.cancel).toHaveBeenCalledOnce();
  expect(runtime.history.commit).not.toHaveBeenCalled();
  expect(runtime.mutationOwner).toBeNull();
});


it('releases the mutation owner if creating the before snapshot fails', async () => {
  const snapshotError=new Error('snapshot failed');
  const runtime={
    mutationOwner:null,
    history:{suspended:false,begin:vi.fn()},
    snapshot:vi.fn(()=>{ throw snapshotError; })
  };

  await expect(WorldRuntime.prototype.mutate.call(runtime,'skill:snapshot-failure',async()=>true)).rejects.toBe(snapshotError);
  expect(runtime.history.begin).not.toHaveBeenCalled();
  expect(runtime.mutationOwner).toBeNull();
});


it('restores committed world authority and interaction evidence when a mutation throws', async () => {
  let pending=false;
  const oldEvidence={worldRevisionId:'rev-old',targetId:'door',capability:'OPEN',verified:true};
  const runtime={
    mutationOwner:null,
    currentWorldRevision:{revision:{id:'rev-old'},provenance:{source:'existing'}},
    currentBehaviorBundle:{ruleGraph:[{id:'old-rule'}]},
    currentPhysicsRequirements:{worldRevisionId:'rev-old',requirements:[{entityId:'door'}]},
    lastAcceptanceBundle:{worldRevisionId:'rev-old',result:{status:'world-accepted'}},
    restoredAcceptanceEvidence:{worldRevisionId:'rev-restored'},
    interactionEvidence:new Map([['old-key',oldEvidence]]),
    history:{
      suspended:false,
      begin:vi.fn(()=>{if(pending)return false;pending=true;return true;}),
      commit:vi.fn(()=>{pending=false;return true;}),
      cancel:vi.fn(()=>{pending=false;})
    },
    snapshot:vi.fn(()=>({scene:'before'})),restore:vi.fn(async()=>{}),
    loadRuleGraph:vi.fn(),sceneGraph:{batch:async(operation)=>operation(),changed:vi.fn()}
  };
  const failure=new Error('candidate failed');
  const mutation=WorldRuntime.prototype.mutate.call(runtime,'skill:candidate',async()=>{
    runtime.currentWorldRevision={revision:{id:'rev-candidate'},provenance:{source:'candidate'}};
    runtime.currentBehaviorBundle={ruleGraph:[{id:'candidate-rule'}]};
    runtime.currentPhysicsRequirements={worldRevisionId:'rev-candidate',requirements:[]};
    runtime.lastAcceptanceBundle={worldRevisionId:'rev-candidate'};
    runtime.restoredAcceptanceEvidence=null;
    runtime.interactionEvidence.clear();
    throw failure;
  });
  await expect(mutation).rejects.toBe(failure);
  expect(runtime.currentWorldRevision).toEqual({revision:{id:'rev-old'},provenance:{source:'existing'}});
  expect(runtime.currentBehaviorBundle).toEqual({ruleGraph:[{id:'old-rule'}]});
  expect(runtime.currentPhysicsRequirements).toEqual({worldRevisionId:'rev-old',requirements:[{entityId:'door'}]});
  expect(runtime.lastAcceptanceBundle).toEqual({worldRevisionId:'rev-old',result:{status:'world-accepted'}});
  expect(runtime.restoredAcceptanceEvidence).toEqual({worldRevisionId:'rev-restored'});
  expect([...runtime.interactionEvidence.entries()]).toEqual([['old-key',oldEvidence]]);
  expect(runtime.loadRuleGraph).toHaveBeenCalledWith([{id:'old-rule'}]);
});


it('cancels history and restores authority when a mutation reports that it rolled itself back', async () => {
  let pending=false;
  const runtime={
    mutationOwner:null,
    currentWorldRevision:{revision:{id:'rev-old'},provenance:{source:'existing'}},
    currentBehaviorBundle:{ruleGraph:[{id:'old-rule'}]},
    currentPhysicsRequirements:{worldRevisionId:'rev-old',requirements:[]},
    lastAcceptanceBundle:{worldRevisionId:'rev-old'},restoredAcceptanceEvidence:null,
    interactionEvidence:new Map([['old',{worldRevisionId:'rev-old',targetId:'door',capability:'OPEN',verified:true}]]),
    history:{
      suspended:false,
      begin:vi.fn(()=>{if(pending)return false;pending=true;return true;}),
      commit:vi.fn(()=>{pending=false;return true;}),
      cancel:vi.fn(()=>{pending=false;})
    },
    snapshot:vi.fn(()=>({scene:'same'})),restore:vi.fn(async()=>{}),loadRuleGraph:vi.fn(),
    sceneGraph:{batch:async(operation)=>operation(),changed:vi.fn()}
  };
  const result=await WorldRuntime.prototype.mutate.call(runtime,'skill:rolled-back',async()=>{
    runtime.currentWorldRevision={revision:{id:'rev-candidate'},provenance:{source:'candidate'}};
    runtime.currentBehaviorBundle={ruleGraph:[{id:'candidate-rule'}]};
    runtime.currentPhysicsRequirements={worldRevisionId:'rev-candidate',requirements:[{entityId:'x'}]};
    runtime.lastAcceptanceBundle={worldRevisionId:'rev-candidate'};
    runtime.interactionEvidence.clear();
    return {status:'world-rejected',rolledBack:true};
  });
  expect(result).toEqual({status:'world-rejected',rolledBack:true});
  expect(runtime.history.cancel).toHaveBeenCalledOnce();
  expect(runtime.history.commit).not.toHaveBeenCalled();
  expect(runtime.sceneGraph.changed).not.toHaveBeenCalled();
  expect(runtime.currentWorldRevision).toEqual({revision:{id:'rev-old'},provenance:{source:'existing'}});
  expect(runtime.currentBehaviorBundle).toEqual({ruleGraph:[{id:'old-rule'}]});
  expect(runtime.currentPhysicsRequirements).toEqual({worldRevisionId:'rev-old',requirements:[]});
  expect(runtime.lastAcceptanceBundle).toEqual({worldRevisionId:'rev-old'});
  expect([...runtime.interactionEvidence.keys()]).toEqual(['old']);
  expect(runtime.loadRuleGraph).toHaveBeenCalledWith([{id:'old-rule'}]);
});

it('cancels history when a bounded recompile explicitly reports committed=false without scene rollback', async () => {
  let pending=false;
  const runtime={
    mutationOwner:null,
    history:{
      suspended:false,
      begin:vi.fn(()=>{if(pending)return false;pending=true;return true;}),
      commit:vi.fn(()=>{pending=false;return true;}),
      cancel:vi.fn(()=>{pending=false;})
    },
    snapshot:vi.fn(()=>({scene:'same'})),restore:vi.fn(async()=>{}),
    sceneGraph:{batch:async(operation)=>operation(),changed:vi.fn()}
  };
  const result=await WorldRuntime.prototype.mutate.call(runtime,'skill:recompile',async()=>({status:'world-rejected',rolledBack:false,recompile:{committed:false}}));
  expect(result.recompile.committed).toBe(false);
  expect(runtime.history.cancel).toHaveBeenCalledOnce();
  expect(runtime.history.commit).not.toHaveBeenCalled();
});
