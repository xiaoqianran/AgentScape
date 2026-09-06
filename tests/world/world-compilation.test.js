import { describe, expect, it } from 'vitest';
import {
  WORLD_COMPILATION_SCHEMA,
  assertWorldIRReferences,
  compileWorldIR,
  projectWorldIRToWorldSpec
} from '../../world/compiler/WorldCompilation.js';
import { normalizeWorldIR } from '../../world/spec/WorldIR.js';

const richWorldIR = () => ({
  schema:'agentscape.world-ir',
  schemaVersion:1,
  revision:{id:'rev-rich'},
  provenance:{source:'planner',evidenceRefs:['intent-1']},
  intent:{name:'Rich Lab',task:'open the cabinet'},
  policy:{generation:{generate:false},physics:{fallbackPolicy:'deny'}},
  entities:[{
    id:'cabinet_01',
    asset:{assetId:'cabinet'},
    physicsRequirement:{bodyClass:'articulated',requiredCapabilities:['collision']},
    capabilityIntent:['open','close'],
    initialState:{locked:false}
  }],
  spatial:{relations:[],constraints:[]},
  interactions:[{id:'open-cabinet',targetId:'cabinet_01',capability:'open'}],
  rules:[],
  acceptance:[{id:'cabinet-exists',kind:'object-exists',targetId:'cabinet_01'}]
});

describe('WorldCompilation', () => {
  it('compiles one revision-bound execution context without erasing semantic World IR', () => {
    const compilation=compileWorldIR(richWorldIR());

    expect(compilation).toMatchObject({
      schema:WORLD_COMPILATION_SCHEMA,
      schemaVersion:2,
      worldRevisionId:'rev-rich',
      worldIR:{revision:{id:'rev-rich'}},
      assetRequests:[{
        id:'cabinet_01',assetId:'cabinet',query:'cabinet',generate:false
      }],
      entities:[{
        id:'cabinet_01',assetRef:{assetId:'cabinet'},
        capabilityIntent:['OPEN','CLOSE'],initialState:{locked:false}
      }],
      behaviorBundle:{worldRevisionId:'rev-rich',behaviorGraph:{commands:[{capability:'OPEN'}]}},
      physicsRequirements:{worldRevisionId:'rev-rich',requirements:[{entityId:'cabinet_01',bodyClass:'articulated'}]},
      acceptanceGraph:{checks:[{id:'cabinet-exists',kind:'object-exists',targetId:'cabinet_01'}]}
    });

    expect(compilation).not.toHaveProperty('worldSpec');
    expect(compilation).not.toHaveProperty('compatibility');
    expect(compilation.entities[0]).not.toHaveProperty('query');
    expect(compilation.entities[0]).not.toHaveProperty('generate');
    expect(compilation.entities[0]).not.toHaveProperty('provider');
  });

  it('keeps legacy WorldSpec as an explicit compatibility projection, not an executability gate', () => {
    const projection=projectWorldIRToWorldSpec(richWorldIR());
    expect(projection.assets[0]).toEqual({id:'cabinet_01',assetId:'cabinet',query:'cabinet',generate:false});
    expect(projection).not.toHaveProperty('interactions');
    expect(projection.assets[0]).not.toHaveProperty('initialState');
  });

  it('fails closed on dangling World IR references before runtime mutation', () => {
    const ir=normalizeWorldIR(richWorldIR());
    ir.acceptance[0].targetId='missing_01';

    let failure;
    try { assertWorldIRReferences(ir); } catch (error) { failure=error; }
    expect(failure).toMatchObject({
      code:'WORLD_IR_REFERENCE_INVALID',
      path:'acceptance[0].targetId',
      entityId:'missing_01'
    });
  });

  it('requires stable entity identity for semantic state or capability intent', () => {
    const input=richWorldIR();
    delete input.entities[0].id;
    input.interactions=[];
    input.acceptance=[];

    expect(() => compileWorldIR(input)).toThrow(/requires id for capabilityIntent or initialState/);
  });
});

it('fails closed when World IR contains spatial constraints without a compiler',()=>{
  const input=richWorldIR();
  input.spatial.constraints=[{id:'clearance-1',kind:'clearance',subject:'cabinet_01'}];
  let failure;
  try { compileWorldIR(input); } catch (error) { failure=error; }
  expect(failure).toMatchObject({code:'WORLD_IR_FEATURE_UNSUPPORTED',features:['spatial.constraints']});
});


it('rejects dangling relation acceptance references before runtime mutation',()=>{
  const input=richWorldIR();
  input.acceptance=[{id:'near-missing',kind:'relation-exists',subject:'cabinet_01',predicate:'NEAR',object:'missing_01'}];
  let failure;
  try { compileWorldIR(input); } catch (error) { failure=error; }
  expect(failure).toMatchObject({code:'WORLD_IR_REFERENCE_INVALID',path:'acceptance[0].object',entityId:'missing_01'});
});

it('fails closed on conflicting or ambiguous observation anchors and keeps them out of legacy projection',()=>{
  const anchored=richWorldIR();
  anchored.entities=[{id:'cup_01',asset:{assetId:'cup'},capabilityIntent:[],initialState:{}}];
  anchored.interactions=[]; anchored.acceptance=[];
  anchored.spatial.relations=[{subject:'cup_01',predicate:'NEAR',anchor:{kind:'observation',label:'bench'}}];
  const compiled=compileWorldIR(anchored);
  expect(compiled.relations).toEqual([{subject:'cup_01',predicate:'NEAR',anchor:{kind:'observation',label:'bench'}}]);
  let compatibilityFailure; try{projectWorldIRToWorldSpec(anchored);}catch(error){compatibilityFailure=error;}
  expect(compatibilityFailure).toMatchObject({code:'WORLD_IR_COMPATIBILITY_UNSUPPORTED',feature:'spatial.relations.anchor'});

  const explicit=structuredClone(anchored); explicit.entities[0].transform={position:[1,0,1]};
  let explicitFailure; try{compileWorldIR(explicit);}catch(error){explicitFailure=error;}
  expect(explicitFailure).toMatchObject({code:'WORLD_IR_OBSERVATION_ANCHOR_POSITION_CONFLICT',entityId:'cup_01'});

  const duplicate=structuredClone(anchored); duplicate.spatial.relations.push({subject:'cup_01',predicate:'NEAR',anchor:{kind:'observation',label:'door'}});
  let duplicateFailure; try{compileWorldIR(duplicate);}catch(error){duplicateFailure=error;}
  expect(duplicateFailure).toMatchObject({code:'WORLD_IR_OBSERVATION_ANCHOR_AMBIGUOUS',entityId:'cup_01'});
});
