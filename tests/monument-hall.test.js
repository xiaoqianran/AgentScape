import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ObjectStore } from '../src/runtime/ObjectStore.js';
import { createRecastNavigationSystem } from './helpers/createRecastNavigationSystem.js';
import { createMonumentHall, MONUMENT_HALL_COLLIDERS } from '../src/content/monumentHall.js';
import { disposeObject3D } from '../src/runtime/disposeObject3D.js';

describe('Monument Hall environment pack', () => {
  it('keeps visual architecture and fixed physics collider ownership in one content pack', () => {
    const scene = new THREE.Scene();
    const hall = createMonumentHall({ scene, loadAssets:false });
    scene.add(hall.root);
    const names=[];
    hall.root.traverse((node)=>{ if(node.name) names.push(node.name); });
    expect(names).toContain('MonumentFloor');
    expect(names).toContain('AstraMonument');
    expect(names.filter((name)=>name.startsWith('Column_'))).toHaveLength(10);
    expect(MONUMENT_HALL_COLLIDERS).toHaveLength(17);
    expect(hall.colliders).not.toBe(MONUMENT_HALL_COLLIDERS);
    expect(hall.root.getObjectByName('AstraMonument').userData.navigationIgnore).toBe(true);
    hall.dispose(); disposeObject3D(scene);
  });

  it('builds a real Recast path around the central monument instead of walking through it', async () => {
    const scene = new THREE.Scene();
    const hall = createMonumentHall({ scene, loadAssets:false });
    const navigation = createRecastNavigationSystem({ store:new ObjectStore(), environmentRoots:[hall.root] });
    const result = await navigation.findPath([0,0,10], [0,0,-9]);
    expect(result.reachable).toBe(true);
    expect(result.path.length).toBeGreaterThan(2);
    expect(result.path.some(([x,,z])=>Math.abs(x)>2 && z < -2 && z > -8)).toBe(true);
    expect(navigation.status().lastBuild.meshCount).toBeGreaterThan(10);
    navigation.dispose(); hall.dispose(); disposeObject3D(scene);
  }, 15000);
});
