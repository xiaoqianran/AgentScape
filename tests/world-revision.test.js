import { describe, expect, it } from 'vitest';
import { buildWorldRevisionContext, createWorldRevisionProposal, applyWorldRevisionProposal, classifyWorldRevisionImpact } from '../src/pipeline/WorldRevision.js';
import { compileValidationFindings } from '../src/validation/Finding.js';

const ir=()=>({
  schema:'agentscape.world-ir',schemaVersion:1,
  revision:{id:'rev-1'},provenance:{source:'planner',evidenceRefs:['trace-1']},intent:{name:'Lab'},
  entities:[
    {id:'box',asset:{assetId:'crate'},transform:{position:[0,0,0]}},
    {id:'table',asset:{assetId:'table'},transform:{position:[1,0,0]}},
    {id:'lamp',asset:{assetId:'lamp'},transform:{position:[3,0,0]}}
  ],
  spatial:{relations:[{subject:'box',predicate:'ON',object:'table'}],constraints:[]},
  interactions:[{id:'pick-box',targetId:'box',capability:'PICKUP'}],rules:[{id:'r1',event:'x',effect:'y'}],
  acceptance:[{id:'box-exists',kind:'object-exists',targetId:'box'}]
});

describe('WorldRevision handoff',()=>{
  it('extracts the affected IR subgraph while keeping related entities context-only',()=>{
    const finding=compileValidationFindings({hard:[{code:'P_OVERLAP',object:'box',other:'table'}],advisory:[]},{worldRevisionId:'rev-1'});
    const context=buildWorldRevisionContext(ir(),finding);
    expect(context).toMatchObject({schema:'agentscape.world-revision-context',baseRevisionId:'rev-1',affected:{seedEntityIds:['box','table'],editableEntityIds:['box','table'],missingEntityIds:[]},rulesReviewRequired:true});
    expect(context.subgraph.entities.map((x)=>x.id)).toEqual(['box','table']);
    expect(context.subgraph.interactions.map((x)=>x.id)).toEqual(['pick-box']);
    expect(context.subgraph.acceptance.map((x)=>x.id)).toEqual(['box-exists']);
  });
  it('rejects edits outside the affected seed entities',()=>{
    const finding=compileValidationFindings({hard:[{code:'G_BELOW_GROUND',object:'box'}],advisory:[]},{worldRevisionId:'rev-1'});
    const context=buildWorldRevisionContext(ir(),finding);
    expect(context.affected.contextEntityIds).toEqual(['box','table']);
    expect(context.affected.editableEntityIds).toEqual(['box']);
    let failure; try{createWorldRevisionProposal(context,{nextRevisionId:'rev-2',edits:[{kind:'set-position',entityId:'table',position:[2,0,0]}]});}catch(error){failure=error;}
    expect(failure).toMatchObject({code:'WORLD_REVISION_SCOPE_VIOLATION'});
  });
  it('requires an explicit changed-plan gate and produces an evidence-linked child revision',()=>{
    const finding=compileValidationFindings({hard:[{code:'G_BELOW_GROUND',object:'box'}],advisory:[]},{worldRevisionId:'rev-1'});
    const context=buildWorldRevisionContext(ir(),finding);
    const proposal=createWorldRevisionProposal(context,{nextRevisionId:'rev-2',reason:'lift box',edits:[{kind:'set-position',entityId:'box',position:[0,.2,0]}]});
    expect(()=>applyWorldRevisionProposal(ir(),proposal)).toThrow(/changed-plan acceptance/);
    const next=applyWorldRevisionProposal(ir(),proposal,{acceptChangedPlan:true});
    expect(next).toMatchObject({revision:{id:'rev-2',parentId:'rev-1',reason:'lift box'},provenance:{source:'finding-revision',sourceId:finding[0].id}});
    expect(next.entities.find((entity)=>entity.id==='box')).toMatchObject({id:'box',transform:{position:[0,.2,0]}});
    expect(next.entities.map((entity)=>entity.id)).toEqual(['box','table','lamp']);
    expect(next.provenance.evidenceRefs).toEqual(expect.arrayContaining(['trace-1',finding[0].id]));
  });
  it('rejects stale findings before building revision context',()=>{
    const finding=compileValidationFindings({hard:[{code:'G_BELOW_GROUND',object:'box'}],advisory:[]},{worldRevisionId:'rev-old'});
    expect(()=>buildWorldRevisionContext(ir(),finding)).toThrow(/revision mismatch/);
  });
});


it('keeps relational acceptance and PLACE support context inside the affected revision subgraph',()=>{
  const world=ir();
  world.interactions.push({id:'place-box',supportId:'table',capability:'PLACE'});
  world.acceptance.push({id:'box-on-table',kind:'relation-exists',subject:'box',predicate:'ON',object:'table'});
  const finding=compileValidationFindings({hard:[{code:'P_OVERLAP',object:'box',other:'table'}],advisory:[]},{worldRevisionId:'rev-1'});
  const context=buildWorldRevisionContext(world,finding);
  expect(context.subgraph.interactions.map((item)=>item.id)).toEqual(expect.arrayContaining(['pick-box','place-box']));
  expect(context.subgraph.acceptance.map((item)=>item.id)).toEqual(expect.arrayContaining(['box-exists','box-on-table']));
});


