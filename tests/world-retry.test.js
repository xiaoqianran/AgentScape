import { describe,expect,it } from 'vitest';
import { buildWorldRetryPlan } from '../world/compiler/WorldRetry.js';

const worldIR=({id='machine_01',revision='rev-1',query='rare machine',assetId=null,extraEntity={}}={})=>({
  schema:'agentscape.world-ir',schemaVersion:1,
  revision:{id:revision},provenance:{source:'planner',evidenceRefs:[]},
  intent:{name:'Lab'},policy:{generation:{generate:false},physics:{}},
  entities:[{
    id,asset:{...(assetId?{assetId}:{}),query,generate:false},transform:{},capabilityIntent:[],initialState:{},...extraEntity
  }],
  spatial:{relations:[],constraints:[]},interactions:[],rules:[],acceptance:[]
});

const rejected=(overrides={})=>({state:{
  artifacts:{worldIR:worldIR()},
  reports:{
    assetAdmission:{status:'rejected',unresolved:[{id:'machine_01',query:'rare machine',status:'missing'}],provisional:[]},
    layoutAdmission:{status:'not-evaluated',reason:'UPSTREAM_ASSET_ADMISSION_REJECTED',placements:[],issues:[]},
    behaviorAdmission:{status:'not-evaluated',reason:'UPSTREAM_ASSET_ADMISSION_REJECTED',issues:[]},
    physicsAdmission:{status:'not-evaluated',reason:'UPSTREAM_ASSET_ADMISSION_REJECTED',issues:[]},
    relationAdmission:{status:'not-evaluated',reason:'UPSTREAM_ADMISSION_REJECTED',applied:[],issues:[]},
    validation:{status:'not-evaluated',reason:'UPSTREAM_ADMISSION_REJECTED',counts:{hard:0,advisory:0},hard:[],advisory:[]},
    worldAdmission:{status:'rejected',reasons:['ASSET_UNRESOLVED']},
    ...overrides
  }
}});

describe('buildWorldRetryPlan',()=>{
  it('enables generation only in a child World IR revision when a generator is configured',()=>{
    const result=buildWorldRetryPlan(rejected(),{generatorConfigured:true,attempt:1,budget:2});
    expect(result).toMatchObject({
      schema:'agentscape.world-retry.v1',status:'retry-proposed',retriable:true,attempt:1,budget:2,
      findings:[{stage:'asset',code:'missing',instanceId:'machine_01',query:'rare machine',retriable:true}],
      actions:[{kind:'enable-generation',instanceId:'machine_01',query:'rare machine'}],
      nextIR:{revision:{id:'rev-1:retry-2',parentId:'rev-1'},entities:[{id:'machine_01',asset:{generate:true}}]}
    });
    expect(result).not.toHaveProperty('nextPlan');
  });

  it('does not retry a search miss when no generator is configured',()=>{
    expect(buildWorldRetryPlan(rejected(),{generatorConfigured:false,attempt:1,budget:2})).toMatchObject({status:'not-retriable',retriable:false,findings:[{code:'missing',retriable:false}]});
  });

  it('does not auto-relax layout or relation failures',()=>{
    const result=buildWorldRetryPlan(rejected({
      assetAdmission:{status:'ready',unresolved:[],provisional:[]},
      layoutAdmission:{status:'rejected',reason:'WORLD_POSE_BLOCKED',issues:[{id:'machine_01'}]},
      relationAdmission:{status:'rejected',reason:'NEAR_NO_CLEAR_POSE',issues:[{subject:'a',object:'b'}]}
    }),{generatorConfigured:true,attempt:1,budget:2});
    expect(result).toMatchObject({status:'not-retriable',retriable:false});
    expect(result.findings.map((item)=>item.stage)).toEqual(['layout','relation']);
  });

  it('marks the retry exhausted at the fixed budget',()=>{
    expect(buildWorldRetryPlan(rejected(),{generatorConfigured:true,attempt:2,budget:2})).toMatchObject({status:'exhausted',retriable:false,attempt:2,budget:2});
  });

  it('does not let pre-repair validation noise mask a retriable upstream asset miss',()=>{
    const result=buildWorldRetryPlan(rejected({
      validation:{counts:{hard:1,advisory:0},hard:[{code:'P_OVERLAP',object:'existing_01'}],advisory:[]}
    }),{generatorConfigured:true,attempt:1,budget:2});
    expect(result).toMatchObject({status:'retry-proposed',retriable:true,findings:[{stage:'asset',code:'missing',retriable:true}]});
    expect(result.findings.some((item)=>item.stage==='validation')).toBe(false);
  });

  it('fails closed when retry evidence is detached from canonical World IR',()=>{
    expect(buildWorldRetryPlan({state:{artifacts:{},reports:{}}},{generatorConfigured:true})).toMatchObject({
      status:'not-retriable',retriable:false,findings:[{stage:'pipeline',code:'WORLD_IR_REQUIRED',retriable:false}]
    });
  });

  it('preserves revision provenance and rich semantics across a missing-asset retry',()=>{
    const ir=worldIR({id:'door_01',revision:'rev-rich',query:'cabinet',assetId:'missing-door',extraEntity:{
      physicsRequirement:{bodyClass:'articulated'},capabilityIntent:['OPEN'],initialState:{locked:false}
    }});
    ir.provenance.evidenceRefs=['trace-1'];
    ir.interactions=[{id:'open-door',targetId:'door_01',capability:'OPEN'}];
    ir.acceptance=[{id:'door-exists',kind:'object-exists',targetId:'door_01'}];
    const pipeline={state:{
      artifacts:{worldIR:ir},
      reports:{assetAdmission:{status:'rejected',unresolved:[{id:'door_01',query:'cabinet',status:'missing'}]}}
    }};

    const retry=buildWorldRetryPlan(pipeline,{generatorConfigured:true,attempt:1,budget:2});
    expect(retry).toMatchObject({status:'retry-proposed',nextIR:{revision:{id:'rev-rich:retry-2',parentId:'rev-rich'},provenance:{source:'world-retry',sourceId:'rev-rich'}}});
    expect(retry.nextIR.provenance.evidenceRefs).toEqual(expect.arrayContaining(['trace-1','door_01']));
    expect(retry.nextIR.entities[0]).toMatchObject({asset:{generate:true},physicsRequirement:{bodyClass:'articulated'},capabilityIntent:['OPEN'],initialState:{locked:false}});
    expect(retry.nextIR.interactions).toHaveLength(1);
    expect(retry.nextIR.acceptance).toHaveLength(1);
  });
});
