import { createRapierPhysicsSystem } from './helpers/createRapierPhysicsSystem.js';
import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { AssetCompiler } from '../asset/compiler/AssetCompiler.js';
import { AssetManager } from '../asset/AssetManager.js';
import { ObjectStore } from '../world/runtime/ObjectStore.js';
import { disposeObject3D } from '../core/disposeObject3D.js';
import { ArticulationVerifier } from '../world/verification/ArticulationVerifier.js';

class MemoryStore {
  constructor(){ this.map=new Map(); }
  async put(key,bytes,metadata){ this.map.set(key,{bytes,metadata}); }
  async get(key){ return this.map.get(key) || null; }
}

it('loads a materialized articulated compile result and attaches distinct root/Part colliders in Rapier', async () => {
  globalThis.ProgressEvent ||= class ProgressEvent { constructor(type, init={}) { this.type=type; Object.assign(this, init); } };
  const bytes=new Uint8Array(await readFile('public/assets/cabinet.glb'));
  const store=new MemoryStore();
  const provider={
    endpoint:'https://provider.test', isConfigured:()=>true,
    run:vi.fn(async()=>({
      partSegmentation:{
        version:1,source:'external-segmenter',faceCount:12,
        segments:[{id:'door',faceCount:12,confidence:.95,semantic:'door'}],
        materialization:{sourceNode:'Door',primitives:[{primitive:0,faceLabels:Array(12).fill('door')}]}
      },
      partProposal:{
        version:1,source:'joint-provider',confidence:.9,
        parts:[{
          id:'door',parent:'$root',semantic:'door',actions:['open','close'],targets:{open:-1.2,close:0},
          joint:{type:'revolute',axis:[0,1,0],limits:[-1.2,0],parentAnchor:[-.82,1,.355],childAnchor:[-.81,0,0],motor:{stiffness:60,damping:10}}
        }]
      }
    }))
  };
  const result=await new AssetCompiler({store,provider,version:'test'}).compile({bytes,sourceName:'cabinet.glb',assetId:'runtime_cabinet'});

  expect(result.partProposal.promoted).toEqual(['door']);
  expect(result.manifest.parts.door.physics.collider.strategy).toBe('owned-mesh-aabb');
  expect(result.partCollision.final.rootMeshNodes).toEqual(['Body']);
  expect(result.partCollision.final.generated[0].meshNodes).toEqual(['Door__part_door']);
  expect(result.quality.advisory.map((item)=>item.code)).toEqual(expect.arrayContaining(['COLLIDER_COARSE','PART_COLLIDER_COARSE','ARTICULATION_UNVERIFIED']));

  const assets=new AssetManager({manifests:{},compiledStore:store});
  assets.registerManifest(result.manifest);
  const {object,manifest}=await assets.instantiate(result.manifest.id);
  expect(object.getObjectByName('Door__part_door')).toBeTruthy();

  const physics=createRapierPhysicsSystem();
  await physics.init();
  const entry=physics.attach('cabinet_1',manifest,object);
  expect(entry.parts.has('door')).toBe(true);
  expect(entry.body.numColliders()).toBe(result.manifest.physics.colliders.length);
  expect(entry.parts.get('door').body.numColliders()).toBe(result.manifest.parts.door.physics.colliders.length);
  expect(physics.world.bodies.len()).toBe(2);

  const runtimeStore=new ObjectStore();
  runtimeStore.add('cabinet_1',{id:'cabinet_1',assetId:manifest.id,object,manifest,state:{}});
  const door=object.getObjectByName('Door__part_door');
  const initial=door.quaternion.clone();
  expect(physics.setArticulationTarget('cabinet_1','door',-1.2)).toBe(true);
  for(let i=0;i<240;i++) physics.step(1/60,runtimeStore);
  expect(2*Math.acos(Math.min(1,Math.abs(initial.dot(door.quaternion))))).toBeGreaterThan(.5);
  expect(physics.setArticulationTarget('cabinet_1','door',0)).toBe(true);
  for(let i=0;i<240;i++) physics.step(1/60,runtimeStore);
  expect(2*Math.acos(Math.min(1,Math.abs(initial.dot(door.quaternion))))).toBeLessThan(.08);

  physics.dispose();
  disposeObject3D(object);

  const verification=await new ArticulationVerifier({assets,steps:240}).verify(result.manifest.id);
  expect(verification.ok).toBe(true);
  expect(verification.parts[0].actions.map((action)=>action.targetReached)).toEqual([true,true]);
  expect(verification.parts[0].actions.every((action)=>action.collisionRegressions.length===0)).toBe(true);
  expect(verification.parts[0].baselinePenetrations[0]?.key).toBe('door[0]->$root[0]');
  expect(verification.parts[0].reversibility.ok).toBe(true);
}, 15000);
