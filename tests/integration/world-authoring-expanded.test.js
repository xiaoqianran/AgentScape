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

describe('World Authoring expanded persistence', () => {
  it('round-trips shared DataTexture references through the texture pool', () => {
    const authoring = createAuthoring();

    const data = new Uint8Array([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      255, 255, 255, 255
    ]);
    const texture = new THREE.DataTexture(data, 2, 2);
    texture.needsUpdate = true;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, 3);

    const material = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.65
    });
    const geometry = new THREE.BoxGeometry(1, 1, 1);

    const a = new THREE.Mesh(geometry, material);
    a.name = 'textured-a';
    const b = new THREE.Mesh(geometry, material);
    b.name = 'textured-b';
    authoring.scene.add(a, b);

    const first = authoring.export();
    const aDoc = findNode(first.root, 'textured-a');
    const materialId = aDoc.components.material.properties.materialId;
    const textureId = first.materials[materialId].map;

    expect(Object.keys(first.textures)).toHaveLength(1);
    expect(first.textures[textureId].source.type).toBe('data');
    expect(first.textures[textureId].source.width).toBe(2);
    expect(first.textures[textureId].repeat).toEqual([2, 3]);

    authoring.clear();
    authoring.load(first);

    const restoredA = authoring.scene.getObjectByName('textured-a');
    const restoredB = authoring.scene.getObjectByName('textured-b');
    expect(restoredA.material).toBe(restoredB.material);
    expect(restoredA.material.map).toBe(restoredB.material.map);
    expect(restoredA.material.map.isDataTexture).toBe(true);
    expect(restoredA.material.map.repeat.toArray()).toEqual([2, 3]);

    expect(authoring.export()).toEqual(first);
  });

  it('round-trips InstancedMesh matrices, colors and shared resources', () => {
    const authoring = createAuthoring();
    const geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const material = new THREE.MeshStandardMaterial({ color:'#ffffff' });
    const instances = new THREE.InstancedMesh(geometry, material, 3);
    instances.name = 'trees';

    const matrix = new THREE.Matrix4();
    for (let i = 0; i < 3; i++) {
      matrix.makeTranslation(i * 2, 0, -i);
      instances.setMatrixAt(i, matrix);
    }
    instances.setColorAt(0, new THREE.Color('#ff0000'));
    instances.setColorAt(1, new THREE.Color('#00ff00'));
    instances.setColorAt(2, new THREE.Color('#0000ff'));
    instances.instanceMatrix.needsUpdate = true;
    instances.instanceColor.needsUpdate = true;
    authoring.scene.add(instances);

    const first = authoring.export();
    const node = findNode(first.root, 'trees');

    expect(node.components.instancedMesh.type).toBe('InstancedMesh');
    expect(node.components.instancedMesh.properties.count).toBe(3);
    expect(node.components.instancedMesh.properties.matrices).toHaveLength(48);
    expect(node.components.instancedMesh.properties.colors).toHaveLength(9);

    authoring.clear();
    authoring.load(first);

    const restored = authoring.scene.getObjectByName('trees');
    expect(restored.isInstancedMesh).toBe(true);
    expect(restored.count).toBe(3);
    expect(Array.from(restored.instanceMatrix.array)).toEqual(node.components.instancedMesh.properties.matrices);
    expect(Array.from(restored.instanceColor.array)).toEqual(node.components.instancedMesh.properties.colors);

    expect(authoring.export()).toEqual(first);
  });

  it('patches nodes by stable authoring id with update, add and remove operations', async () => {
    const authoring = createAuthoring();

    await authoring.run(`
      const group = new THREE.Group();
      group.name = 'room';

      const keep = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ color:'#ffffff' })
      );
      keep.name = 'keep';

      const remove = new THREE.Group();
      remove.name = 'remove-me';

      group.add(keep, remove);
      scene.add(group);
    `);

    const before = authoring.export();
    const room = findNode(before.root, 'room');
    const keep = findNode(before.root, 'keep');
    const remove = findNode(before.root, 'remove-me');

    const patched = authoring.patch({
      update: [{
        id: keep.id,
        name: 'moved',
        metadata: { role:'anchor' },
        components: {
          transform: {
            properties: {
              position: [4, 2, -1]
            }
          }
        }
      }],
      remove: [remove.id],
      add: [{
        parentId: room.id,
        node: {
          id: 'node_added',
          name: 'added',
          components: {
            transform: {
              type: 'Transform',
              properties: {
                position: [1, 0, 1],
                quaternion: [0, 0, 0, 1],
                scale: [1, 1, 1]
              }
            }
          }
        }
      }]
    });

    expect(authoring.get(keep.id).name).toBe('moved');
    expect(authoring.get(keep.id).position.toArray()).toEqual([4, 2, -1]);
    expect(authoring.get(keep.id).userData.role).toBe('anchor');
    expect(authoring.get(remove.id)).toBeNull();
    expect(authoring.get('node_added')?.name).toBe('added');

    expect(findNode(patched.root, 'moved')).toBeTruthy();
    expect(findNode(patched.root, 'remove-me')).toBeNull();
    expect(findNode(patched.root, 'added')).toBeTruthy();
    expect(authoring.export()).toEqual(patched);
  });
});
