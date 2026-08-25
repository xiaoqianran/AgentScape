import { describe, expect, it } from 'vitest';
import { buildWorldRevisionContext, createWorldRevisionProposal, applyWorldRevisionProposal } from '../src/pipeline/WorldRevision.js';
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
