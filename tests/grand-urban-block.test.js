import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ObjectStore } from '../src/runtime/ObjectStore.js';
import { createRecastNavigationSystem } from './helpers/createRecastNavigationSystem.js';
import { createGrandUrbanBlock, GRAND_URBAN_BLOCK_COLLIDERS } from '../src/content/grandUrbanBlock.js';
import { disposeObject3D } from '../src/runtime/disposeObject3D.js';

describe('Grand Urban Block environment pack',()=>{
  it('uses modular architecture and instancing instead of one object per repeated detail',()=>{
    const scene=new THREE.Scene();
    const world=createGrandUrbanBlock({scene,loadAssets:false});
    scene.add(world.root);
    const names=[];
    world.root.traverse((node)=>{if(node.name) names.push(node.name);});
    expect(names.filter((name)=>name.startsWith('Building_'))).toHaveLength(12);
    expect(world.root.getObjectByName('FacadeWindows').isInstancedMesh).toBe(true);
    expect(world.root.getObjectByName('StreetlightPoles').isInstancedMesh).toBe(true);
    expect(world.root.getObjectByName('StreetTrees').isInstancedMesh).toBe(true);
    expect(world.root.getObjectByName('StreetTrees').userData).toMatchObject({navigationIgnore:true,decorative:true});
    expect(world.root.getObjectByName('StreetlightPoles').userData).toMatchObject({navigationIgnore:true,decorative:true});
    expect(world.root.getObjectByName('FacadeWindows').count).toBeGreaterThan(150);
    let renderables=0, instances=0;
    world.root.traverse((node)=>{ if(node.isMesh){ renderables+=1; if(node.isInstancedMesh) instances+=node.count; } });
    expect(renderables).toBeLessThanOrEqual(40);
    expect(instances).toBeGreaterThan(400);
    expect(GRAND_URBAN_BLOCK_COLLIDERS).toHaveLength(19);
    expect(world.camera.far).toBe(190);
    world.dispose(); disposeObject3D(scene);
  });

  it('builds long-range Recast paths across the district and routes around the civic beacon',async()=>{
    const scene=new THREE.Scene();
    const world=createGrandUrbanBlock({scene,loadAssets:false});
    const navigation=createRecastNavigationSystem({store:new ObjectStore(),environmentRoots:[world.root]});

    const boulevard=await navigation.findPath([0,0,-33],[0,0,33]);
    const diagonal=await navigation.findPath([-44,0,-31],[44,0,31]);
    expect(boulevard.reachable).toBe(true);
    expect(diagonal.reachable).toBe(true);
    expect(boulevard.path.some(([x,,z])=>Math.abs(x)>2.2&&Math.abs(z)<4)).toBe(true);
    expect(boulevard.cost).toBeGreaterThan(66);
    expect(diagonal.cost).toBeGreaterThan(95);
    expect(navigation.status().lastBuild).toMatchObject({success:true,buildVersion:1,meshCount:19});
    expect(Number.isFinite(navigation.status().lastBuild.durationMs)).toBe(true);

    navigation.dispose(); world.dispose(); disposeObject3D(scene);
  },20000);
});
