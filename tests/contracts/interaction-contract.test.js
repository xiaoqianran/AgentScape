import { describe, expect, it } from 'vitest';
import { compileInteractionContract, getInteractionContract, verifyInteractionResult } from '../../world/runtime/interaction/InteractionContract.js';

describe('InteractionContract',()=>{
  const manifest={id:'cabinet',type:'cabinet',actions:['open','close'],source:{kind:'builtin'},parts:{door:{node:'Door',actions:['open','close'],targets:{open:-1.2,close:0},physics:{body:'dynamic',colliders:[{shape:'box',halfExtents:[.5,.5,.05]}]},joint:{type:'revolute',axis:[0,1,0],limits:[-1.5,0],parentAnchor:[0,0,0],childAnchor:[0,0,0]}}}};
  it('compiles legacy action metadata into typed capabilities, effects and verifier targets',()=>{
    const contract=compileInteractionContract(manifest);
    expect(contract.schema).toBe('agentscape.interaction-contract');
    expect(contract.schemaVersion).toBe(1);
    expect(contract.contracts).toHaveLength(2);
    expect(contract.contracts[0]).toMatchObject({capability:'OPEN',action:'open',target:{entityId:'cabinet',partName:'door'},effects:[{kind:'set-articulation-target',target:-1.2}],verifierTarget:{type:'articulation-state',target:-1.2,settledRequired:true}});
  });
  it('resolves a single typed action contract',()=>{ expect(getInteractionContract(manifest,'door','close')).toMatchObject({id:'cabinet:door:close',capability:'CLOSE'}); });
  it('verifies only the deterministic post-condition, not request acknowledgement',()=>{
    const c=getInteractionContract(manifest,'door','open');
    expect(verifyInteractionResult(c,{status:'action-requested',part:'door',target:-1.2,settled:false})).toMatchObject({verified:false});
    expect(verifyInteractionResult(c,{status:'action-completed',part:'door',target:-1.2,targetReached:true,settled:true})).toEqual({verified:true});
    expect(verifyInteractionResult(c,{status:'action-completed',part:'door',target:-1.0,targetReached:true,settled:true})).toMatchObject({verified:false});
  });
});
