import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AuthoringWorldController } from '../../apps/studio/authoring/AuthoringWorldController.js';
import { AuthoringWorldStore } from '../../apps/studio/persistence/AuthoringWorldStore.js';
import { createWorldAuthoringContext } from '../../application/createWorldAuthoringContext.js';
import { RenderingSystem } from '../../modules/world/runtime/systems/RenderingSystem.js';

function createAuthoring() {
  const scene = new THREE.Scene();
  const rendering = new RenderingSystem({ container:{}, scene });
  return createWorldAuthoringContext({ rendering });
}

describe('AuthoringWorldController', () => {
  it('implements new/open/save/save-as and dirty state against the last saved document', async () => {
    const authoring = createAuthoring();
    const memory = new Map();
    const store = new AuthoringWorldStore({
      indexedDBImpl:null,
      memory,
      now:() => '2026-09-18T00:00:00.000Z'
    });

    const ids = ['world_a', 'world_b'];
    const controller = new AuthoringWorldController({
      authoring,
      store,
      idFactory:() => ids.shift()
    });

    expect(controller.status()).toMatchObject({
      id:null,
      name:'Untitled World',
      persisted:false,
      dirty:false
    });

    await authoring.run(`
      const house = new THREE.Group();
      house.name = 'house';
      house.userData.authoringId = 'house';
      scene.add(house);
    `);

    expect(controller.isDirty()).toBe(true);

    const first = await controller.save({ name:'Garden' });
    expect(first.id).toBe('world_a');
    expect(controller.status()).toMatchObject({
      id:'world_a',
      name:'Garden',
      persisted:true,
      dirty:false
    });

    authoring.get('house').position.x = 5;
    expect(controller.isDirty()).toBe(true);

    const second = await controller.saveAs({ name:'Garden Copy' });
    expect(second.id).toBe('world_b');
    expect(controller.isDirty()).toBe(false);
    expect((await controller.list()).map(item => item.id).sort()).toEqual(['world_a','world_b']);

    await controller.newWorld();
    expect(controller.status()).toMatchObject({
      id:null,
      name:'Untitled World',
      persisted:false,
      dirty:false
    });
    expect(authoring.get('house')).toBeNull();

    await controller.openWorld('world_a');
    expect(controller.status()).toMatchObject({
      id:'world_a',
      name:'Garden',
      persisted:true,
      dirty:false
    });
    expect(authoring.get('house')).toBeTruthy();
    expect(authoring.get('house').position.x).toBe(0);
  });
  it('does not create a save revision when persistence fails', async () => {
    const authoring = createAuthoring();
    const controller = new AuthoringWorldController({
      authoring,
      store:{
        save:async () => { throw new Error('disk full'); },
        load:async () => null,
        list:async () => []
      },
      idFactory:() => 'broken_world'
    });

    const node = new THREE.Group();
    node.name = 'unsaved';
    node.userData.authoringId = 'unsaved';
    authoring.scene.add(node);

    const historyCount = authoring.history().length;

    await expect(controller.save({ name:'Broken' })).rejects.toThrow('disk full');
    expect(authoring.history()).toHaveLength(historyCount);
    expect(controller.status()).toMatchObject({
      id:null,
      persisted:false,
      dirty:true
    });
  });

});
