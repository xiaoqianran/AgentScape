import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ObjectStore } from '../world/runtime/ObjectStore.js';
import { createRecastNavigationSystem } from './helpers/createRecastNavigationSystem.js';
import { createRuinedCourtyard, RUINED_COURTYARD_COLLIDERS } from '../world/content/ruinedCourtyard.js';
import { disposeObject3D } from '../core/disposeObject3D.js';

describe('Ruined Courtyard environment pack', () => {
  it('contains split-level architecture, instanced vegetation and collider truth', () => {
    const scene = new THREE.Scene();
    const world = createRuinedCourtyard({ scene, loadAssets:false });
    scene.add(world.root);
    const names=[];
    world.root.traverse((node)=>{ if(node.name) names.push(node.name); });
    expect(names).toContain('CourtyardFloor');
    expect(names).toContain('EastTerrace');
    expect(names).toContain('WestTerrace');
    expect(names).toContain('NorthGate');
    expect(names).toContain('DryFountain');
    expect(names).toContain('FallenColumnWest');
    expect(world.root.getObjectByName('CourtyardGrass').isInstancedMesh).toBe(true);
    expect(RUINED_COURTYARD_COLLIDERS.length).toBeGreaterThan(30);
    expect(world.colliders.some((item)=>item.rotation)).toBe(true);
    world.dispose(); disposeObject3D(scene);
  });

  it('builds a navigable path onto both raised terraces using real 0.2m steps', async () => {
    const scene = new THREE.Scene();
    const world = createRuinedCourtyard({ scene, loadAssets:false });
    const navigation = createRecastNavigationSystem({ store:new ObjectStore(), environmentRoots:[world.root] });

    const east = await navigation.findPath([0,0,12], [12,1.2,4.8]);
    const west = await navigation.findPath([0,0,12], [-12,.8,-6.2]);
    expect(east.reachable).toBe(true);
    expect(west.reachable).toBe(true);
    expect(Math.max(...east.path.map((point)=>point[1]))).toBeGreaterThan(.9);
    expect(Math.max(...west.path.map((point)=>point[1]))).toBeGreaterThan(.6);
    expect(navigation.status().lastBuild.meshCount).toBeGreaterThan(20);

    navigation.dispose(); world.dispose(); disposeObject3D(scene);
  }, 15000);

  it('routes around the physical dry fountain on the courtyard main axis', async () => {
    const scene = new THREE.Scene();
    const world = createRuinedCourtyard({ scene, loadAssets:false });
    const navigation = createRecastNavigationSystem({ store:new ObjectStore(), environmentRoots:[world.root] });
    const result = await navigation.findPath([0,0,12], [0,0,-11]);
    expect(result.reachable).toBe(true);
    expect(result.path.length).toBeGreaterThan(2);
    expect(result.path.some(([x,,z])=>Math.abs(x)>2 && z<1 && z>-5)).toBe(true);
    navigation.dispose(); world.dispose(); disposeObject3D(scene);
  }, 15000);
});
