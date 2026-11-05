import { it, expect } from 'vitest';
import * as THREE from 'three';
import { EventBus } from '../../foundation/EventBus.js';
import { StyleSystem } from '../../modules/rendering/style/StyleSystem.js';
import { officialStylePacks, stylePackSchema } from '../../modules/rendering/style/StylePack.js';
import { openScene } from '../../application/scene/SceneFacade.js';
import { openScenePackage } from '../../application/scene/ScenePackage.js';

it('prepares three styles, rolls back failed compilation and releases derived materials', async () => {
  const scene = new THREE.Scene(), events = new EventBus();
  const original = new THREE.MeshStandardMaterial({ color: '#aa7733' });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), original); mesh.userData.instanceId = 'box'; scene.add(mesh);
  const gameplayLight = new THREE.AmbientLight('#ffffff', 3.7); scene.add(gameplayLight);
  class EditorHelper extends THREE.Object3D {
    constructor(owner) { super(); this.owner = owner; }
    updateMatrixWorld() { if (!this.owner?.object) throw new Error('Editor helper cannot be cloned independently'); super.updateMatrixWorld(); }
  }
  const decorations = new THREE.Group(); decorations.userData.visualDecorationRoot = true;
  decorations.add(new EditorHelper({ object: mesh })); scene.add(decorations);
  const texture = new THREE.Texture(); original.map = texture;
  let textureDisposals = 0; texture.addEventListener('dispose', () => textureDisposals++);
  let reject = false;
  const renderer = { toneMappingExposure: 1, toneMapping: THREE.ACESFilmicToneMapping, shadowMap: { enabled: true }, compileAsync: async stage => { stage.updateMatrixWorld(); if (reject) throw new Error('compile failed'); } };
  const styles = new StyleSystem({ scene, events, getRenderer: () => renderer, getCamera: () => new THREE.PerspectiveCamera() });
  try {
    const geometry = mesh.geometry, uuid = mesh.uuid, position = mesh.position.toArray();
    for (const id of ['realistic', 'toon', 'low-poly']) {
      expect((await styles.set(`builtin://${id}`)).status).toBe('applied');
      expect(mesh.geometry).toBe(geometry); expect(mesh.uuid).toBe(uuid); expect(mesh.position.toArray()).toEqual(position);
      expect(original.map).toBe(texture);
      expect(gameplayLight.intensity).toBe(3.7);
    }
    const before = mesh.material, background = scene.background;
    let disposed = 0; before.addEventListener('dispose', () => disposed++);
    reject = true;
    await expect(styles.set('builtin://toon')).rejects.toThrow('STYLE_PREPARATION_FAILED');
    expect(mesh.material).toBe(before); expect(scene.background).toBe(background); expect(disposed).toBe(0);
    events.emit('object.removing', { id: 'box' });
    expect(mesh.material).toBe(original); expect(disposed).toBe(1); expect(textureDisposals).toBe(0);
  } finally { styles.dispose(); original.dispose(); texture.dispose(); mesh.geometry.dispose(); }
});

it('rejects executable/unsupported declarations and reports explicit fallback', async () => {
  expect(() => stylePackSchema.parse({ ...officialStylePacks.toon, shader: 'void main() {}' })).toThrow();
  const events = new EventBus(), styles = new StyleSystem({ scene: new THREE.Scene(), events, getRenderer: () => null, getCamera: () => null });
  try {
    const unsupported = { ...officialStylePacks.toon, id: 'example/unsupported', requires: ['community.javascript'], fallbackStyle: 'builtin://realistic' };
    await expect(styles.set(unsupported)).rejects.toThrow('STYLE_CAPABILITY_UNAVAILABLE');
    const fallback = await styles.set(unsupported, { fallback: 'declared' });
    expect(fallback.status).toBe('deferred'); expect(fallback.applied).toBeNull(); expect(fallback.pack.id).toBe('builtin/realistic');
  } finally { styles.dispose(); }
});

it('preserves Runtime facts across styles and carries the style dependency in portable saves', async () => {
  const scene = await openScene({ project: { schema: 'agentscape.scene-project', schemaVersion: 1, name: 'Styles', environment: { type: 'builtin', id: 'monument-hall' }, objects: [{ id: 'cup', asset: 'builtin://cup', level: 'physical' }] } });
  let reopened;
  try {
    const original = scene.observe();
    for (const id of ['realistic', 'toon', 'low-poly']) {
      expect((await scene.setStyle(`builtin://${id}`)).value.status).toBe('deferred');
      const { style, ...facts } = scene.observe();
      expect(facts).toEqual(Object.fromEntries(Object.entries(original).filter(([key]) => key !== 'style')));
    }
    const saved = await scene.save();
    expect(saved.value.style.id).toBe('builtin/low-poly');
    reopened = await openScenePackage(JSON.stringify(saved.value));
    expect((await reopened.save()).value.style.id).toBe('builtin/low-poly');
    expect(reopened.observe().objects[0].physicsRegistered).toBe(true);
    expect(reopened.observe().style.id).toBe('builtin/low-poly');
  } finally { scene.close(); reopened?.close(); }
});
