import { describe,expect,it } from 'vitest';
import { admitWorldBehavior,compileWorldBehaviorBundle } from '../src/pipeline/WorldBehaviorCompiler.js';
import { normalizeWorldIR } from '../src/pipeline/WorldIR.js';

const ir=()=>normalizeWorldIR({
  schema:'agentscape.world-ir',schemaVersion:1,revision:{id:'rev-b'},provenance:{source:'planner'},intent:{name:'Behavior Lab'},
  entities:[
    {id:'door',asset:{assetId:'cabinet'}},{id:'cup',asset:{assetId:'cup'}},{id:'table',asset:{assetId:'table'}},{id:'light',asset:{assetId:'light'}}
  ],
  interactions:[
    {id:'open-door',targetId:'door',capability:'open'},
    {id:'pick-cup',targetId:'cup',capability:'pickup'},
    {id:'place-cup',supportId:'table',capability:'place'},
    {id:'light-on',targetId:'light',capability:'switch',stateKey:'enabled',value:true}
  ],
  rules:[{id:'r1',event:'door.opened',condition:{kind:'equals',targetId:'light',stateKey:'enabled',value:false},effect:{kind:'set-state',targetId:'light',stateKey:'enabled',value:true}}]
});

describe('WorldBehaviorCompiler',()=>{
  it('compiles typed World IR interactions and rules into one revision-bound bundle',()=>{
    const bundle=compileWorldBehaviorBundle(ir());
    expect(bundle).toMatchObject({schema:'agentscape.world-behavior-bundle',schemaVersion:1,worldRevisionId:'rev-b'});
    expect(bundle.behaviorGraph.commands.map((x)=>x.capability)).toEqual(['OPEN','PICKUP','PLACE','SWITCH']);
    expect(bundle.ruleGraph.rules[0]).toMatchObject({id:'r1',effect:{kind:'set-state',targetId:'light',stateKey:'enabled',value:true}});
  });
  it('rejects interaction/rule references outside World IR entities before Runtime mutation',()=>{
    const bad=ir(); bad.interactions[0].targetId='missing';
    expect(()=>compileWorldBehaviorBundle(bad)).toThrow(/outside World IR entities/);
    const badRule=ir(); badRule.rules[0].effect.targetId='missing';
    expect(()=>compileWorldBehaviorBundle(badRule)).toThrow(/Rule target/);
  });
  it('admits behavior only when resolved manifests support executable capabilities',()=>{
    const bundle=compileWorldBehaviorBundle(ir());
    const resolvedAssets=[{id:'door',assetId:'cabinet'},{id:'cup',assetId:'cup'},{id:'table',assetId:'table'},{id:'light',assetId:'light'}];
    const manifests={cabinet:{actions:['open','close','move']},cup:{actions:['pickup','drop','place','move']},table:{actions:['move']},light:{actions:['move']}};
    expect(admitWorldBehavior(bundle,{resolvedAssets,getManifest:id=>manifests[id]})).toEqual({status:'ready',issues:[]});
    manifests.cabinet={actions:['move']};
    expect(admitWorldBehavior(bundle,{resolvedAssets,getManifest:id=>manifests[id]})).toMatchObject({status:'rejected',issues:[{code:'BEHAVIOR_CAPABILITY_UNSUPPORTED',targetId:'door',capability:'OPEN'}]});
  });
});
