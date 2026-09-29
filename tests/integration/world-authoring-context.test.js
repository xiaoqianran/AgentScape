import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createWorldAuthoringContext } from '../../application/createWorldAuthoringContext.js';
import { RenderingSystem } from '../../modules/world/runtime/systems/RenderingSystem.js';

describe('World authoring context', () => {
  it('mounts a real Three.js Scene without mixing it into World Entities', async () => {
    const scene = new THREE.Scene();
    const rendering = new RenderingSystem({ container:{}, scene });
    const entity = new THREE.Group();
    entity.name = 'world-entity';
    entity.userData.instanceId = 'entity_01';
    scene.add(entity);

    const authoring = createWorldAuthoringContext({ rendering });

    expect(authoring.scene.name).toBe('$llm-world');
    expect(authoring.scene.isScene).toBe(true);
    expect(authoring.scene.parent).toBeNull();
    expect(rendering.authoringScenes.get(authoring.scene)).toBe('overlay');
    expect(authoring.scene.userData).toEqual({});

    await authoring.run(`
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial()
      );
      mesh.name = 'llm-draft';
      mesh.position.set(1, 2, 3);
      scene.add(mesh);
    `);

    const draft = authoring.scene.getObjectByName('llm-draft');
    expect(draft).toBeTruthy();
    expect(draft.position.toArray()).toEqual([1, 2, 3]);
    expect(scene.getObjectByName('world-entity')).toBe(entity);

    authoring.clear();
    expect(authoring.scene.getObjectByName('llm-draft')).toBeUndefined();
    expect(scene.getObjectByName('world-entity')).toBe(entity);

    expect(authoring.dispose()).toBe(true);
    expect(authoring.scene.parent).toBeNull();
    expect(rendering.authoringScenes.has(authoring.scene)).toBe(false);
    expect(authoring.dispose()).toBe(false);
  });

  it('exposes only THREE and scene to authored code while host lifecycle stays outside', async () => {
    const scene = new THREE.Scene();
    const rendering = new RenderingSystem({ container:{}, scene });
    const authoring = createWorldAuthoringContext({ rendering });
    const tick = vi.fn();

    const surface = await authoring.run(`
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial()
      );
      mesh.name = 'animated-draft';
      scene.add(mesh);
      return {
        isScene: scene.isScene,
        clear: typeof clear,
        onFrame: typeof onFrame,
        modelRef: typeof modelRef
      };
    `);

    expect(surface).toEqual({
      isScene:true,
      clear:'undefined',
      onFrame:'undefined',
      modelRef:'undefined'
    });
    const mesh = authoring.scene.getObjectByName('animated-draft');
    authoring.onFrame((delta, elapsed) => {
      mesh.rotation.y += delta;
      mesh.userData.elapsed = elapsed;
      tick(delta, elapsed);
    });
    expect(authoring.update(0.25, 2)).toBe(true);

    expect(mesh.rotation.y).toBeCloseTo(0.25);
    expect(mesh.userData.elapsed).toBe(2);
    expect(tick).toHaveBeenCalledWith(0.25, 2);

    authoring.clear();
    expect(authoring.scene.children).toHaveLength(0);
    authoring.update(0.25, 3);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('isolates failing frame handlers so authored animation cannot kill the Studio loop', () => {
    const scene = new THREE.Scene();
    const rendering = new RenderingSystem({ container:{}, scene });
    const events = { emit:vi.fn() };
    const authoring = createWorldAuthoringContext({ rendering, events });
    const healthy = vi.fn();
    const failing = vi.fn(() => { throw new Error('bad frame'); });

    authoring.onFrame(failing);
    authoring.onFrame(healthy);

    expect(authoring.update(0.1, 1)).toBe(true);
    expect(failing).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith('authoring.frame-error', { message:'bad frame' });

    authoring.update(0.1, 1.1);
    expect(failing).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(2);
  });

  it('rejects execution after disposal', async () => {
    const scene = new THREE.Scene();
    const rendering = new RenderingSystem({ container:{}, scene });
    const authoring = createWorldAuthoringContext({ rendering });

    expect(authoring.dispose()).toBe(true);
    expect(authoring.update(0.016, 1)).toBe(false);
    await expect(authoring.run('scene.add(new THREE.Group())')).rejects.toThrow('disposed');
    expect(() => authoring.clear()).toThrow('disposed');
    expect(() => authoring.onFrame(() => {})).toThrow('disposed');
  });
});
