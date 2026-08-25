import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { SceneSerializer } from '../src/persistence/SceneSerializer.js';
import { ObjectStore } from '../src/runtime/ObjectStore.js';

function fakeRuntime() {
  const store = new ObjectStore();
  const object = new THREE.Group();
  object.position.set(1, 2, 3);
  object.quaternion.setFromEuler(new THREE.Euler(0, 0.5, 0));
  object.scale.set(1, 1, 1);
  store.add('cabinet_01', {
    id: 'cabinet_01', assetId: 'cabinet', object,
    manifest: { id: 'cabinet', type: 'cabinet', source: { kind: 'glb', url: 'assets/cabinet.glb' }, actions: ['open'] },
    state: { door: 'open' }
  });
  return {
    version: '0.8.0', store,
    assets: { getManifest: vi.fn(() => ({ id: 'cabinet', type: 'cabinet', source: { kind: 'glb', url: 'assets/cabinet.glb' }, actions: ['open'] })) },
    camera: { position: new THREE.Vector3(4,5,6) },
    controls: { target: new THREE.Vector3(0,1,0) }
  };
}

describe('SceneSerializer', () => {
  it('serializes versioned scene data including dynamic manifests and state', () => {
    const scene = new SceneSerializer().serialize(fakeRuntime(), { name: 'Test' });
    expect(scene.schema).toBe('agentscape.scene');
    expect(scene.schemaVersion).toBe(1);
    expect(scene.objects[0]).toMatchObject({ id: 'cabinet_01', assetId: 'cabinet', state: { door: 'open' } });
    expect(scene.assets[0].id).toBe('cabinet');
  });

  it('rejects unknown scene versions', () => {
    const serializer = new SceneSerializer();
    expect(() => serializer.validate({ schema: 'agentscape.scene', schemaVersion: 99, objects: [], assets: [] })).toThrow(/version/);
  });

  it('preflights unknown asset references before clearing the current world', async () => {
    const serializer = new SceneSerializer();
    const runtime = {
      assets: {
        assertCompatibleManifest: vi.fn(),
        has: vi.fn(() => false)
      },
      clearObjects: vi.fn(),
      sceneGraph: { batch: vi.fn(async (operation) => operation()) }
    };
    const scene = {
      schema: 'agentscape.scene', schemaVersion: 1, assets: [], relations: [],
      objects: [{ id:'missing_01', assetId:'missing', transform:{ position:[0,0,0], quaternion:[0,0,0,1], scale:[1,1,1] } }]
    };

    await expect(serializer.restore(runtime, scene)).rejects.toThrow(/unknown asset/i);
    expect(runtime.clearObjects).not.toHaveBeenCalled();
    expect(runtime.sceneGraph.batch).not.toHaveBeenCalled();
  });

  it('preflights manifest conflicts before clearing the current world', async () => {
    const serializer = new SceneSerializer();
    const runtime = {
      assets: {
        assertCompatibleManifest: vi.fn(() => { throw new Error('Asset id conflict: chair'); }),
        has: vi.fn(() => true)
      },
      clearObjects: vi.fn(),
      sceneGraph: { batch: vi.fn(async (operation) => operation()) }
    };
    const scene = {
      schema: 'agentscape.scene', schemaVersion: 1,
      assets: [{ id:'chair', type:'chair', source:{kind:'glb',url:'chair.glb'}, actions:['move'] }], relations: [], objects: []
    };

    await expect(serializer.restore(runtime, scene)).rejects.toThrow(/conflict/i);
    expect(runtime.clearObjects).not.toHaveBeenCalled();
    expect(runtime.sceneGraph.batch).not.toHaveBeenCalled();
  });

});

it('persists environment identity and rejects cross-world restore before mutation', async () => {
  const serializer = new SceneSerializer();
  const source = fakeRuntime();
  source.environment={id:'ruined-courtyard'};
  const scene=serializer.serialize(source,{name:'Ruins'});
  expect(scene.metadata.environment).toBe('ruined-courtyard');

  const runtime={
    environment:{id:'monument-hall'},
    assets:{assertCompatibleManifest:vi.fn(),has:vi.fn(()=>true)},
    clearObjects:vi.fn(),
    sceneGraph:{batch:vi.fn(async(operation)=>operation())}
  };
  await expect(serializer.restore(runtime,scene)).rejects.toThrow(/environment mismatch/i);
  expect(runtime.clearObjects).not.toHaveBeenCalled();
  expect(runtime.sceneGraph.batch).not.toHaveBeenCalled();
});



