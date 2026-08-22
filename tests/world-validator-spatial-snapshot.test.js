import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { ObjectStore } from '../src/runtime/ObjectStore.js';
import { SpatialSystem } from '../src/runtime/systems/SpatialSystem.js';
import { SceneGraph } from '../src/runtime/graph/SceneGraph.js';
import { WorldValidator } from '../src/validation/WorldValidator.js';

it('builds object bounds once per validation and reuses them for graph and collision checks', () => {
  const store = new ObjectStore();
  const objects = [];
  for (let i = 0; i < 6; i++) {
    const object = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshBasicMaterial());
    object.position.set(i * 2, 0.5, 0);
    const spy = vi.spyOn(object, 'updateWorldMatrix');
    const id = `o${i}`;
    store.add(id, { id, assetId:'box', object, manifest:{ actions:[] } });
    objects.push({ id, spy });
  }
  const spatial = new SpatialSystem({ store });
  const sceneGraph = new SceneGraph({ store, spatial });
  const runtime = {
    spatial,
    sceneGraph,
    interactions:{ heldId:null },
    listObjects:()=>objects.map(({id})=>({id}))
  };

  const report = new WorldValidator(runtime).run();
  expect(report.coverage.objects).toBe(6);
  for (const { spy } of objects) expect(spy).toHaveBeenCalledTimes(1);
});
