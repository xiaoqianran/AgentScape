import * as THREE from 'three';
import { expect, it } from 'vitest';
import { AssetManager } from '../asset/AssetManager.js';
import { ObjectStore } from '../world/runtime/ObjectStore.js';
import { createRecastNavigationSystem } from './helpers/createRecastNavigationSystem.js';
import { assetManifests } from '../asset/manifests/index.js';
import { disposeObject3D } from '../core/disposeObject3D.js';

it('builds static navigation from the real cabinet GLB while excluding the articulated door subtree', async () => {
  globalThis.ProgressEvent ||= class ProgressEvent { constructor(type, init={}) { this.type=type; Object.assign(this,init); } };
  const bytes=await import('node:fs/promises').then((fs)=>fs.readFile('public/assets/cabinet.glb'));
  const cabinet=structuredClone(assetManifests.cabinet);
  cabinet.source.url=`data:model/gltf-binary;base64,${Buffer.from(bytes).toString('base64')}`;
  const manager=new AssetManager({ manifests:{cabinet}, compiledStore:{ get:async()=>null } });
  const {object}=await manager.instantiate('cabinet');
  object.position.set(0,0,0);
  object.updateMatrixWorld(true);

  const store=new ObjectStore();
  store.add('cabinet_1',{id:'cabinet_1',assetId:'cabinet',object,manifest:cabinet,state:{}});
  const floor=new THREE.Mesh(new THREE.BoxGeometry(10,.2,8)); floor.position.y=-.1; floor.updateMatrixWorld(true);
  const navigation=createRecastNavigationSystem({store,environmentRoots:[floor]});
  const result=await navigation.findPath([-4,0,0],[4,0,0]);

  expect(result.reachable).toBe(true);
  expect(result.path.length).toBeGreaterThan(2);
  expect(result.path.some((point)=>Math.abs(point[2])>.5)).toBe(true);
  const skipped=navigation.status().lastBuild.skipped;
  expect(skipped.some((entry)=>entry.reason==='dynamic-part' && entry.node==='Door')).toBe(true);
  expect(navigation.status().lastBuild.meshCount).toBe(2); // floor + cabinet Body
  navigation.dispose();
  floor.geometry.dispose();
  disposeObject3D(object);
},15000);
