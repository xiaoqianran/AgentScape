import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createWorldAuthoringContext } from '../../application/createWorldAuthoringContext.js';
import { diffAuthoringDocuments } from '../../application/world-authoring/AuthoringDiff.js';
import { RenderingSystem } from '../../modules/world/runtime/systems/RenderingSystem.js';

function createAuthoring(options = {}) {
  const scene = new THREE.Scene();
  const rendering = new RenderingSystem({ container:{}, scene });
  return createWorldAuthoringContext({ rendering }, options);
}

function findNode(node, name) {
  if (node.name === name) return node;
  for (const child of node.children || []) {
    const found = findNode(child, name);
    if (found) return found;
  }
  return null;
}

describe('World Authoring revisions', () => {
  it('checkpoints arbitrary run() changes and supports diff, undo and redo', async () => {
    let tick = 0;
    const authoring = createAuthoring({
      now:() => `2026-09-18T00:00:0${tick++}.000Z`
    });

    expect(authoring.history()).toHaveLength(1);
    expect(authoring.currentRevision()).toMatchObject({
      id:'rev_000001',
      label:'Initial world',
      source:'init'
    });
    expect(authoring.canUndo()).toBe(false);

    await authoring.run(`
      const room = new THREE.Group();
      room.name = 'room';
      room.userData.authoringId = 'room';
      scene.add(room);
    `);

    const uncommitted = authoring.diff();
    expect(uncommitted.empty).toBe(false);
    expect(uncommitted.nodes.added.map(item => item.id)).toContain('room');

    const committed = authoring.commit('Create room');
    expect(committed.created).toBe(true);
    expect(committed.revision).toMatchObject({
      id:'rev_000002',
      label:'Create room',
      source:'manual'
    });
    expect(authoring.diff().empty).toBe(true);

    authoring.patch({
      update:[{
        id:'room',
        components:{
          transform:{
            properties:{
              position:[4, 0, -2]
            }
          }
        }
      }]
    }, { label:'Move room' });

    expect(authoring.get('room').position.toArray()).toEqual([4, 0, -2]);
    expect(authoring.history()).toHaveLength(3);
    expect(authoring.currentRevision().label).toBe('Move room');
    expect(authoring.canUndo()).toBe(true);

    const undone = authoring.undo();
    expect(undone.label).toBe('Create room');
    expect(authoring.get('room').position.toArray()).toEqual([0, 0, 0]);
    expect(authoring.canRedo()).toBe(true);

    const redone = authoring.redo();
    expect(redone.label).toBe('Move room');
    expect(authoring.get('room').position.toArray()).toEqual([4, 0, -2]);
    expect(authoring.canRedo()).toBe(false);
  });

  it('truncates the redo branch when a new revision is committed after undo', async () => {
    const authoring = createAuthoring();

    await authoring.run(`
      const room = new THREE.Group();
      room.name = 'room';
      room.userData.authoringId = 'room';
      scene.add(room);
    `);
    authoring.commit('Create room');

    authoring.patch({
      update:[{
        id:'room',
        name:'room-v2'
      }]
    }, { label:'Rename room' });

    const abandonedRevisionId = authoring.currentRevision().id;
    authoring.undo();

    await authoring.run(`
      const lamp = new THREE.Group();
      lamp.name = 'lamp';
      lamp.userData.authoringId = 'lamp';
      scene.add(lamp);
    `);
    authoring.commit('Add lamp instead');

    expect(authoring.canRedo()).toBe(false);
    expect(authoring.history().some(item => item.id === abandonedRevisionId)).toBe(false);
    expect(authoring.get('lamp')).toBeTruthy();
    expect(authoring.get('room').name).toBe('room');
  });

  it('keeps a bounded revision window', () => {
    const authoring = createAuthoring({ historyLimit:3 });

    for (let i = 1; i <= 4; i++) {
      const group = new THREE.Group();
      group.name = `node-${i}`;
      group.userData.authoringId = `node-${i}`;
      authoring.scene.add(group);
      authoring.commit(`Commit ${i}`);
    }

    const history = authoring.history();
    expect(history).toHaveLength(3);
    expect(history.map(item => item.label)).toEqual([
      'Commit 2',
      'Commit 3',
      'Commit 4'
    ]);

    expect(authoring.undo()?.label).toBe('Commit 3');
    expect(authoring.undo()?.label).toBe('Commit 2');
    expect(authoring.undo()).toBeNull();
  });

  it('diffs stable node identity, hierarchy movement and resource changes', async () => {
    const beforeAuthoring = createAuthoring();

    await beforeAuthoring.run(`
      const left = new THREE.Group();
      left.name = 'left';
      left.userData.authoringId = 'left';

      const right = new THREE.Group();
      right.name = 'right';
      right.userData.authoringId = 'right';

      const shared = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color:'#ffffff' })
      );
      shared.name = 'shared';
      shared.userData.authoringId = 'shared';

      const removed = new THREE.Group();
      removed.name = 'removed';
      removed.userData.authoringId = 'removed';

      left.add(shared, removed);
      scene.add(left, right);
    `);

    const before = beforeAuthoring.export();

    const after = JSON.parse(JSON.stringify(before));
    const left = findNode(after.root, 'left');
    const right = findNode(after.root, 'right');
    const shared = findNode(after.root, 'shared');

    left.children = left.children.filter(child => child.id !== 'shared' && child.id !== 'removed');
    shared.name = 'shared-updated';
    shared.metadata = { role:'anchor' };
    right.children = [shared, {
      id:'added',
      name:'added',
      components:{
        transform:{
          type:'Transform',
          properties:{
            position:[0, 0, 0],
            quaternion:[0, 0, 0, 1],
            scale:[1, 1, 1]
          }
        }
      }
    }];

    const materialId = shared.components.material.properties.materialId;
    after.materials[materialId].roughness = 0.25;

    const diff = diffAuthoringDocuments(before, after);

    expect(diff.empty).toBe(false);
    expect(diff.nodes.added.map(item => item.id)).toContain('added');
    expect(diff.nodes.removed.map(item => item.id)).toContain('removed');
    expect(diff.nodes.updated.map(item => item.id)).toContain('shared');
    expect(diff.nodes.moved).toContainEqual({
      id:'shared',
      from:{ parentId:'left', index:0 },
      to:{ parentId:'right', index:0 }
    });
    expect(diff.resources.materials.updated.map(item => item.id)).toContain(materialId);
  });

  it('uses async undo/redo for ModelRef-backed revisions without moving the cursor on failed sync hydration', async () => {
    const authoring = createAuthoring();

    await authoring.run(`
      const model = new THREE.Group();
      model.name = 'model';
      model.userData.authoringId = 'model';
      modelRef(model, { uri:'/models/model.glb' });
      scene.add(model);
    `);
    authoring.commit('Add model');

    await authoring.run(`
      const marker = new THREE.Group();
      marker.name = 'marker';
      marker.userData.authoringId = 'marker';
      scene.add(marker);
    `);
    authoring.commit('Add marker');

    expect(() => authoring.undo()).toThrow('ModelRef requires loadAsync()');
    expect(authoring.currentRevision().label).toBe('Add marker');

    const resolveModel = vi.fn(async () => {
      const object = new THREE.Group();
      object.name = 'resolved-model';
      return object;
    });

    const undone = await authoring.undoAsync({ resolveModel });
    expect(undone.label).toBe('Add model');
    expect(authoring.get('marker')).toBeNull();
    expect(authoring.get('model')?.getObjectByName('resolved-model')).toBeTruthy();

    const redone = await authoring.redoAsync({ resolveModel });
    expect(redone.label).toBe('Add marker');
    expect(authoring.get('marker')).toBeTruthy();
    expect(resolveModel).toHaveBeenCalledTimes(2);
  });
});
