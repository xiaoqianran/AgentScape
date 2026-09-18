import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WorldRuntime } from '../../modules/world/runtime/WorldRuntime.js';
import { createRapierPhysicsSystem } from '../helpers/createRapierPhysicsSystem.js';

const MANIFEST = {
  id:'cup', type:'cup', label:'Cup', source:{kind:'builtin'}, actions:['move'],
  physics:{ body:'dynamic', mass:0.3, colliders:[{shape:'box',halfExtents:[0.1,0.1,0.1]}] }
};

async function createRuntime() {
  const physics = createRapierPhysicsSystem();
  await physics.init();
  const runtime = new WorldRuntime({
    environmentFactory: null,
    assetModule: {
      registry: { getManifest: () => structuredClone(MANIFEST), has: () => true },
      loader: { instantiate: async () => ({ object:new THREE.Group(), manifest:structuredClone(MANIFEST) }) },
      catalog: {},
      compiledStore: {},
      getManifest: () => structuredClone(MANIFEST),
      hasAsset: () => true,
      assertCompatibleManifest: () => true,
      instantiate: async () => ({ object:new THREE.Group(), manifest:structuredClone(MANIFEST) })
    },
    physicsFactory: () => physics
  });
  runtime.scene = new THREE.Scene();
  runtime.sceneGraph = { batch:(operation)=>operation(), changed(){} };
  return runtime;
}

describe('WorldRuntime mutation boundaries', () => {
  it('leaves the existing object and its physics untouched when a duplicate id is rejected', async () => {
    const runtime = await createRuntime();
    await runtime.spawn('cup', { id:'cup_01' });
    const bodies = runtime.physics.entries.size;

    await expect(runtime.spawn('cup', { id:'cup_01' })).rejects.toThrow(/Duplicate object id/);

    expect(runtime.store.has('cup_01')).toBe(true);
    expect(runtime.physics.entries.has('cup_01')).toBe(true);
    expect(runtime.physics.entries.size).toBe(bodies);
    runtime.physics.dispose();
  });

  it('rejects a second mutation while one is already in progress', async () => {
    const runtime = await createRuntime();
    runtime.history = { suspended:false, begin:()=>true, commit:()=>true, cancel(){} };

    let release = null;
    const pending = runtime.mutate('agent:hold', () => new Promise((resolve) => { release = resolve; }));

    await expect(runtime.mutate('human:edit', async () => 'ok')).rejects.toMatchObject({ code:'WORLD_MUTATION_BUSY' });

    release('held');
    await expect(pending).resolves.toBe('held');
    expect(runtime.mutationOwner).toBeNull();
    runtime.physics.dispose();
  });

  it('refuses to open a history transaction while history is suspended', async () => {
    const runtime = await createRuntime();
    runtime.history = { suspended:true, begin:()=>true, commit:()=>true, cancel(){} };

    await expect(runtime.mutate('agent:hold', async () => 'held')).rejects.toMatchObject({ code:'WORLD_MUTATION_BUSY' });
    expect(runtime.mutationOwner).toBeNull();
    runtime.physics.dispose();
  });
});
