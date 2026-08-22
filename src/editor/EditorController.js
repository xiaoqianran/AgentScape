import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

export class EditorController {
  constructor(runtime) {
    this.runtime = runtime;
    this.selectedId = null;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.box = new THREE.BoxHelper(undefined, 0x7aa2ff);
    this.box.visible = false;
    this.runtime.scene.add(this.box);

    this.transform = new TransformControls(runtime.camera, runtime.renderer.domElement);
    this.transform.setMode('translate');
    this.transform.setTranslationSnap(0.05);
    this.transform.setRotationSnap(THREE.MathUtils.degToRad(5));
    runtime.scene.add(this.transform.getHelper());

    this.onPointerDown = (event) => this.pick(event);
    runtime.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);

    this.transform.addEventListener('dragging-changed', ({ value }) => {
      runtime.controls.enabled = !value;
      if (!this.selectedId) return;
      if (value) {
        runtime.beginMutation(`editor:${this.transform.getMode()}`);
        runtime.physics.beginTransform(this.selectedId);
      } else {
        runtime.physics.endTransform(this.selectedId);
        runtime.commitMutation({ source: 'editor', id: this.selectedId, mode: this.transform.getMode() });
      }
    });
    this.transform.addEventListener('objectChange', () => {
      if (!this.selectedId) return;
      runtime.physics.syncTransform(this.selectedId, runtime.store.get(this.selectedId).object);
      runtime.events.emit('editor.transform', { id: this.selectedId, mode: this.transform.getMode() });
      this.box.update();
    });
  }

  pick(event) {
    if (this.transform.dragging) return;
    const rect = this.runtime.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.runtime.camera);

    const roots = this.runtime.store.list().map(([, record]) => record.object);
    const hits = this.raycaster.intersectObjects(roots, true);
    if (!hits.length) return this.select(null);

    let current = hits[0].object;
    while (current && !current.userData.instanceId) current = current.parent;
    this.select(current?.userData.instanceId || null);
  }

  select(id) {
    if (id === this.selectedId) return;
    this.selectedId = id;
    if (!id) {
      this.transform.detach();
      this.box.visible = false;
      this.runtime.events.emit('editor.selection', { id: null });
      return;
    }
    const record = this.runtime.store.get(id);
    this.transform.attach(record.object);
    this.box.setFromObject(record.object);
    this.box.visible = true;
    this.runtime.events.emit('editor.selection', { id });
  }

  setMode(mode) {
    if (!['translate', 'rotate'].includes(mode)) return;
    this.transform.setMode(mode);
    this.runtime.events.emit('editor.mode', { mode });
  }

  async duplicateSelected() {
    if (!this.selectedId) return null;
    const id = await this.runtime.mutate('editor:duplicate', () => this.runtime.duplicate(this.selectedId), { source: 'editor', id: this.selectedId });
    this.select(id);
    return id;
  }

  deleteSelected() {
    if (!this.selectedId) return false;
    const id = this.selectedId;
    this.select(null);
    return this.runtime.mutate('editor:delete', () => this.runtime.remove(id), { source: 'editor', id });
  }

  dispose() {
    this.runtime.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.transform.detach();
    this.transform.dispose();
    this.box.geometry.dispose();
    this.box.material.dispose();
    this.runtime.scene.remove(this.box);
  }
}
