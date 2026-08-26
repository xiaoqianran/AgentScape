import { describe,expect,it } from 'vitest';
import { buildWorldRetryPlan } from '../src/pipeline/WorldRetry.js';

const rejected=(overrides={})=>({state:{
  input:{schema:1,name:'Lab',generation:{generate:false},assets:[{id:'machine_01',query:'rare machine',generate:false}],relations:[]},
  artifacts:{worldSpec:{schema:1,name:'Lab',generation:{generate:false},assets:[{id:'machine_01',query:'rare machine',generate:false}],relations:[]}},
  reports:{
    assetAdmission:{status:'rejected',unresolved:[{id:'machine_01',query:'rare machine',status:'missing'}],provisional:[]},
    layoutAdmission:{status:'rejected',reason:'ASSET_ADMISSION_REJECTED',placements:[],issues:[]},
    validation:{counts:{hard:0,advisory:0},hard:[],advisory:[]},
    worldAdmission:{status:'rejected',reasons:['ASSET_UNRESOLVED','ASSET_ADMISSION_REJECTED']},
    ...overrides
  }
}});

describe('buildWorldRetryPlan',()=>{
  it('enables generation only for missing assets when a generator is configured',()=>{
    const result=buildWorldRetryPlan(rejected(),{generatorConfigured:true,attempt:1,budget:2});
    expect(result).toMatchObject({
      schema:'agentscape.world-retry.v1',status:'retry-proposed',retriable:true,attempt:1,budget:2,
      findings:[{stage:'asset',code:'missing',instanceId:'machine_01',query:'rare machine',retriable:true}],
      actions:[{kind:'enable-generation',instanceId:'machine_01',query:'rare machine'}],
      nextPlan:{name:'Lab',generation:{generate:false},assets:[{id:'machine_01',query:'rare machine',generate:true}],relations:[]}
    });
    expect(result.nextPlan.schema).toBeUndefined();
  });

  it('does not retry a search miss when no generator is configured',()=>{
    expect(buildWorldRetryPlan(rejected(),{generatorConfigured:false,attempt:1,budget:2})).toMatchObject({status:'not-retriable',retriable:false,findings:[{code:'missing',retriable:false}]});
  });

  it('does not auto-relax layout or relation failures',()=>{
    const pipeline=rejected({
      assetAdmission:{status:'ready',unresolved:[],provisional:[]},
      layoutAdmission:{status:'rejected',reason:'WORLD_POSE_BLOCKED',issues:[{id:'machine_01'}]},
      relationAdmission:{status:'rejected',reason:'NEAR_NO_CLEAR_POSE',issues:[{subject:'a',object:'b'}]}
    });
    const result=buildWorldRetryPlan(pipeline,{generatorConfigured:true,attempt:1,budget:2});
    expect(result).toMatchObject({status:'not-retriable',retriable:false});
    expect(result.findings.map((x)=>x.stage)).toEqual(['layout','relation']);
  });

  it('marks the retry exhausted at the fixed budget',()=>{
    expect(buildWorldRetryPlan(rejected(),{generatorConfigured:true,attempt:2,budget:2})).toMatchObject({status:'exhausted',retriable:false,attempt:2,budget:2});
  });

  it('does not let pre-repair validation noise mask a retriable upstream asset miss',()=>{
    const pipeline=rejected({
      validation:{counts:{hard:1,advisory:0},hard:[{code:'P_OVERLAP',object:'existing_01'}],advisory:[]}
    });
    const result=buildWorldRetryPlan(pipeline,{generatorConfigured:true,attempt:1,budget:2});
    expect(result).toMatchObject({status:'retry-proposed',retriable:true,findings:[{stage:'asset',code:'missing',retriable:true}]});
    expect(result.findings.some((item)=>item.stage==='validation')).toBe(false);
  });

});





it('preserves WorldIR revision/provenance and projects the revised IR into nextPlan',()=>{
  const pipeline={state:{
    input:{},
    artifacts:{
      worldIR:{
        schema:'agentscape.world-ir',schemaVersion:1,
        revision:{id:'rev-1'},
        provenance:{source:'planner',evidenceRefs:['trace-1']},
        intent:{name:'Retry Lab'},policy:{generation:{generate:false},physics:{}},
        entities:[{id:'asset-1',asset:{assetId:'missing',query:'crate',generate:false},transform:{},capabilityIntent:[],initialState:{}}],
        spatial:{relations:[],constraints:[]},interactions:[],rules:[],acceptance:[]
      },
      worldSpec:{schema:1,name:'Retry Lab',generation:{generate:false},assets:[{id:'asset-1',assetId:'missing',query:'crate',generate:false}],relations:[]}
    },
    reports:{assetAdmission:{status:'partial',unresolved:[{id:'asset-1',query:'crate',status:'missing'}]}}
  }};
  const plan=buildWorldRetryPlan(pipeline,{generatorConfigured:true,attempt:1,budget:2});
  expect(plan).toMatchObject({status:'retry-proposed',retriable:true,nextPlan:{assets:[{id:'asset-1',generate:true}]}});
  expect(plan.nextIR).toMatchObject({revision:{id:'rev-1:retry-2',parentId:'rev-1'},provenance:{source:'world-retry',sourceId:'rev-1'}});
  expect(plan.nextIR.provenance.evidenceRefs).toEqual(expect.arrayContaining(['trace-1','asset-1']));
});


it('preserves rich World IR semantics across a missing-asset retry',()=>{
  const pipeline={state:{
    input:{},
    artifacts:{
      worldIR:{
        schema:'agentscape.world-ir',schemaVersion:1,
        revision:{id:'rev-rich-retry'},provenance:{source:'planner',evidenceRefs:[]},
        intent:{name:'Retry Behavior World'},policy:{generation:{generate:false},physics:{fallbackPolicy:'deny'}},
        entities:[{id:'door_01',asset:{assetId:'missing-door',query:'cabinet',generate:false},transform:{},physicsRequirement:{bodyClass:'articulated'},capabilityIntent:['OPEN'],initialState:{locked:false}}],
        spatial:{relations:[],constraints:[]},
        interactions:[{id:'open-door',targetId:'door_01',capability:'OPEN'}],rules:[],
        acceptance:[{id:'door-exists',kind:'object-exists',targetId:'door_01'}]
      },
      worldSpec:{schema:1,name:'Retry Behavior World',generation:{generate:false},assets:[{id:'door_01',assetId:'missing-door',query:'cabinet',generate:false}],relations:[]}
    },
    reports:{assetAdmission:{status:'rejected',unresolved:[{id:'door_01',query:'cabinet',status:'missing'}]}}
  }};

  const retry=buildWorldRetryPlan(pipeline,{generatorConfigured:true,attempt:1,budget:2});
  expect(retry).toMatchObject({status:'retry-proposed',nextIR:{revision:{parentId:'rev-rich-retry'}}});
  expect(retry.nextIR.entities[0]).toMatchObject({asset:{generate:true},physicsRequirement:{bodyClass:'articulated'},capabilityIntent:['OPEN'],initialState:{locked:false}});
  expect(retry.nextIR.interactions).toHaveLength(1);
  expect(retry.nextIR.acceptance).toHaveLength(1);
  expect(retry.nextPlan).toMatchObject({schema:1,assets:[{id:'door_01',generate:true}]});
});
