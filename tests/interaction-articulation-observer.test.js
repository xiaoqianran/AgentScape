import { describe, expect, it, vi } from 'vitest';
import { InteractionSystem } from '../world/runtime/systems/InteractionSystem.js';

const record={
  id:'cab',state:{parts:{door:'close'}},
  manifest:{parts:{door:{joint:{type:'revolute'},physics:{body:'dynamic'},actions:['open','close'],targets:{open:-1,close:0}}}}
};

function setup(step=()=>0){
  let calls=0;
  const physics={
    articulationState:vi.fn((_id,_part,{target}={})=>{
      const coordinate=step(calls++);
      return {coordinate,target,error:Math.abs(coordinate-(target??0)),tolerance:.08,jointType:'revolute',limits:[-1,0],coordinateReference:'rest-zero-pose'};
    })
  };
  const store={get:()=>record,has:()=>true};
  const events={emit:vi.fn()};
  return {system:new InteractionSystem({store,physics,spatial:{},events}),physics,events};
}

describe('live articulation observer state machine',()=>{
  it('returns action-unverified TIMEOUT when progress continues but target is never proven',async()=>{
    const {system}=setup((i)=>Math.max(-.25,-i*.01));
    const pending=system.waitForArticulationCompletion('cab','door','open',-1,{timeout:.6,stallWindow:.5,stallTolerance:.008});
    for(let i=0;i<6;i++) system.updateArticulationTasks(.1);
    await expect(pending).resolves.toMatchObject({status:'action-unverified',reason:'TIMEOUT',targetReached:false,settled:false});
    expect(system.articulationTasks.size).toBe(0);
  });

  it('supersedes an older observer on the same Part and can cancel the replacement explicitly',async()=>{
    const {system}=setup(()=>-.3);
    const first=system.waitForArticulationCompletion('cab','door','open',-1);
    const second=system.waitForArticulationCompletion('cab','door','close',0);
    await expect(first).resolves.toMatchObject({status:'action-unverified',reason:'SUPERSEDED',action:'open'});
    expect(system.articulationStatus('cab','door').parts[0]).toMatchObject({status:'moving',pending:{action:'close',target:0}});
    system.cancelPending('RUNTIME_DISPOSED');
    await expect(second).resolves.toMatchObject({status:'action-unverified',reason:'RUNTIME_DISPOSED',action:'close'});
    expect(system.articulationTasks.size).toBe(0);
  });

  it('does not promote a failed or mismatched completion into durable verified state',()=>{
    const {system}=setup();
    record.state={parts:{door:'close'},partTargets:{door:'open'}};
    expect(system.promoteArticulationCompletion({status:'action-failed',targetReached:false,id:'cab',partName:'door',action:'open'})).toBe(false);
    expect(system.promoteArticulationCompletion({status:'action-completed',targetReached:true,id:'cab',partName:'door',action:'close'})).toBe(false);
    expect(record.state).toEqual({parts:{door:'close'},partTargets:{door:'open'}});
  });

  it('does not call an oscillating in-tolerance joint settled until coordinate motion also stabilizes',async()=>{
    const values=[-.94,-1.06,-.94,-1.06,-.94,-1.06,-.94];
    let i=0;
    const {system}=setup(()=>values[Math.min(i++,values.length-1)]);
    const pending=system.waitForArticulationCompletion('cab','door','open',-1,{timeout:.5,stableDuration:.18,stallWindow:.5});
    for(let n=0;n<5;n++) system.updateArticulationTasks(.1);
    await expect(pending).resolves.toMatchObject({status:'action-unverified',reason:'TIMEOUT',targetReached:false,settled:false});
  });


  it('finalizes a failed high-level attempt by holding the current joint and clearing only the matching active request',()=>{
    const {system,physics}=setup(()=>-.45);
    physics.holdArticulationCurrent=vi.fn(()=>true);
    record.state={parts:{door:'close'},partTargets:{door:'open'}};
    expect(system.finalizeArticulationAttempt({status:'action-failed',reason:'STALL',id:'cab',partName:'door',action:'open'})).toBe(true);
    expect(physics.holdArticulationCurrent).toHaveBeenCalledWith('cab','door');
    expect(record.state.parts.door).toBe('close');
    expect(record.state.partTargets).toBeUndefined();
  });


  it('finishes an observer by clearing the task, recording the ephemeral result, emitting, and resolving once',async()=>{
    const {system,events}=setup(()=>-.2);
    let resolveTask;
    const promise=new Promise((resolve)=>{resolveTask=resolve;});
    const task={id:'cab',partName:'door',action:'open',target:-1,elapsed:.2,resolve:resolveTask,promise};
    system.articulationTasks.set('cab:door',task);
    system.finishArticulationTask(task,{status:'action-unverified',reason:'TEST_FINISH',targetReached:false,settled:false,elapsed:.2});
    await expect(promise).resolves.toMatchObject({status:'action-unverified',reason:'TEST_FINISH',id:'cab',partName:'door',action:'open',target:-1});
    expect(system.articulationTasks.has('cab:door')).toBe(false);
    expect(system.articulationResults.get('cab:door')).toMatchObject({reason:'TEST_FINISH'});
    expect(events.emit).toHaveBeenCalledWith('interaction',expect.objectContaining({action:'articulation-completion',articulationAction:'open',reason:'TEST_FINISH'}));
  });

});
