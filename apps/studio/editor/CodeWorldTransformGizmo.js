import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

const fail = code => Object.assign(new Error(code), { code });
const allowedMode = Object.freeze({ translate:'position', rotate:'quaternion', scale:'scale' });
const readLocal = object => ({
  position:object.position.toArray(),
  quaternion:object.quaternion.toArray(),
  scale:object.scale.toArray()
});
const changed = (left, right, tolerance = 1e-5) => left.some((value, index) =>
  Math.abs(value - right[index]) > tolerance
);
const nearMatrix = (left, right, tolerance = 1e-4) => left.elements.every((value, index) =>
  Math.abs(value - right.elements[index]) <= tolerance
);

/**
 * A code-world adapter for Three's TransformControls. Dragging only transforms
 * a separate pivot and selection outline. The project's true Object3D and its
 * native editor overlays are changed solely via SceneFacade.apply at release.
 *
 * This module has no second Runtime, asset cache, or global scene registry.
 */
export class CodeWorldTransformGizmo {
  /** @param {{
   * scene:any, camera:any, element:any, getObject:(id:string)=>any,
   * getRevision:()=>number, onCommit:(change:any)=>Promise<void>,
   * onPreview?:(event:any)=>void, onFinish?:(event:any)=>void,
   * onMode?:(mode:'translate'|'rotate'|'scale')=>void, onAxis?:(axis:string)=>void
   * }} options */
  constructor({ scene, camera, element, getObject, getRevision, onCommit, onPreview = () => {},
    onFinish = () => {}, onMode = () => {}, onAxis = () => {} } = {}) {
    if (!scene?.isScene || !camera?.isCamera || !element?.addEventListener ||
        typeof getObject !== 'function' || typeof getRevision !== 'function' || typeof onCommit !== 'function') {
      throw fail('CODE_GIZMO_VIEWPORT_INVALID');
    }
    Object.assign(this, {scene,camera,element,getObject,getRevision,onCommit,onPreview,onFinish,onMode,onAxis});
    this.disposed = false;
    this.selected = null;
    this.pivot = null;
    this.outline = null;
    this.drag = null;
    this.pending = false;
    this.ignoreClick = false;

    this.control = new TransformControls(camera, element);
    this.control.setMode('translate');
    this.control.setTranslationSnap(0.1);
    this.control.setRotationSnap(THREE.MathUtils.degToRad(5));
    this.control.setScaleSnap(0.05);
    this.control.size = 1.25;
    this.helper = this.control.getHelper();
    this.helper.name = 'AgentScapeCodeWorldGizmo';
    this.scene.add(this.helper);

    this.onDraggingChanged = ({ value }) => {
      if (value) this.beginDrag();
      else this.finishDrag();
    };
    this.onObjectChange = () => {
      if (this.drag) this.previewDrag();
    };
    this.onAxisChange = ({ value }) => this.onAxis(value || '');
    this.onPointerCancel = () => this.cancelDrag();
    this.onPointerDownCapture = event => {
      if (event.button === 0 && !this.control.axis && !this.control.dragging) this.ignoreClick = false;
    };
    this.onKeyDown = event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const tag = event.target?.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || event.target?.isContentEditable) return;
      if (event.key === 'Escape' && this.drag) { this.cancelDrag(); event.preventDefault(); return; }
      const modes = { w:'translate', e:'rotate', r:'scale' };
      const mode = modes[event.key.toLowerCase()];
      if (mode && this.selected?.properties.includes(allowedMode[mode])) {
        this.setMode(mode);
        event.preventDefault();
      }
    };
    this.control.addEventListener('dragging-changed', this.onDraggingChanged);
    this.control.addEventListener('objectChange', this.onObjectChange);
    this.control.addEventListener('axis-changed', this.onAxisChange);
    this.element.addEventListener('pointercancel', this.onPointerCancel);
    this.element.addEventListener('pointerdown', this.onPointerDownCapture, true);
    window.addEventListener('keydown', this.onKeyDown);
  }

  get mode() { return this.control.getMode(); }
  get dragging() { return Boolean(this.drag); }
  consumePickSuppression() {
    const suppressed = this.ignoreClick || this.control.dragging || Boolean(this.control.axis);
    this.ignoreClick = false;
    return suppressed;
  }

  setMode(mode) {
    if (!Object.hasOwn(allowedMode, mode)) throw fail('CODE_GIZMO_MODE_INVALID');
    if (this.drag || this.pending) return false;
    if (this.selected && !this.selected.properties.includes(allowedMode[mode])) return false;
    if (this.mode === mode) return true;
    this.control.setMode(mode);
    this.control.setSpace(mode === 'translate' ? 'world' : 'local');
    this.resetPivot();
    this.onMode(mode);
    return true;
  }

  select(selection) {
    if (this.drag || this.pending) return false;
    const id = selection?.id;
    const object = id ? this.getObject(id) : null;
    if (!object?.isObject3D || !object.parent) selection = null;
    if (selection && (!['code', 'editor'].includes(selection.source) ||
      !Array.isArray(selection.properties))) throw fail('CODE_GIZMO_SELECTION_INVALID');
    if (this.selected?.id === selection?.id &&
        this.selected?.source === selection?.source &&
        this.selected?.object === object &&
        this.selected.properties.join(',') === selection?.properties?.join(',')) return true;

    this.detach();
    if (!selection) return true;
    this.selected = { ...selection, object };
    if (!selection.properties.includes(allowedMode[this.mode])) {
      const fallback = Object.keys(allowedMode).find(mode => selection.properties.includes(allowedMode[mode]));
      if (!fallback) { this.detach(); return false; }
      this.control.setMode(fallback);
      this.onMode(fallback);
    }
    this.resetPivot();
    return true;
  }

  resetPivot() {
    const selected = this.selected;
    if (!selected || this.drag || this.pending) return;
    this.releaseObjects();
    const target = selected.object;
    target.updateWorldMatrix(true, true);
    const origin = target.getWorldPosition(new THREE.Vector3());
    const bound = new THREE.Box3().setFromObject(target);
    const center = !bound.isEmpty() && this.mode === 'translate' ? bound.getCenter(new THREE.Vector3()) : origin;
    this.pivot = new THREE.Object3D();
    this.pivot.name = 'AgentScapeCodeWorldEditPivot';
    this.pivot.position.copy(center);
    this.pivot.quaternion.copy(target.getWorldQuaternion(new THREE.Quaternion()));
    this.scene.add(this.pivot);
    this.pivot.updateWorldMatrix(true, false);

    this.outline = new THREE.BoxHelper(target, 0xffc56b);
    this.outline.name = 'AgentScapeCodeWorldEditOutline';
    this.outline.material.depthTest = false;
    this.outline.material.transparent = true;
    this.outline.material.opacity = 0.9;
    this.outline.renderOrder = 999;
    this.scene.add(this.outline);
    this.control.attach(this.pivot);
    this.base = {
      pivot:this.pivot.matrixWorld.clone(),
      target:target.matrixWorld.clone(),
      parent:target.parent.matrixWorld.clone(),
      local:readLocal(target)
    };
  }

  beginDrag() {
    if (!this.selected || !this.pivot || this.pending) {
      this.cancelDrag();
      return;
    }
    this.ignoreClick = true;
    this.drag = {
      selected:this.selected,
      base:{...this.base,local:structuredClone(this.base.local)},
      mode:this.mode,
      revision:this.getRevision(),
      cancelled:false
    };
    // The caller stamps the Scene revision at drag start, not at pointer release.
    // A concurrent MCP write must therefore be rejected rather than overwritten.
    this.onPreview({phase:'start',selection:this.selected});
  }

  candidate() {
    const { pivot, base } = this;
    pivot.updateWorldMatrix(true, false);
    const delta = new THREE.Matrix4().multiplyMatrices(
      pivot.matrixWorld, new THREE.Matrix4().copy(base.pivot).invert());
    const targetWorld = new THREE.Matrix4().multiplyMatrices(delta, base.target);
    const local = new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().copy(base.parent).invert(), targetWorld);
    const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
    local.decompose(position, quaternion, scale);
    if (!nearMatrix(local, new THREE.Matrix4().compose(position, quaternion, scale))) {
      throw fail('CODE_GIZMO_SHEARED_TRANSFORM_UNSUPPORTED');
    }
    quaternion.normalize();
    return { position:position.toArray(),quaternion:quaternion.toArray(),scale:scale.toArray(),delta };
  }

  previewDrag() {
    if (!this.drag) return;
    try {
      const candidate = this.candidate();
      this.outline.matrix.copy(candidate.delta);
      this.outline.updateMatrixWorld(true);
      this.onPreview({phase:'move',selection:this.selected,transform:{
        position:candidate.position,quaternion:candidate.quaternion,scale:candidate.scale
      }});
    } catch (error) {
      this.onPreview({phase:'invalid',error});
    }
  }

  /** Called by TransformControls after mouseUp, one transaction per gesture. */
  finishDrag() {
    const drag = this.drag;
    if (!drag || this.disposed) return;
    this.drag = null;
    if (drag.cancelled) { this.resetPivot();this.onFinish({cancelled:true}); return; }
    let operation;
    try {
      if (this.getObject(drag.selected.id) !== drag.selected.object)
        throw fail('CODE_GIZMO_WORLD_CHANGED');
      const parent = drag.selected.object.parent;
      parent?.updateWorldMatrix(true, false);
      if (!parent || !nearMatrix(parent.matrixWorld, drag.base.parent))
        throw fail('CODE_GIZMO_PARENT_CHANGED');
      if (changed(drag.base.local.position, drag.selected.object.position.toArray()) ||
          changed(drag.base.local.scale, drag.selected.object.scale.toArray()) ||
          changed(drag.base.local.quaternion, drag.selected.object.quaternion.toArray()))
        throw fail('CODE_GIZMO_TARGET_CHANGED');
      const next = this.candidate();
      if (drag.selected.source === 'code') {
        const key=allowedMode[drag.mode];
        if (!drag.selected.properties.includes(key)) throw fail('CODE_GIZMO_PROPERTY_FORBIDDEN');
        if (!changed(drag.base.local[key], next[key])) {
          this.resetPivot();this.onFinish({cancelled:true});return;
        }
        operation = {type:'editNative',id:drag.selected.id,changes:{[key]:next[key]}};
      } else {
        const local = {position:next.position,quaternion:next.quaternion,scale:next.scale};
        if (local.scale.some(value=>Math.abs(value-local.scale[0])>1e-5))
          throw fail('CODE_GIZMO_UNIFORM_SCALE_REQUIRED');
        if (local.scale[0] < 0.05 || local.scale[0] > 20) throw fail('CODE_GIZMO_SCALE_OUT_OF_RANGE');
        operation={type:'setTransform',id:drag.selected.id,transform:{
          position:local.position,quaternion:local.quaternion,scale:local.scale[0]
        }};
        if (!Object.keys(local).some(key=>changed(drag.base.local[key],local[key]))) {
          this.resetPivot();this.onFinish({cancelled:true});return;
        }
      }
    } catch(error) {
      this.resetPivot();
      this.onFinish({error});
      return;
    }
    this.pending=true;
    this.control.enabled=false;
    Promise.resolve().then(()=>this.onCommit({operation,selection:drag.selected,
      expectedRevision:drag.revision,mode:drag.mode}))
      .then(()=>{
        if(this.disposed)return;
        this.pending=false;
        this.control.enabled=true;
        this.resetPivot();
        this.onFinish({committed:true,selection:drag.selected,mode:drag.mode});
      })
      .catch(error=>{
        if(this.disposed)return;
        this.pending=false;
        this.control.enabled=true;
        this.resetPivot();
        this.onFinish({error});
      });
  }

  cancelDrag() {
    if (!this.drag) return;
    this.drag.cancelled = true;
    this.control.reset();
    this.control.pointerUp({button:0});
  }

  releaseObjects() {
    this.control.detach();
    this.pivot?.removeFromParent();
    this.pivot = null;
    if(this.outline){
      this.outline.removeFromParent();
      this.outline.geometry.dispose();
      this.outline.material.dispose();
      this.outline=null;
    }
  }
  detach() {
    this.releaseObjects();
    this.selected=null;
    this.base=null;
  }
  dispose() {
    if(this.disposed)return;
    this.disposed=true;
    this.drag=null;
    this.element.removeEventListener('pointercancel',this.onPointerCancel);
    this.element.removeEventListener('pointerdown',this.onPointerDownCapture,true);
    window.removeEventListener('keydown',this.onKeyDown);
    this.control.removeEventListener('dragging-changed',this.onDraggingChanged);
    this.control.removeEventListener('objectChange',this.onObjectChange);
    this.control.removeEventListener('axis-changed',this.onAxisChange);
    this.detach();
    this.helper.removeFromParent();
    this.control.dispose();
  }
}
