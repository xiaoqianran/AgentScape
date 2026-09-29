import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createWorldAuthoringContext } from '../../application/createWorldAuthoringContext.js';
import { RenderingSystem } from '../../modules/world/runtime/systems/RenderingSystem.js';

function createAuthoring() {
  const scene = new THREE.Scene();
  const rendering = new RenderingSystem({ container:{}, scene });
  return createWorldAuthoringContext({ rendering });
}

function findNode(node, name) {
  if (node.name === name) return node;
  for (const child of node.children || []) {
    const found = findNode(child, name);
    if (found) return found;
  }
  return null;
}

describe('World Authoring persistence round-trip', () => {
  it('round-trips standard Three.js Scene presentation state', () => {
    const authoring = createAuthoring();
    authoring.scene.background = new THREE.Color('#123456');
    authoring.scene.fog = new THREE.Fog('#334455', 2, 80);
    authoring.scene.backgroundBlurriness = 0.25;
    authoring.scene.backgroundIntensity = 0.8;
    authoring.scene.environmentIntensity = 1.4;

    const first = authoring.export();
    expect(first.root.components.scene).toEqual({
      type:'Scene',
      properties:{
        background:{ type:'color', value:'#123456' },
        fog:{ type:'Fog', color:'#334455', near:2, far:80 },
        backgroundBlurriness:0.25,
        backgroundIntensity:0.8,
        environmentIntensity:1.4
      }
    });

    authoring.clear();
    authoring.load(first);

    expect(authoring.scene.isScene).toBe(true);
    expect(authoring.scene.background.getHexString()).toBe('123456');
    expect(authoring.scene.fog.isFog).toBe(true);
    expect(authoring.scene.fog.color.getHexString()).toBe('334455');
    expect(authoring.scene.fog.near).toBe(2);
    expect(authoring.scene.fog.far).toBe(80);
    expect(authoring.scene.backgroundBlurriness).toBe(0.25);
    expect(authoring.scene.backgroundIntensity).toBe(0.8);
    expect(authoring.scene.environmentIntensity).toBe(1.4);
    expect(authoring.export()).toEqual(first);
  });

  it('keeps AgentScape persistence identity out of Three.js userData', async () => {
    const authoring = createAuthoring();

    await authoring.run(`
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial()
      );
      mesh.name = 'clean-three-object';
      mesh.userData.semantic = { role:'wall' };
      scene.add(mesh);
    `);

    const mesh = authoring.scene.getObjectByName('clean-three-object');
    authoring.export();

    expect(authoring.scene.userData).toEqual({});
    expect(mesh.userData).toEqual({ semantic:{ role:'wall' } });
    expect(mesh.userData.authoringId).toBeUndefined();
    expect(mesh.geometry.userData.authoringGeometryId).toBeUndefined();
    expect(mesh.material.userData.authoringMaterialId).toBeUndefined();

    authoring.modelRef(mesh, { uri:'/models/wall.glb' });
    expect(mesh.userData.authoringModelRef).toBeUndefined();
  });

  it('exports and restores a Three.js subtree as an AuthoringDocument', async () => {
    const authoring = createAuthoring();

    await authoring.run(`
      const house = new THREE.Group();
      house.name = 'house';
      house.position.set(2, 0, -3);
      house.userData.kind = 'building';

      const geometry = new THREE.BoxGeometry(2, 1, 0.25);
      const material = new THREE.MeshStandardMaterial({
        color: '#d8c8a0',
        roughness: 0.7
      });

      const wallA = new THREE.Mesh(geometry, material);
      wallA.name = 'wall-a';
      wallA.position.set(-1, 0.5, 0);
      wallA.castShadow = true;
      wallA.userData.semantic = { role: 'wall', index: 1 };

      const wallB = new THREE.Mesh(geometry, material);
      wallB.name = 'wall-b';
      wallB.position.set(1, 0.5, 0);
      wallB.receiveShadow = true;

      const light = new THREE.PointLight('#ffddaa', 2.5, 12, 2);
      light.name = 'porch-light';
      light.position.set(0, 2.5, 1);

      house.add(wallA, wallB, light);
      scene.add(house);
    `);

    const first = authoring.export();
    expect(first.format).toBe('agentscape-world-authoring');
    expect(first.version).toBe(1);

    const houseDoc = findNode(first.root, 'house');
    const wallADoc = findNode(first.root, 'wall-a');
    const wallBDoc = findNode(first.root, 'wall-b');
    const lightDoc = findNode(first.root, 'porch-light');

    expect(houseDoc.metadata).toEqual({ kind:'building' });
    expect(wallADoc.metadata).toEqual({ semantic:{ role:'wall', index:1 } });
    expect(lightDoc.components.light.type).toBe('PointLight');

    const geometryA = wallADoc.components.geometry.properties.geometryId;
    const geometryB = wallBDoc.components.geometry.properties.geometryId;
    const materialA = wallADoc.components.material.properties.materialId;
    const materialB = wallBDoc.components.material.properties.materialId;

    expect(geometryA).toBe(geometryB);
    expect(materialA).toBe(materialB);
    expect(Object.keys(first.geometries)).toHaveLength(1);
    expect(Object.keys(first.materials)).toHaveLength(1);

    const houseId = houseDoc.id;
    const wallAId = wallADoc.id;

    authoring.clear();
    expect(authoring.scene.children).toHaveLength(0);

    authoring.load(first);

    const restoredHouse = authoring.get(houseId);
    const restoredWall = authoring.get(wallAId);
    expect(restoredHouse?.name).toBe('house');
    expect(restoredHouse?.position.toArray()).toEqual([2, 0, -3]);
    expect(restoredHouse?.userData.kind).toBe('building');
    expect(restoredWall?.isMesh).toBe(true);
    expect(restoredWall?.castShadow).toBe(true);
    expect(restoredWall?.userData.semantic).toEqual({ role:'wall', index:1 });

    const restoredWallB = authoring.scene.getObjectByName('wall-b');
    expect(restoredWall.geometry).toBe(restoredWallB.geometry);
    expect(restoredWall.material).toBe(restoredWallB.material);

    const second = authoring.export();
    expect(second).toEqual(first);
  });

  it('returns a normalized AuthoringState from capture()', async () => {
    const authoring = createAuthoring();

    await authoring.run(`
      const group = new THREE.Group();
      group.name = 'garden';
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 16, 8),
        new THREE.MeshBasicMaterial({ color: '#55aa55' })
      );
      mesh.name = 'shrub';
      group.add(mesh);
      scene.add(group);
    `);

    const state = authoring.capture();
    const ids = Object.keys(state.nodesById);

    expect(state.rootId).toBe('root');
    expect(ids).toHaveLength(3);
    expect(state.childIdsById.root).toHaveLength(1);

    const garden = ids.find(id => state.nodesById[id].name === 'garden');
    const shrub = ids.find(id => state.nodesById[id].name === 'shrub');

    expect(state.parentIdById[garden]).toBe('root');
    expect(state.parentIdById[shrub]).toBe(garden);
    expect(state.nodesById[shrub].components.geometry.type).toBe('GeometryRef');
  });

  it('fails explicitly for unsupported runtime objects', () => {
    const authoring = createAuthoring();
    const camera = new THREE.PerspectiveCamera();
    camera.name = 'not-persistable-yet';
    authoring.scene.add(camera);

    expect(() => authoring.export()).toThrow('Unsupported World Authoring object: PerspectiveCamera');
  });
});
