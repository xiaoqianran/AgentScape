import * as THREE from 'three';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createAssetModule } from '../../asset/AssetModule.js';
import { createArtifactModule } from '../../artifact/ArtifactModule.js';
import { loadGeneratedWorld } from '../../world/loadGeneratedWorld.js';
import { PromptHybridWorldOrchestrator } from '../../generation/orchestration/PromptHybridWorldOrchestrator.js';
import { WorldRuntime } from '../../world/runtime/WorldRuntime.js';
import { SceneGraph } from '../../world/runtime/graph/SceneGraph.js';
import { SpatialSystem } from '../../world/runtime/systems/SpatialSystem.js';
import { createRapierPhysicsSystem } from '../helpers/createRapierPhysicsSystem.js';

const text=(value)=>new TextEncoder().encode(value);
const floorPly=text(`ply\nformat ascii 1.0\nelement vertex 4\nproperty float x\nproperty float y\nproperty float z\nelement face 2\nproperty list uchar int vertex_indices\nend_header\n-4 0 -4\n4 0 -4\n4 0 4\n-4 0 4\n3 0 2 1\n3 0 3 2\n`);
const visual=new Uint8Array([0x4e,0x47,0x53,0x50,4,0,0,0,1,0,0,0]);
const semantics=(label='bench')=>text(JSON.stringify({schemaVersion:2,categories:[label],instances:[{id:`${label}-best`,label,confidence:.94,localization:{kind:'point-scale',center:[0,0,0],scale:.5}}]}));

const hash=(bytes)=>`sha256:${createHash('sha256').update(bytes).digest('hex')}`;

async function seedImportedGeneration(artifactByteStore,label='bench'){
  const manifestBytes=text(JSON.stringify({
    schemaVersion:1,id:'generated-garden',coordinateSystem:'y-up',metersPerUnit:1,
    layout:{bounds:{min:[-4,-4],max:[4,4]},groundY:0,margin:.5},
    artifacts:{
      environment:{path:'environment.ply'},semantics:{path:'semantics.json'},visual:{path:'visual.spz'},navigation:{path:'navigation.ply'}
    }
  }));
  const entries=[
    ['world-mesh','model/ply','ply',floorPly],
    ['world-semantics','application/json','json',semantics(label)],
    ['world-visual','model/spz','spz',visual],
    ['world-manifest','application/json','json',manifestBytes],
    ['world-navigation','model/ply','ply',floorPly]
  ];
  const artifacts={};
  for(const [role,mime,format,data] of entries){
    const artifactId=`p5_${role.replaceAll('-','_')}_${label}`;
    const cacheKey=`cache_${role.replaceAll('-','_')}_${label}`;
    const digest=hash(data);
    const writer=artifactByteStore.begin({artifactId,maxBytes:data.byteLength});
    await writer.write(data);
    await writer.commit({key:cacheKey,hash:digest,mime,bytes:data.byteLength});
    artifacts[role]={
      status:'artifact-imported',cacheKey,reused:false,
      artifact:{id:artifactId,role,mime,format,bytes:data.byteLength,hash:digest,integrity:'verified',producer:{provider:'modal-world'},lineage:{parents:[]}}
    };
  }
  return {
    status:'world-artifacts-ready',prompt:'a compact garden',
    route:{kind:'text-image-world',image:{provider:'modal-2d',operation:'modal-2d.image.text_to_image.v1'},world:{provider:'modal-world',operation:'modal-world.world.image_to_world.v1'}},
    jobs:{image:'job_image',world:'job_world'},sourceArtifact:{id:'image_1',role:'primary-image',mime:'image/png',hash:hash(text('image'))},artifacts
  };
}

const oldEnvironment=()=>{
  const root=new THREE.Group();
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(8,8),new THREE.MeshBasicMaterial());
  floor.rotation.x=-Math.PI/2; root.add(floor); root.updateMatrixWorld(true);
  return {
    id:'old-world',root,floor,navigationRoot:root,
    colliders:[{shape:'box',halfExtents:[4,.1,4],translation:[0,-.1,0]}],
    layout:{bounds:{min:[-4,-4],max:[4,4]},groundY:0,margin:.5},semantics:null,
    dispose:vi.fn(()=>{floor.geometry.dispose();floor.material.dispose();})
  };
};