it('rejects broken or duplicate heldBy ownership before world mutation', () => {
  const serializer=new SceneSerializer();
  const base=(id,assetId,state={})=>({id,assetId,state,transform:{position:[0,0,0],quaternion:[0,0,0,1],scale:[1,1,1]}});
  expect(()=>serializer.validate({schema:'agentscape.scene',schemaVersion:1,assets:[],relations:[],objects:[base('cup','cup',{heldBy:{kind:'agent',id:'missing',anchor:'hold'}})]})).toThrow(/heldBy agent is missing/);
  expect(()=>serializer.validate({schema:'agentscape.scene',schemaVersion:1,assets:[],relations:[],objects:[
    base('agent','agent'),
    base('cup1','cup',{heldBy:{kind:'agent',id:'agent',anchor:'hold'}}),
    base('cup2','cup',{heldBy:{kind:'agent',id:'agent',anchor:'hold'}})
  ]})).toThrow(/multiple held objects/);
});


it('persists world revision and acceptance evidence without promoting restored evidence to current truth', async () => {
  const serializer=new SceneSerializer();
  const source=fakeRuntime();
  source.currentWorldRevision={revision:{id:'rev-7',parentId:'rev-6'},provenance:{source:'planner',evidenceRefs:['finding-1']}};
  source.lastAcceptanceBundle={schema:'agentscape.acceptance-evidence',schemaVersion:1,required:true,source:'world-pipeline',worldRevisionId:'rev-7',criteria:[{id:'valid',kind:'world-valid'}],result:{status:'world-accepted',checks:[],verifiedCount:1,failedCount:0}};
  const scene=serializer.serialize(source,{name:'Accepted'});
  expect(scene.metadata.worldRevision).toMatchObject({revision:{id:'rev-7'},provenance:{source:'planner'}});
  expect(scene.verification.acceptanceEvidence).toMatchObject({worldRevisionId:'rev-7',result:{status:'world-accepted'}});

  const restored={
    environment:null,
    assets:{assertCompatibleManifest:vi.fn(),has:vi.fn(()=>true)},
    sceneGraph:{batch:vi.fn(async(operation)=>operation()),changed:vi.fn()},
    clearObjects:vi.fn(),spawn:vi.fn(async()=>{}),store:{get:vi.fn(()=>({object:new THREE.Group(),state:{}}))},
    physics:{syncTransform:vi.fn()},restoreObjectState:vi.fn(),interactions:{rebuildHeldOwnership:vi.fn()},
    camera:{position:new THREE.Vector3()},controls:{target:new THREE.Vector3(),update:vi.fn()},events:{emit:vi.fn()},
    lastAcceptanceBundle:{required:true,result:{status:'world-accepted'}}
  };
  await serializer.restore(restored,{...scene,objects:[],assets:[]});
  expect(restored.currentWorldRevision).toMatchObject({revision:{id:'rev-7'}});
  expect(restored.restoredAcceptanceEvidence).toMatchObject({worldRevisionId:'rev-7',result:{status:'world-accepted'}});
  expect(restored.lastAcceptanceBundle).toBeNull();
});

it('rejects acceptance evidence attached to a different world revision before mutation', async () => {
  const serializer=new SceneSerializer();
  const scene={
    schema:'agentscape.scene',schemaVersion:1,assets:[],objects:[],relations:[],
    metadata:{worldRevision:{revision:{id:'rev-current'},provenance:{source:'planner'}}},
    verification:{acceptanceEvidence:{schema:'agentscape.acceptance-evidence',schemaVersion:1,required:true,worldRevisionId:'rev-other',criteria:[],result:{status:'world-accepted'}}}
  };
  const runtime={clearObjects:vi.fn()};
  await expect(serializer.restore(runtime,scene)).rejects.toThrow(/revision mismatch/i);
  expect(runtime.clearObjects).not.toHaveBeenCalled();
});
