import { describe, expect, it } from 'vitest';
import { buildWorldProposal } from '../world/spec/WorldPlannerProposal.js';

const proposal=()=>({
  intent:{name:'Planner Lab',task:'place the cup on the table'},
  entities:[
    {id:'cup_01',asset:{assetId:'cup'},capabilityIntent:['PICKUP']},
    {id:'table_01',asset:{assetId:'table'}}
  ],
  spatial:{relations:[{subject:'cup_01',predicate:'NEAR',object:'table_01'}]},
  interactions:[{id:'place-cup',supportId:'table_01',capability:'PLACE'}],
  rules:[],
  acceptance:[{id:'cup-on-table',kind:'relation-exists',subject:'cup_01',predicate:'ON',object:'table_01'}]
});

describe('WorldPlannerProposal',()=>{
  it('seals model semantics with Runtime-owned revision and provenance before canonical compile',()=>{
    const result=buildWorldProposal(proposal(),{revisionId:'world-rev-1'});
    expect(result).toMatchObject({
      schema:'agentscape.world-proposal',schemaVersion:1,status:'world-proposal-ready',
      worldIR:{
        schema:'agentscape.world-ir',schemaVersion:1,
        revision:{id:'world-rev-1'},provenance:{source:'agent-world-planner',createdBy:'agent'},
        intent:{name:'Planner Lab'},entities:[{id:'cup_01'},{id:'table_01'}]
      },
      summary:{worldRevisionId:'world-rev-1',entities:2,interactions:1,rules:0,physicsRequirements:0,acceptanceChecks:1}
    });
  });

  it('rejects model attempts to smuggle identity or provenance into the semantic body',()=>{
    expect(()=>buildWorldProposal({...proposal(),revision:{id:'model-owned'}},{revisionId:'runtime-owned'})).toThrow(/unknown field: revision/);
    try { buildWorldProposal({...proposal(),provenance:{source:'model'}},{revisionId:'runtime-owned'}); }
    catch (error) { expect(error).toMatchObject({code:'WORLD_PROPOSAL_FIELD_INVALID',field:'provenance'}); }
  });

  it('fails preflight when the proposal contains semantics the canonical compiler cannot execute',()=>{
    const body=proposal();
    body.spatial.constraints=[{id:'clearance',kind:'clearance',subject:'cup_01',object:'table_01'}];
    let failure;
    try { buildWorldProposal(body,{revisionId:'world-rev-2'}); } catch (error) { failure=error; }
    expect(failure).toMatchObject({code:'WORLD_IR_FEATURE_UNSUPPORTED',features:['spatial.constraints']});
  });
});

it('creates a Runtime-owned child revision with deduplicated rejection evidence',()=>{
  const result=buildWorldProposal(proposal(),{
    revisionId:'world-rev-2',parentRevisionId:'world-rev-1',reason:'ASSET_UNRESOLVED',
    evidenceRefs:['finding-1','finding-1','retry-1']
  });
  expect(result.worldIR).toMatchObject({
    revision:{id:'world-rev-2',parentId:'world-rev-1',reason:'ASSET_UNRESOLVED'},
    provenance:{source:'agent-world-planner',evidenceRefs:['finding-1','retry-1']}
  });
});