const generatedEnvironment=async(label='bench')=>loadGeneratedWorld({
  id:'generated-garden',mesh:{data:floorPly,format:'ply'},navigation:{data:floorPly,format:'ply'},
  semantics:{data:semantics(label),format:'json'},visual:{data:visual,format:'spz'},coordinateSystem:'y-up',
  layout:{bounds:{min:[-4,-4],max:[4,4]},groundY:0,margin:.5}
});

const generationResult=()=>({
  status:'world-artifacts-ready',prompt:'a compact garden',
  route:{kind:'text-image-world',image:{provider:'modal-2d',operation:'modal-2d.image.text_to_image.v1'},world:{provider:'modal-world',operation:'modal-world.world.image_to_world.v1'}},
  jobs:{image:'job_image',world:'job_world'},sourceArtifact:{id:'image_1',role:'primary-image',mime:'image/png',hash:'sha256:image'},
  artifacts:Object.fromEntries(['world-mesh','world-semantics','world-visual','world-manifest','world-navigation'].map((role)=>[role,{artifact:{id:`artifact_${role}`,role,mime:role.includes('semantics')||role.includes('manifest')?'application/json':role==='world-visual'?'model/spz':'model/ply',format:role.includes('semantics')||role.includes('manifest')?'json':role==='world-visual'?'spz':'ply',bytes:10,hash:`sha256:${role}`,integrity:'verified'}}]))
});

async function runtimeFixture(){
  const artifactModule=createArtifactModule();
  const runtime=new WorldRuntime({appendChild(){}},{environmentFactory:()=>null,assetModule:createAssetModule(),physicsFactory:createRapierPhysicsSystem});
  runtime.scene=new THREE.Scene(); await runtime.physics.init();
  runtime.rendering={applyEnvironment:vi.fn(),cameraState:()=>null};
  runtime.spatial=new SpatialSystem({store:runtime.store,scene:runtime.scene});
  runtime.sceneGraph=new SceneGraph({store:runtime.store,spatial:runtime.spatial,events:runtime.events});
  runtime.validator={run:()=>({ok:true,counts:{hard:0,advisory:0},hard:[],advisory:[],findings:[],coverage:{objects:runtime.store.list().length,relations:runtime.sceneGraph.list().length}})};
  runtime.repair={repair:async()=>({})};
  const initial=oldEnvironment(); runtime.installEnvironment(initial); runtime.createEnvironmentSystems();
  return {runtime,initial,artifactModule};
}

const proposal=(anchorLabel='bench')=>({
  intent:{name:'Generated Garden',task:'put a pickup-able cup near the bench'},
  entities:[{id:'cup_01',asset:{assetId:'cup'},capabilityIntent:['PICKUP']}],
  spatial:{relations:[{subject:'cup_01',predicate:'NEAR',anchor:{kind:'observation',label:anchorLabel}}]},
  interactions:[],rules:[],acceptance:[]
});

