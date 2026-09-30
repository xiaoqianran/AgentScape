import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createWorldAuthoringContext } from '../../application/createWorldAuthoringContext.js';
import { createAuthoringExecutionHost } from '../../application/world-authoring/AuthoringExecutionHost.js';
import { RenderingSystem } from '../../modules/world/runtime/systems/RenderingSystem.js';

function createAuthoring(executionHost) {
  const scene = new THREE.Scene();
  const rendering = new RenderingSystem({ container:{}, scene });
  return createWorldAuthoringContext({ rendering }, { executionHost });
}

function findNode(node, name) {
  if (node.name === name) return node;
  for (const child of node.children || []) {
    const found = findNode(child, name);
    if (found) return found;
  }
  return null;
}

describe('World Authoring execution host', () => {
  it('tracks official GLTFLoader provenance while retaining the documented modelRef() helper', async () => {
    class FakeGLTFLoader {
      async loadAsync(url) {
        const scene = new THREE.Group();
        scene.name = 'loaded-model';
        return { scene, animations:[], url };
      }
      load(url, onLoad) {
        const scene = new THREE.Group();
        scene.name = 'loaded-model';
        onLoad({ scene, animations:[], url });
        return this;
      }
    }

    const executionHost = createAuthoringExecutionHost({ gltfLoaderClass:FakeGLTFLoader });
    const authoring = createAuthoring(executionHost);

    const result = await authoring.run(`
      const loader = new THREE.GLTFLoader();
      const gltf = await loader.loadAsync('/models/tree.glb');
      scene.add(gltf.scene);
      return {
        customModelRef: typeof modelRef,
        loaderName: loader.constructor.name
      };
    `);

    expect(result.customModelRef).toBe('function');
    expect(result.loaderName).toBe('AuthoringGLTFLoader');
    const document = authoring.export();
    const node = findNode(document.root, 'loaded-model');
    expect(node.components.modelRef.properties).toEqual({
      source:{ type:'url', uri:'/models/tree.glb' }
    });
    expect(authoring.scene.getObjectByName('loaded-model').userData.authoringModelRef).toBeUndefined();
  });

  it('scopes standard animation and timer APIs and cancels them on clear()', async () => {
    let nextId = 0;
    const frames = new Map();
    const timeouts = new Map();
    const intervals = new Map();
    const cancelFrame = vi.fn((id)=>frames.delete(id));
    const clearTimeoutImpl = vi.fn((id)=>timeouts.delete(id));
    const clearIntervalImpl = vi.fn((id)=>intervals.delete(id));

    const executionHost = createAuthoringExecutionHost({
      requestFrame:(callback)=>{ const id=++nextId; frames.set(id,callback); return id; },
      cancelFrame,
      setTimeoutImpl:(callback)=>{ const id=++nextId; timeouts.set(id,callback); return id; },
      clearTimeoutImpl,
      setIntervalImpl:(callback)=>{ const id=++nextId; intervals.set(id,callback); return id; },
      clearIntervalImpl
    });
    const authoring = createAuthoring(executionHost);

    const surface = await authoring.run(`
      requestAnimationFrame(() => {});
      setTimeout(() => {}, 100);
      setInterval(() => {}, 100);
      return {
        requestAnimationFrame: typeof requestAnimationFrame,
        setTimeout: typeof setTimeout,
        onFrame: typeof onFrame
      };
    `);

    expect(surface).toEqual({
      requestAnimationFrame:'function',
      setTimeout:'function',
      onFrame:'function'
    });
    expect(executionHost.diagnostics()).toEqual({ frames:1, timeouts:1, intervals:1 });

    authoring.clear();

    expect(executionHost.diagnostics()).toEqual({ frames:0, timeouts:0, intervals:0 });
    expect(cancelFrame).toHaveBeenCalledOnce();
    expect(clearTimeoutImpl).toHaveBeenCalledOnce();
    expect(clearIntervalImpl).toHaveBeenCalledOnce();
  });
});
