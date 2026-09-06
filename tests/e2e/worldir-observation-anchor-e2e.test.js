import * as THREE from 'three';
import { expect, it } from 'vitest';
import { AssetManager } from '../../asset/AssetManager.js';
import { ObjectStore } from '../../world/runtime/ObjectStore.js';
import { SpatialSystem } from '../../world/runtime/systems/SpatialSystem.js';
import { SceneGraph } from '../../world/runtime/graph/SceneGraph.js';
import { createRapierPhysicsSystem } from '../helpers/createRapierPhysicsSystem.js';
import { createCanonicalWorldPipeline } from '../../world/compiler/createWorldPipeline.js';

it('compiles WorldIR cup NEAR an observed generated-world bench before spawn without objectizing the bench',async()=>{
  const assets=new AssetManager();
  const store=new ObjectStore();
  const scene=new THREE.Scene();
  const spatial=new SpatialSystem({store,scene});
  const sceneGraph=new SceneGraph({store,spatial});
  const physics=createRapierPhysicsSystem();
  await physics.init();
  physics.addEnvironment([
    {shape:'box',halfExtents:[4,.1,4],translation:[0,-.1,0]},
    {shape:'box',halfExtents:[.45,.45,.55],translation:[0,.45,0]}
  ],{id:'generated-garden'});
  sceneGraph.setEnvironmentSemantics('generated-garden',{
    schemaVersion:2,
    categories:['bench'],
    instances:[
      {id:'bench-low',label:'bench',confidence:.61,localization:{kind:'point-scale',center:[0,0,0],scale:.5}},
      {id:'bench-best',label:'bench',confidence:.94,localization:{kind:'point-scale',center:[0,0,0],scale:.5}}
    ]
  });
  const spawned=[];
  const runtime={
    events:null,trace:null,assets,store,scene,spatial,sceneGraph,physics,
    environment:{id:'generated-garden',layout:{bounds:{min:[-4,-4],max:[4,4]},groundY:0,margin:.5}},
    spawn:async(assetId,{id,position,initialState=null}={})=>{
      const {object,manifest}=await assets.instantiate(assetId);
      object.position.fromArray(position); object.updateWorldMatrix(true,true); scene.add(object);
      store.add(id,{id,assetId,object,manifest,state:{}}); physics.attach(id,manifest,object);
      spawned.push({id,assetId,position:[...position],initialState}); sceneGraph.changed(); return id;
    },
    interactions:{place:()=>{throw new Error('ON not expected')},placeInside:()=>{throw new Error('INSIDE not expected')},move:()=>{throw new Error('observation NEAR must compile before spawn')}},
    validator:{run:()=>({ok:true,counts:{hard:0,advisory:0},hard:[],advisory:[],findings:[],coverage:{objects:store.list().length,relations:0}})},
    repair:{repair:async()=>({})},
    serialize:()=>({schema:'agentscape.scene',objects:store.list().map(([id])=>id)}),
    loadRuleGraph:()=>{}
  };
  const ir={
    schema:'agentscape.world-ir',schemaVersion:1,revision:{id:'hybrid-worldir-1'},provenance:{source:'planner'},
    intent:{name:'Generated Garden',task:'put a cup near the bench'},
    entities:[{id:'cup_01',asset:{assetId:'cup'}}],
    spatial:{relations:[{subject:'cup_01',predicate:'NEAR',anchor:{kind:'observation',label:'bench'}}],constraints:[]},
    interactions:[],rules:[],acceptance:[]
  };
  const result=await createCanonicalWorldPipeline(runtime).run(ir);
  expect(result.state.reports.worldAdmission.status).toBe('ready');
  expect(result.state.reports.layoutAdmission).toMatchObject({
    status:'ready',
    observationAnchors:[{
      subject:'cup_01',status:'resolved',observedEntityId:'semantic-instance:bench-best',observationId:'bench-best',
      label:'bench',candidateCount:2,selection:'highest-confidence-then-id',confidence:.94,collisionVerified:true
    }]
  });
  expect(result.state.reports.relationAdmission.applied[0]).toMatchObject({
    subject:'cup_01',predicate:'NEAR',status:'compiled-before-spawn',observedEntityId:'semantic-instance:bench-best',collisionVerified:true
  });
  expect(spawned).toHaveLength(1);
  expect(spawned[0].id).toBe('cup_01');
  expect(spawned[0].position).toEqual(result.state.reports.layoutAdmission.observationAnchors[0].position);
  expect(physics.manifestPoseClear(assets.getManifest('cup'),spawned[0].position,{excludeIds:['cup_01']})).toMatchObject({checked:true,clear:true});
  expect(store.list().map(([id])=>id)).toEqual(['cup_01']);
  expect(store.list().some(([id])=>id.startsWith('semantic-instance:'))).toBe(false);
  expect(sceneGraph.list({predicate:'HAS_INSTANCE'})).toHaveLength(2);
  physics.dispose();
},30000);
