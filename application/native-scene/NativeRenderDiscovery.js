// Observe instances, not WebGLRenderer.prototype: Three.js defines render on `this`.
const observers = new Set();
const renderers = new WeakMap();
const candidates = new Map();
let sequence = 0;

export function observeNativeRenderer(renderer) {
  if (renderers.has(renderer)) return renderers.get(renderer).release;
  const original = renderer.render;
  if (typeof original !== 'function') throw new TypeError('Renderer requires render()');
  const scenes = new WeakMap();
  const owned = new Set();
  function render(scene, camera, ...rest) {
    // Discovery must never swallow errors or change the original render result.
    const result = original.call(this, scene, camera, ...rest);
    if (scene?.isScene && camera?.isCamera) {
      let candidate = scenes.get(scene);
      if (!candidate) {
        candidate = { id: `native-${++sequence}`, scene, camera, renderer, renders: 0 };
        scenes.set(scene, candidate);
        owned.add(candidate.id);
        candidates.set(candidate.id, candidate);
      }
      candidate.camera = camera;
      candidate.renders++;
      if (candidate.renders === 1) {
        for (const listener of observers) {
          try { listener(candidate); } catch (error) { console.error('Native discovery observer failed', error); }
        }
      }
    }
    return result;
  }
  renderer.render = render;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (renderer.render === render) renderer.render = original;
    for (const id of owned) candidates.delete(id);
    renderers.delete(renderer);
  };
  renderers.set(renderer, { release });
  return release;
}

export function listNativeScenes() { return [...candidates.values()]; }
export function subscribeNativeScenes(listener) {
  observers.add(listener);
  return () => observers.delete(listener);
}
