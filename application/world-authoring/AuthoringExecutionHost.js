import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { markAuthoringModelRef } from './ModelRef.js';

function createThreeNamespace(GLTFLoaderClass) {
  class AuthoringGLTFLoader extends GLTFLoaderClass {
    async loadAsync(url, onProgress) {
      const gltf = await super.loadAsync(url, onProgress);
      if (gltf?.scene) markAuthoringModelRef(gltf.scene, { uri:String(url) });
      return gltf;
    }

    load(url, onLoad, onProgress, onError) {
      return super.load(url, (gltf) => {
        if (gltf?.scene) markAuthoringModelRef(gltf.scene, { uri:String(url) });
        onLoad?.(gltf);
      }, onProgress, onError);
    }
  }

  return Object.freeze({
    ...THREE,
    GLTFLoader:AuthoringGLTFLoader
  });
}

export function createAuthoringExecutionHost({
  gltfLoaderClass = GLTFLoader,
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
  setTimeoutImpl = globalThis.setTimeout?.bind(globalThis),
  clearTimeoutImpl = globalThis.clearTimeout?.bind(globalThis),
  setIntervalImpl = globalThis.setInterval?.bind(globalThis),
  clearIntervalImpl = globalThis.clearInterval?.bind(globalThis)
} = {}) {
  const frames = new Set();
  const timeouts = new Set();
  const intervals = new Set();
  const authoringThree = createThreeNamespace(gltfLoaderClass);

  const requestAnimationFrame = (callback) => {
    if (typeof requestFrame !== 'function') throw new TypeError('requestAnimationFrame is unavailable');
    let id = null;
    id = requestFrame((time) => {
      frames.delete(id);
      callback(time);
    });
    frames.add(id);
    return id;
  };

  const cancelAnimationFrame = (id) => {
    frames.delete(id);
    cancelFrame?.(id);
  };

  const setTimeout = (callback, delay = 0, ...args) => {
    if (typeof setTimeoutImpl !== 'function') throw new TypeError('setTimeout is unavailable');
    let id = null;
    id = setTimeoutImpl((...values) => {
      timeouts.delete(id);
      callback(...values);
    }, delay, ...args);
    timeouts.add(id);
    return id;
  };

  const clearTimeout = (id) => {
    timeouts.delete(id);
    clearTimeoutImpl?.(id);
  };

  const setInterval = (callback, delay = 0, ...args) => {
    if (typeof setIntervalImpl !== 'function') throw new TypeError('setInterval is unavailable');
    const id = setIntervalImpl(callback, delay, ...args);
    intervals.add(id);
    return id;
  };

  const clearInterval = (id) => {
    intervals.delete(id);
    clearIntervalImpl?.(id);
  };

  const clear = () => {
    for (const id of frames) cancelFrame?.(id);
    for (const id of timeouts) clearTimeoutImpl?.(id);
    for (const id of intervals) clearIntervalImpl?.(id);
    frames.clear();
    timeouts.clear();
    intervals.clear();
  };

  return {
    THREE:authoringThree,
    requestAnimationFrame,
    cancelAnimationFrame,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    clear,
    diagnostics:()=>({
      frames:frames.size,
      timeouts:timeouts.size,
      intervals:intervals.size
    })
  };
}
