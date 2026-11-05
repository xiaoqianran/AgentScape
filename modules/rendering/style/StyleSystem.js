import * as THREE from 'three';
import { resolveStylePack } from './StylePack.js';

const fail = code => Object.assign(new Error(code), { code });
const array = material => Array.isArray(material) ? material : [material];
const ancestors = function* (node) { for (let p = node; p; p = p.parent) yield p; };
const meshes = scene => {
  const result = [];
  scene.traverse(node => { if (node.isMesh && ![...ancestors(node)].some(p => p.userData?.visualDecorationRoot)) result.push(node); });
  return result;
};
const cloneVisual = node => {
  if (node.userData?.visualDecorationRoot) return null;
  const clone = node.clone(false);
  for (const child of node.children) { const visual = cloneVisual(child); if (visual) clone.add(visual); }
  return clone;
};

/** Owns derived visual resources only. Never receives a World/Physics/Store. */
export class StyleSystem {
  constructor({ scene, getRenderer, getCamera, events, prepareTimeoutMs = 30_000 }) {
    this.scene = scene; this.getRenderer = getRenderer; this.getCamera = getCamera;
    this.events = events;
    this.prepareTimeoutMs = prepareTimeoutMs;
    this.originals = new Map(); this.derived = new Map(); this.current = null; this.base = null;
    this.rig = null;
    this.unsub = [
      events.on('object.spawned', () => this.refresh()),
      events.on('scene.restored', () => this.refresh()),
      events.on('environment.replaced', () => { this.restoreMeshes(mesh => ![...ancestors(mesh)].includes(this.scene), true); this.refresh(); }),
      events.on('object.removing', ({ id }) => this.restoreMeshes(mesh => [...ancestors(mesh)].some(node => node.userData?.instanceId === id))),
      events.on('world.disposing', () => this.dispose())
    ];
  }
  export() { return this.current ? structuredClone(this.current) : null; }
  notify() { try { this.events.emit('style.changed', { id: this.current?.id || null }); return []; } catch { return ['STYLE_OBSERVER_FAILED']; } }
  capabilities() { return new Set(['material.standard', 'material.toon', 'material.flat', 'renderer.exposure', 'renderer.shadows', 'scene.fog']); }
  capture() {
    const renderer = this.getRenderer();
    return { background: this.scene.background, fog: this.scene.fog, exposure: renderer.toneMappingExposure, toneMapping: renderer.toneMapping, shadows: renderer.shadowMap?.enabled, rig: this.rig };
  }
  restoreVisual(value) {
    const renderer = this.getRenderer();
    this.scene.background = value.background; this.scene.fog = value.fog;
    if (renderer) { renderer.toneMappingExposure = value.exposure; renderer.toneMapping = value.toneMapping; if (renderer.shadowMap) renderer.shadowMap.enabled = value.shadows; }
    if (this.rig !== value.rig) { this.releaseRig(this.rig); this.rig = value.rig; if (this.rig) this.scene.add(this.rig); }
  }
  material(original, pack, cache, warnings) {
    if (!original || original.isShaderMaterial || original.isRawShaderMaterial || original.transmission > 0) {
      if (pack.material.unsupported === 'reject') throw fail('STYLE_MATERIAL_UNSUPPORTED');
      warnings.add('STYLE_MATERIAL_PRESERVED'); return original;
    }
    if (cache.has(original)) return cache.get(original);
    let next;
    if (pack.material.mode === 'toon') {
      next = new THREE.MeshToonMaterial();
      for (const key of ['map', 'normalMap', 'alphaMap', 'emissiveMap', 'aoMap', 'transparent', 'opacity', 'side', 'alphaTest', 'depthWrite', 'vertexColors', 'blending']) if (original[key] != null) next[key] = original[key];
      if (original.color) next.color.copy(original.color);
      if (original.emissive) next.emissive.copy(original.emissive);
      if (original.normalScale) next.normalScale.copy(original.normalScale);
    } else {
      next = original.clone();
      if ('roughness' in next) next.roughness = pack.material.roughness;
      if ('metalness' in next) next.metalness = pack.material.metalness;
      next.flatShading = pack.material.mode === 'flat';
    }
    next.needsUpdate = true; cache.set(original, next); return next;
  }
  prepare(pack, targets, reuse = false) {
    const cache = reuse ? new Map(this.derived) : new Map(), warnings = new Set(), assignments = [];
    const existing = new Set(this.derived.values());
    try {
      for (const mesh of targets) {
        const original = this.originals.get(mesh)?.material || mesh.material;
        const converted = array(original).map(material => this.material(material, pack, cache, warnings));
        assignments.push({ mesh, material: Array.isArray(original) ? converted : converted[0], original, previous: mesh.material, geometry: mesh.geometry });
      }
      return { cache, warnings: [...warnings], assignments };
    } catch (error) { for (const material of cache.values()) if (!existing.has(material)) material.dispose(); throw error; }
  }
  makeRig(pack) {
    const rig = new THREE.Group(); rig.name = '$agentscape-style-lights'; rig.userData.visualDecorationRoot = true;
    const ambient = new THREE.AmbientLight('#ffffff', pack.lighting.ambient);
    const directional = new THREE.DirectionalLight('#ffffff', pack.lighting.directional);
    directional.position.set(8, 12, 6); directional.castShadow = pack.postprocessing.shadows;
    rig.add(ambient, directional); return rig;
  }
  releaseRig(rig) { if (!rig) return; rig.removeFromParent(); rig.traverse(node => { if (node.isLight) node.dispose?.(); }); }
  applyScene(pack, refresh = false) {
    const renderer = this.getRenderer();
    this.scene.background = new THREE.Color(pack.scene.background);
    this.scene.fog = pack.scene.fog ? new THREE.Fog(pack.scene.fog.color, pack.scene.fog.near, pack.scene.fog.far) : null;
    renderer.toneMappingExposure = pack.postprocessing.exposure;
    renderer.toneMapping = pack.postprocessing.toneMapping === 'aces' ? THREE.ACESFilmicToneMapping : THREE.LinearToneMapping;
    if (renderer.shadowMap) renderer.shadowMap.enabled = pack.postprocessing.shadows;
    // Gameplay may read its own light state; visual lighting owns a separate rig.
    if (!refresh || !this.rig) { this.rig?.removeFromParent(); this.rig = this.makeRig(pack); }
    if (this.rig.parent !== this.scene) this.scene.add(this.rig);
  }
  async set(input, { fallback = 'reject' } = {}) {
    let pack = resolveStylePack(input); const visited = new Set();
    const requested = pack.id;
    while (pack.requires.some(capability => !this.capabilities().has(capability))) {
      if (fallback !== 'declared' || !pack.fallbackStyle || visited.has(pack.id) || visited.size >= 8) throw fail('STYLE_CAPABILITY_UNAVAILABLE');
      visited.add(pack.id); pack = resolveStylePack(pack.fallbackStyle);
    }
    const renderer = this.getRenderer();
    if (!renderer) { this.current = pack; return { status: 'deferred', pack: structuredClone(pack), requested, applied: null, warnings: this.notify(), rendered: false }; }
    if (typeof renderer.compileAsync !== 'function') throw fail('STYLE_RENDERER_UNSUPPORTED');
    const prepared = this.prepare(pack, meshes(this.scene));
    const previous = this.capture();
    const programs = new Set(renderer.info?.programs || []);
    let committing = false;
    let stagedRig;
    try {
      const stage = cloneVisual(this.scene), staged = meshes(stage);
      stage.getObjectByName('$agentscape-style-lights')?.removeFromParent();
      stagedRig = this.makeRig(pack); stage.add(stagedRig);
      for (let index = 0; index < staged.length; index++) staged[index].material = prepared.assignments[index].material;
      let timer;
      try { await Promise.race([renderer.compileAsync(stage, this.getCamera()), new Promise((_, reject) => { timer = setTimeout(() => reject(fail('STYLE_PREPARATION_TIMEOUT')), this.prepareTimeoutMs); })]); }
      finally { clearTimeout(timer); }
      if ((renderer.info?.programs || []).some(program => !programs.has(program) && program.diagnostics?.runnable === false)) throw fail('STYLE_COMPILE_FAILED');
      const live = meshes(this.scene);
      if (live.length !== prepared.assignments.length || prepared.assignments.some((entry, index) => live[index] !== entry.mesh || entry.mesh.material !== entry.previous || entry.mesh.geometry !== entry.geometry)) throw fail('STYLE_SCENE_CHANGED');
      // Synchronous commit: no visible half-style frame between assignments.
      committing = true;
      for (const entry of prepared.assignments) {
        if (!this.originals.has(entry.mesh)) this.originals.set(entry.mesh, { material: entry.original });
        entry.mesh.material = entry.material;
      }
      this.applyScene(pack);
    } catch (error) {
      if (committing) {
        for (const entry of prepared.assignments) entry.mesh.material = entry.previous;
        this.restoreVisual(previous);
      }
      for (const material of prepared.cache.values()) material.dispose();
      throw error.code ? error : Object.assign(fail('STYLE_PREPARATION_FAILED'), { cause: error });
    } finally { this.releaseRig(stagedRig); }
    this.base ||= previous;
    if (previous.rig !== this.rig) this.releaseRig(previous.rig);
    for (const material of this.derived.values()) material.dispose();
    this.derived = prepared.cache; this.current = pack;
    return { status: 'applied', pack: structuredClone(pack), requested, applied: pack.id, warnings: [...prepared.warnings, ...this.notify(), ...(requested !== pack.id ? ['STYLE_FALLBACK_APPLIED'] : [])], rendered: true };
  }
  refresh() {
    if (!this.current || !this.getRenderer()) return;
    this.base ||= this.capture();
    const targets = meshes(this.scene).filter(mesh => !this.originals.has(mesh));
    const prepared = this.prepare(this.current, targets, true);
    for (const entry of prepared.assignments) { this.originals.set(entry.mesh, { material: entry.original }); entry.mesh.material = entry.material; }
    this.derived = prepared.cache;
    this.applyScene(this.current, true);
  }
  restoreMeshes(predicate, releaseOriginals = false) {
    const removed = new Set();
    for (const [mesh, original] of this.originals) if (predicate(mesh)) { mesh.material = original.material; array(original.material).forEach(material => removed.add(material)); this.originals.delete(mesh); }
    const used = new Set([...this.originals.values()].flatMap(value => array(value.material)));
    for (const [original, material] of this.derived) if (!used.has(original)) { material.dispose(); this.derived.delete(original); }
    if (releaseOriginals) for (const material of removed) if (!used.has(material)) material.dispose();
  }
  dispose() {
    this.clear();
    this.unsub.forEach(unsubscribe => unsubscribe()); this.unsub = [];
  }
  clear() {
    this.restoreMeshes(() => true);
    if (this.base) this.restoreVisual(this.base);
    this.current = null; this.base = null;
    this.notify();
  }
}