it('normalizes and applies typed entity-level semantic edits through the canonical World IR contract',()=>{
  const world=ir();
  world.entities[0].capabilityIntent=['PICKUP'];
  world.entities[0].initialState={enabled:true};
  world.entities[0].physicsRequirement={bodyClass:'rigid'};
  const finding=compileValidationFindings({hard:[{code:'G_BELOW_GROUND',object:'box'}],advisory:[]},{worldRevisionId:'rev-1'});
  const context=buildWorldRevisionContext(world,finding);
  const proposal=createWorldRevisionProposal(context,{nextRevisionId:'rev-typed',edits:[
    {kind:'replace-asset',entityId:'box',asset:{assetId:'crate-v2'}},
    {kind:'set-initial-state',entityId:'box',state:{enabled:false,mode:'safe'}},
    {kind:'set-capability-intent',entityId:'box',capabilities:['pickup','place']},
    {kind:'set-physics-requirement',entityId:'box',requirement:{bodyClass:'rigid',requiredCapabilities:['collision']}},
  ]});
  expect(proposal.edits).toEqual([
    {kind:'replace-asset',entityId:'box',asset:{assetId:'crate-v2',query:'crate-v2',generate:false}},
    {kind:'set-initial-state',entityId:'box',state:{enabled:false,mode:'safe'}},
    {kind:'set-capability-intent',entityId:'box',capabilities:['PICKUP','PLACE']},
    {kind:'set-physics-requirement',entityId:'box',requirement:{bodyClass:'rigid',requiredCapabilities:['collision']}},
  ]);
  const next=applyWorldRevisionProposal(world,proposal,{acceptChangedPlan:true});
  expect(next.entities.find((entity)=>entity.id==='box')).toMatchObject({
    asset:{assetId:'crate-v2',query:'crate-v2',generate:false},
    initialState:{enabled:false,mode:'safe'},capabilityIntent:['PICKUP','PLACE'],
    physicsRequirement:{bodyClass:'rigid',requiredCapabilities:['collision']}
  });
});

it('uses canonical World IR validation for typed semantic edits and supports clearing physics requirements',()=>{
  const world=ir();
  world.entities[0].physicsRequirement={bodyClass:'rigid'};
  const finding=compileValidationFindings({hard:[{code:'G_BELOW_GROUND',object:'box'}],advisory:[]},{worldRevisionId:'rev-1'});
  const context=buildWorldRevisionContext(world,finding);
  expect(()=>createWorldRevisionProposal(context,{nextRevisionId:'rev-bad',edits:[
    {kind:'set-initial-state',entityId:'box',state:{lastVerifiedAction:'OPEN'}}
  ]})).toThrow(/reserved runtime state key/);
  const proposal=createWorldRevisionProposal(context,{nextRevisionId:'rev-clear',edits:[
    {kind:'set-physics-requirement',entityId:'box',requirement:null}
  ]});
  const next=applyWorldRevisionProposal(world,proposal,{acceptChangedPlan:true});
  expect(next.entities.find((entity)=>entity.id==='box')).not.toHaveProperty('physicsRequirement');
});


it('rejects empty bounded revision proposals before any changed-plan gate',()=>{
  const finding=compileValidationFindings({hard:[{code:'G_BELOW_GROUND',object:'box'}],advisory:[]},{worldRevisionId:'rev-1'});
  const context=buildWorldRevisionContext(ir(),finding);
  expect(()=>createWorldRevisionProposal(context,{nextRevisionId:'rev-empty',edits:[]})).toThrow(/at least one edit/);
});


it('classifies only pure semantic initial-state edits as incrementally recompilable',()=>{
  expect(classifyWorldRevisionImpact({edits:[
    {kind:'set-initial-state',entityId:'box',state:{enabled:false}},
    {kind:'set-initial-state',entityId:'table',state:{mode:'safe'}}
  ]})).toEqual({
    mode:'incremental-state',editKinds:['set-initial-state'],affectedEntityIds:['box','table'],domains:['state','acceptance']
  });
  expect(classifyWorldRevisionImpact({edits:[
    {kind:'set-initial-state',entityId:'box',state:{enabled:false}},
    {kind:'set-position',entityId:'box',position:[0,.2,0]}
  ]})).toEqual({
    mode:'full',editKinds:['set-initial-state','set-position'],affectedEntityIds:['box'],
    domains:['state','acceptance','transform','layout','spatial','physics','navigation']
  });
});


it('maps every typed revision edit to explicit compiler/runtime impact domains',()=>{
  const cases={
    'set-generation':['asset','generation','layout','behavior','physics','acceptance'],
    'replace-asset':['asset','generation','layout','behavior','physics','spatial','navigation','acceptance'],
    'set-capability-intent':['behavior','acceptance'],
    'set-physics-requirement':['physics','acceptance']
  };
  for(const [kind,domains] of Object.entries(cases)){
    expect(classifyWorldRevisionImpact({edits:[{kind,entityId:'box'}]})).toMatchObject({
      mode:kind==='set-capability-intent'?'incremental-behavior':kind==='set-physics-requirement'?'incremental-physics':'full',
      editKinds:[kind],affectedEntityIds:['box'],domains
    });
  }
});
