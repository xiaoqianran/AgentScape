import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createWorldAuthoringContext } from '../../application/createWorldAuthoringContext.js';
import { createAuthoringModelResolver } from '../../application/world-authoring/AuthoringModelResolver.js';
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

describe('World Authoring ModelRef', () => {
  it('captures ModelRef as an opaque authored node and restores it through loadAsync()', async () => {
    const authoring = createAuthoring();

    await authoring.run(`
      const tree = new THREE.Group();
      tree.name = 'tree-model';
      tree.position.set(3, 0, -2);
      tree.userData.category = 'vegetation';
      modelRef(tree, { source:{ type:'url', uri:'/models/tree.glb' } });

      const runtimeDetail = new THREE.Mesh(
        new THREE.BoxGeometry(1, 2, 1),
        new THREE.MeshBasicMaterial()
      );
      runtimeDetail.name = 'runtime-detail-that-must-not-persist';
      tree.add(runtimeDetail);
      scene.add(tree);
    `);

    const first = authoring.export();
    const modelNode = findNode(first.root, 'tree-model');

    expect(modelNode.components.modelRef).toEqual({
      type:'ModelRef',
      properties:{
        source:{ type:'url', uri:'/models/tree.glb' }
      }
    });
    expect(modelNode.children).toBeUndefined();
    expect(first.geometries).toBeUndefined();
    expect(first.materials).toBeUndefined();

    expect(() => authoring.load(first)).toThrow('ModelRef requires loadAsync()');

    const resolveModel = vi.fn(async (reference) => {
      expect(reference).toEqual({
        source:{ type:'url', uri:'/models/tree.glb' }
      });
      const resolved = new THREE.Group();
      resolved.name = 'resolved-gltf-scene';
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1),
        new THREE.MeshStandardMaterial()
      );
      mesh.name = 'resolved-leaf';
      resolved.add(mesh);
      return resolved;
    });

    await authoring.loadAsync(first, { resolveModel });

    const restored = authoring.get(modelNode.id);
    expect(restored?.name).toBe('tree-model');
    expect(restored?.position.toArray()).toEqual([3, 0, -2]);
    expect(restored?.userData.category).toBe('vegetation');
    expect(restored?.children[0]?.name).toBe('resolved-gltf-scene');
    expect(restored?.getObjectByName('resolved-leaf')).toBeTruthy();
    expect(resolveModel).toHaveBeenCalledTimes(1);

    const second = authoring.export();
    expect(second).toEqual(first);
  });

  it('preserves AgentScape AssetRef rather than copying asset manifests into the document', async () => {
    const authoring = createAuthoring();

    await authoring.run(`
      const chair = new THREE.Group();
      chair.name = 'chair-model';
      modelRef(chair, { assetRef:{ assetId:'chair_oak_01' } });
      scene.add(chair);
    `);

    const document = authoring.export();
    const chair = findNode(document.root, 'chair-model');

    expect(chair.components.modelRef.properties).toEqual({
      source:{
        type:'asset',
        assetRef:{ assetId:'chair_oak_01' }
      }
    });

    const resolveModel = vi.fn(async (reference) => {
      expect(reference.source.assetRef).toEqual({ assetId:'chair_oak_01' });
      const object = new THREE.Group();
      object.name = 'asset-instance';
      return object;
    });

    await authoring.loadAsync(document, { resolveModel });
    expect(authoring.scene.getObjectByName('asset-instance')).toBeTruthy();
    expect(authoring.export()).toEqual(document);
  });

  it('adapts URL refs to GltfAssetLoader and AssetRefs to AssetLoader', async () => {
    const urlObject = new THREE.Group();
    urlObject.name = 'url-object';
    const assetObject = new THREE.Group();
    assetObject.name = 'asset-object';

    const gltfLoader = {
      loadScene: vi.fn(async () => urlObject)
    };
    const assetLoader = {
      instantiate: vi.fn(async () => ({ object:assetObject, manifest:{ id:'crate_01' } }))
    };

    const resolveModel = createAuthoringModelResolver({
      assetLoader,
      gltfLoader
    });

    expect(await resolveModel({
      source:{ type:'url', uri:'/models/crate.glb' }
    })).toBe(urlObject);
    expect(gltfLoader.loadScene).toHaveBeenCalledWith('/models/crate.glb');

    expect(await resolveModel({
      source:{ type:'asset', assetRef:{ assetId:'crate_01' } }
    })).toBe(assetObject);
    expect(assetLoader.instantiate).toHaveBeenCalledWith('crate_01');
  });

  it('supports patchAsync for documents containing ModelRef nodes', async () => {
    const authoring = createAuthoring();

    await authoring.run(`
      const model = new THREE.Group();
      model.name = 'movable-model';
      modelRef(model, { uri:'/models/movable.glb' });
      scene.add(model);
    `);

    const before = authoring.export();
    const node = findNode(before.root, 'movable-model');
    const resolveModel = vi.fn(async () => new THREE.Group());

    const after = await authoring.patchAsync({
      update:[{
        id:node.id,
        components:{
          transform:{
            properties:{
              position:[5, 1, -3]
            }
          }
        }
      }]
    }, { resolveModel });

    expect(authoring.get(node.id).position.toArray()).toEqual([5, 1, -3]);
    expect(findNode(after.root, 'movable-model').components.transform.properties.position).toEqual([5, 1, -3]);
    expect(authoring.export()).toEqual(after);
  });

  it('rejects authored children below an opaque ModelRef node', async () => {
    const authoring = createAuthoring();
    const invalid = {
      format:'agentscape-world-authoring',
      version:1,
      root:{
        id:'root',
        components:{
          transform:{
            type:'Transform',
            properties:{
              position:[0,0,0],
              quaternion:[0,0,0,1],
              scale:[1,1,1]
            }
          }
        },
        children:[{
          id:'model',
          name:'model',
          components:{
            transform:{
              type:'Transform',
              properties:{
                position:[0,0,0],
                quaternion:[0,0,0,1],
                scale:[1,1,1]
              }
            },
            modelRef:{
              type:'ModelRef',
              properties:{
                source:{ type:'url', uri:'/models/model.glb' }
              }
            }
          },
          children:[{
            id:'illegal-child',
            components:{
              transform:{
                type:'Transform',
                properties:{
                  position:[0,0,0],
                  quaternion:[0,0,0,1],
                  scale:[1,1,1]
                }
              }
            }
          }]
        }]
      }
    };

    await expect(authoring.loadAsync(invalid, {
      resolveModel:async () => new THREE.Group()
    })).rejects.toThrow('ModelRef node cannot contain authored children');
  });
});