describe('Prompt → Generated World → Hybrid WorldIR product E2E',()=>{
  it('uses the verified local ArtifactByteStore bundle through the default materializer before canonical world execution',async()=>{
    const {runtime,initial,artifactModule}=await runtimeFixture();
    const generation=await seedImportedGeneration(artifactModule.byteStore,'bench');
    const orchestrator=new PromptHybridWorldOrchestrator(runtime,{
      generateWorldArtifacts:async()=>generation,artifactByteStore:artifactModule.byteStore,revisionIdFactory:()=> 'world-product-byte-store'
    });
    const result=await orchestrator.run({environmentPrompt:'a compact garden',proposal:proposal()});
    expect(result).toMatchObject({
      status:'world-ready',worldRevisionId:'world-product-byte-store',
      generation:{artifacts:{'world-manifest':{integrity:'verified'},'world-mesh':{integrity:'verified'},'world-semantics':{integrity:'verified'}}},
      environment:{id:'generated-garden',semantics:{instanceCount:1,labels:['bench']},navigation:{available:true}},
      admission:{status:'ready',relations:{applied:[{observedEntityId:'semantic-instance:bench-best',collisionVerified:true}]}}
    });
    expect(runtime.environment.id).toBe('generated-garden');
    expect(initial.dispose).toHaveBeenCalledOnce();
    expect(runtime.store.list().map(([id])=>id)).toEqual(['cup_01']);
    runtime.remove('cup_01',{silent:true}); runtime.navigation.dispose(); runtime.physics.dispose(); runtime.environment.dispose();
  },30000);

  it('turns one product request into a generated semantic background plus a verified executable cup',async()=>{
    const {runtime,initial}=await runtimeFixture();
    const next=await generatedEnvironment('bench');
    const orchestrator=new PromptHybridWorldOrchestrator(runtime,{
      generateWorldArtifacts:async()=>generationResult(),materializeEnvironment:async()=>next,revisionIdFactory:()=> 'world-product-1'
    });
    const result=await orchestrator.run({environmentPrompt:'a compact garden',proposal:proposal()});
    expect(result).toMatchObject({
      status:'world-ready',worldRevisionId:'world-product-1',generation:{status:'world-artifacts-ready',route:{kind:'text-image-world'}},
      environment:{id:'generated-garden',semantics:{instanceCount:1,labels:['bench']},navigation:{available:true}},
      admission:{status:'ready',relations:{status:'ready',applied:[{subject:'cup_01',predicate:'NEAR',status:'compiled-before-spawn',observedEntityId:'semantic-instance:bench-best',collisionVerified:true}]}},
      objects:[{id:'cup_01',asset:'cup'}]
    });
    expect(runtime.environment).toBe(next);
    expect(initial.dispose).toHaveBeenCalledOnce();
    expect(runtime.store.list().map(([id])=>id)).toEqual(['cup_01']);
    expect(runtime.store.list().some(([id])=>id.startsWith('semantic-instance:'))).toBe(false);
    expect(runtime.sceneGraph.list({predicate:'HAS_INSTANCE'})).toHaveLength(1);
    const route=await runtime.navigation.findPath([-3,0,-3],[3,0,-3]);
    expect(route.reachable).toBe(true);
    runtime.remove('cup_01',{silent:true}); runtime.navigation.dispose(); runtime.physics.dispose(); next.dispose();
  },30000);



  it('disposes a materialized candidate when another mutation owns the commit lock before replacement starts',async()=>{
    const {runtime,initial}=await runtimeFixture();
    const next=await generatedEnvironment('bench');
    const disposed=vi.spyOn(next,'dispose');
    runtime.mutationOwner='other-mutation';
    const orchestrator=new PromptHybridWorldOrchestrator(runtime,{
      generateWorldArtifacts:async()=>generationResult(),materializeEnvironment:async()=>next,revisionIdFactory:()=> 'never-issued'
    });
    await expect(orchestrator.run({environmentPrompt:'a compact garden',proposal:proposal()})).rejects.toMatchObject({code:'WORLD_MUTATION_BUSY'});
    expect(runtime.environment).toBe(initial);
    expect(disposed).toHaveBeenCalledOnce();
    expect(runtime.store.list()).toHaveLength(0);
    runtime.mutationOwner=null; runtime.navigation.dispose(); runtime.physics.dispose(); initial.dispose();
  });

  it('restores the previous Environment and Scene when the requested observation anchor does not exist',async()=>{
    const {runtime,initial}=await runtimeFixture();
    await runtime.spawn('table',{id:'old_table',position:[2,.01,2]});
    const next=await generatedEnvironment('tree');
    const orchestrator=new PromptHybridWorldOrchestrator(runtime,{
      generateWorldArtifacts:async()=>generationResult(),materializeEnvironment:async()=>next,revisionIdFactory:()=> 'world-product-rejected'
    });
    const result=await orchestrator.run({environmentPrompt:'a compact garden',proposal:proposal('bench')});
    expect(result).toMatchObject({status:'world-rejected',rolledBack:true});
    expect(runtime.environment).toBe(initial);
    expect(runtime.store.has('old_table')).toBe(true);
    expect(runtime.store.has('cup_01')).toBe(false);
    expect(runtime.scene.children).toContain(initial.root);
    expect(runtime.scene.children).not.toContain(next.root);
    expect(next.root.children.length).toBeGreaterThanOrEqual(1);
    runtime.remove('old_table',{silent:true}); runtime.navigation.dispose(); runtime.physics.dispose(); initial.dispose();
  },30000);
});
