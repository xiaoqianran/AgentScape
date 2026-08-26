import { describe, expect, it } from 'vitest';
import { normalizeWorldSpec } from '../src/pipeline/WorldSpec.js';
import { WORLD_IR_SCHEMA, WORLD_IR_VERSION, normalizeWorldIR, parseWorldIR, serializeWorldIR, upgradeLegacyWorldSpec } from '../src/pipeline/WorldIR.js';
import { compileWorldIR, compileWorldInput, projectWorldIRToWorldSpec } from '../src/pipeline/WorldCompilation.js';

describe('WorldIR',()=>{
  it('keeps legacy WorldSpec behind an explicit compatibility upgrade',()=>{
    const legacy={name:'AI Lab',description:'Move the cup',generation:{provider:'embodiedgen',generate:true},assets:[{id:'bench_01',type:'workbench',position:[1,0,2]},{id:'cup_01',assetId:'cup',generate:false}],relations:[{subject:'cup_01',predicate:'on',object:'bench_01',surfaceId:'top'}]};
    let failure; try{normalizeWorldIR(legacy);}catch(error){failure=error;}
    expect(failure).toMatchObject({code:'WORLD_IR_SCHEMA_REQUIRED'});
    const ir=upgradeLegacyWorldSpec(legacy);
    expect(ir).toMatchObject({schema:WORLD_IR_SCHEMA,schemaVersion:WORLD_IR_VERSION,revision:{id:'legacy-root'},provenance:{source:'legacy-world-spec',evidenceRefs:[]},intent:{name:'AI Lab',description:'Move the cup'}});
    expect(compileWorldInput(legacy).worldIR).toEqual(normalizeWorldIR(ir));
    expect(projectWorldIRToWorldSpec(ir)).toEqual(normalizeWorldSpec(legacy));
  });
  it('normalizes revision, provenance, physics requirements, capability intent, rules and acceptance',()=>{
    const ir=normalizeWorldIR({schema:WORLD_IR_SCHEMA,schemaVersion:1,revision:{id:'rev-2',parentId:'rev-1',reason:'cabinet blocked'},provenance:{source:'planner-revision',sourceId:'finding-7',createdBy:'planner',evidenceRefs:['finding-7','trace-2']},intent:{name:'Lab',description:'Retrieve box',task:'place box on table'},policy:{generation:{provider:'embodiedgen',generate:false},physics:{fallbackPolicy:'deny'}},entities:[{id:'cabinet_01',asset:{assetId:'cabinet',query:'cabinet'},physicsRequirement:{bodyClass:'articulated',requiredCapabilities:['collision','snapshot-restore'],executionMode:'realtime',qualityPolicy:{deterministicRequired:true,fallbackPolicy:'deny'}},capabilityIntent:['open','close'],initialState:{locked:false}}],spatial:{relations:[],constraints:[{id:'clearance-1',kind:'clearance',subject:'cabinet_01',description:'door sweep must stay clear'}]},interactions:[{id:'open-cabinet',targetId:'cabinet_01',capability:'open'}],rules:[{id:'rule-1',event:'cabinet.opened',condition:{kind:'equals',targetId:'cabinet_01',stateKey:'locked',value:false},effect:{kind:'set-state',targetId:'cabinet_01',stateKey:'alarm',value:true}}],acceptance:[{id:'accept-open',kind:'interaction-verified',targetId:'cabinet_01',capability:'open',description:'door can be verified open'}]});
    expect(ir.revision.parentId).toBe('rev-1'); expect(ir.provenance.evidenceRefs).toEqual(['finding-7','trace-2']); expect(ir.entities[0].capabilityIntent).toEqual(['OPEN','CLOSE']); expect(ir.interactions[0].capability).toBe('OPEN'); expect(ir.rules[0].effect).toMatchObject({kind:'set-state',targetId:'cabinet_01'}); expect(ir.acceptance[0].capability).toBe('OPEN');
  });
  it('serializes/parses without losing identity',()=>{
    const source={schema:WORLD_IR_SCHEMA,schemaVersion:1,revision:{id:'rev-3'},provenance:{source:'planner',evidenceRefs:['finding-1']},intent:{name:'Lab'},entities:[{id:'box',asset:{assetId:'crate'}}]};
    expect(parseWorldIR(serializeWorldIR(source))).toEqual(normalizeWorldIR(source));
    let failure; try{parseWorldIR('{broken');}catch(error){failure=error;} expect(failure).toMatchObject({code:'WORLD_IR_JSON_INVALID'});
  });
  it('keeps rich semantics executable without routing them through the compatibility projection',()=>{
    const ir=normalizeWorldIR({schema:WORLD_IR_SCHEMA,schemaVersion:1,revision:{id:'root'},provenance:{source:'planner'},intent:{name:'Lab'},entities:[{id:'door_01',asset:{assetId:'cabinet'},capabilityIntent:['open']}],interactions:[{id:'open-door',targetId:'door_01',capability:'open'}]});
    const compilation=compileWorldIR(ir);
    expect(compilation.behaviorBundle).toMatchObject({capabilityIntents:[{entityId:'door_01',capabilities:['OPEN']}],behaviorGraph:{commands:[{targetId:'door_01',capability:'OPEN'}]}});
    expect(projectWorldIRToWorldSpec(ir)).toMatchObject({schema:1,assets:[{id:'door_01',assetId:'cabinet'}]});
  });
  it('rejects malformed identities and unknown fields',()=>{
    expect(()=>normalizeWorldIR({schema:WORLD_IR_SCHEMA,schemaVersion:1,revision:{id:'same',parentId:'same'},provenance:{source:'planner'}})).toThrow(/parentId/);
    expect(()=>normalizeWorldIR({schema:WORLD_IR_SCHEMA,schemaVersion:1,revision:{id:'r1'},provenance:{source:'planner'},unexpected:true})).toThrow('WorldIR unknown field: unexpected');
  });
});
