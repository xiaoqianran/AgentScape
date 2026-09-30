import { describe, expect, it, vi } from 'vitest';
import { PromptHybridWorldOrchestrator } from '../../application/generation/PromptHybridWorldOrchestrator.js';

const proposal=()=>({
  intent:{name:'Generated Garden',task:'put a pickup-able cup near the bench'},
  entities:[{id:'cup_01',asset:{assetId:'cup'},capabilityIntent:['PICKUP']}],
  spatial:{relations:[{subject:'cup_01',predicate:'NEAR',anchor:{kind:'observation',label:'bench'}}]},
  interactions:[],rules:[],acceptance:[]
});

const generationResult=()=>({
  status:'world-artifacts-ready',prompt:'a compact garden',
  route:{kind:'text-image-world',image:{provider:'modal-2d'},world:{provider:'modal-world'}},
  jobs:{image:'job_image',world:'job_world'},sourceArtifact:null,
  artifacts:{}
});

function runtimeFixture(previousEnvironment){
  const runtime={
    environment:previousEnvironment,
    currentWorldRevision:{revision:{id:'rev_old'},provenance:{source:'curated-pack'}},
    currentBehaviorBundle:{ruleGraph:[{id:'rule_old',kind:'keep'}]},
    currentPhysicsRequirements:{requirements:['gravity']},
    lastAcceptanceBundle:{checks:['accept_old']},
    restoredAcceptanceEvidence:{kind:'restored',ref:'evidence_old'},
    interactionEvidence:new Map([['cup_01',{kind:'contact',count:2}]]),
    loadRuleGraph:vi.fn(),
    exclusiveMutation:vi.fn(async(_label,fn)=>fn()),
    snapshot:vi.fn(()=>({scene:'before-snapshot'})),
    restore:vi.fn(async()=>{}),
    clearObjects:vi.fn(async()=>{}),
    replaceEnvironment:vi.fn(async(environment)=>{ runtime.environment=environment; }),
    queries:{listObjects:()=>[]}
  };
  return runtime;
}

describe('PromptHybridWorldOrchestrator rollback',()=>{
  it('restores environment, scene and world authority when the WorldBuilder rejects the proposal',async()=>{
    const previousEnvironment={id:'old-world',dispose:vi.fn()};
    const runtime=runtimeFixture(previousEnvironment);
    const snapshotBefore=runtime.snapshot();
    const nextEnvironment={id:'generated-garden',semantics:null,layout:null,generated:{},dispose:vi.fn()};
    const worldBuilder={
      run:vi.fn(async()=>{
        runtime.currentWorldRevision={revision:{id:'rev_new'}};
        runtime.currentBehaviorBundle=null;
        runtime.currentPhysicsRequirements=null;
        runtime.lastAcceptanceBundle=null;
        runtime.restoredAcceptanceEvidence=null;
        runtime.interactionEvidence=new Map();
        return {status:'world-rejected',reason:'WORLD_REJECTED',admission:{status:'rejected',reasons:['WORLD_REJECTED']},attempts:[]};
      })
    };
    const orchestrator=new PromptHybridWorldOrchestrator(runtime,{
      worldBuilder,
      generateWorldArtifacts:async()=>generationResult(),
      materializeEnvironment:async()=>nextEnvironment,
      revisionIdFactory:()=> 'world-rollback-unit'
    });

    const result=await orchestrator.run({environmentPrompt:'a compact garden',proposal:proposal()});

    expect(result).toMatchObject({status:'world-rejected',reason:'WORLD_REJECTED',rolledBack:true});
    expect(runtime.environment).toBe(previousEnvironment);
    expect(runtime.replaceEnvironment.mock.calls).toEqual([
      [nextEnvironment,expect.objectContaining({reason:'prompt-hybrid-world',disposePrevious:false})],
      [previousEnvironment,expect.objectContaining({reason:'prompt-hybrid-world-rollback',disposePrevious:false})]
    ]);
    expect(runtime.restore).toHaveBeenCalledWith(snapshotBefore);
    expect(runtime.currentWorldRevision).toEqual({revision:{id:'rev_old'},provenance:{source:'curated-pack'}});
    expect(runtime.currentBehaviorBundle).toEqual({ruleGraph:[{id:'rule_old',kind:'keep'}]});
    expect(runtime.currentPhysicsRequirements).toEqual({requirements:['gravity']});
    expect(runtime.lastAcceptanceBundle).toEqual({checks:['accept_old']});
    expect(runtime.restoredAcceptanceEvidence).toEqual({kind:'restored',ref:'evidence_old'});
    expect(runtime.interactionEvidence).toBeInstanceOf(Map);
    expect([...runtime.interactionEvidence.entries()]).toEqual([['cup_01',{kind:'contact',count:2}]]);
    expect(runtime.loadRuleGraph).toHaveBeenLastCalledWith([{id:'rule_old',kind:'keep'}]);
    expect(nextEnvironment.dispose).toHaveBeenCalledOnce();
    expect(previousEnvironment.dispose).not.toHaveBeenCalled();
  });

  it('preserves both the original and the rollback error as an AggregateError when rollback itself fails',async()=>{
    const previousEnvironment={id:'old-world',dispose:vi.fn()};
    const runtime=runtimeFixture(previousEnvironment);
    const nextEnvironment={id:'generated-garden',semantics:null,layout:null,generated:{},dispose:vi.fn()};
    const builderError=new Error('builder exploded');
    const rollbackError=new Error('restore failed');
    runtime.restore=vi.fn(async()=>{ throw rollbackError; });
    const worldBuilder={run:vi.fn(async()=>{ throw builderError; })};
    const orchestrator=new PromptHybridWorldOrchestrator(runtime,{
      worldBuilder,
      generateWorldArtifacts:async()=>generationResult(),
      materializeEnvironment:async()=>nextEnvironment,
      revisionIdFactory:()=> 'world-rollback-failure'
    });

    const failure=await orchestrator.run({environmentPrompt:'a compact garden',proposal:proposal()}).catch((error)=>error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.code).toBe('PROMPT_HYBRID_WORLD_ROLLBACK_FAILED');
    expect(failure.errors).toEqual([builderError,rollbackError]);
    expect(failure.cause).toBe(builderError);
    expect(failure.rollbackError).toBe(rollbackError);
    expect(nextEnvironment.dispose).not.toHaveBeenCalled();
  });
});
