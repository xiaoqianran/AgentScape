import { getAuthoringObjectId } from '../../../application/world-authoring/AuthoringIdentity.js';
import { resolvePointerSelection } from './PointerSelection.js';
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

const sameSelection = (a,b) => (
  a === b || (a?.source === b?.source && a?.id === b?.id)
);

export class EditorController {
  constructor(runtime, {
    getAuthoringRoot = ()=>null,
    getSelection = null,
    setSelection = null
  } = {}) {
    this.runtime = runtime;
    this.getAuthoringRoot=getAuthoringRoot;
    this.interactionMode = 'edit';

    let localSelection=null;
    this.getSelection = typeof getSelection === 'function' ? getSelection : () => localSelection;
    this.setSelection = typeof setSelection === 'function'
      ? setSelection
      : (selection) => { localSelection=selection; };

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.box = new THREE.BoxHelper(undefined, 0x7aa2ff);
    this.box.visible = false;
    this.dragBlocked = false;
    this.runtime.rendering.addDecoration(this.box);

    const viewport = runtime.rendering?.viewport?.();
    if (!viewport) throw new Error('EditorController requires an initialized RenderingSystem viewport');
    this.camera = viewport.camera;
    this.element = viewport.element;
    this.controls = viewport.controls;

    this.transform = new TransformControls(this.camera, this.element);
    this.transform.setMode('translate');
    this.transform.setTranslationSnap(0.05);
    this.transform.setRotationSnap(THREE.MathUtils.degToRad(5));
    this.transformHelper = this.transform.getHelper();
    runtime.rendering.addDecoration(this.transformHelper);

    this.onPointerDown = (event) => {
      if (event.button !== 0) return;

      this.clickStart = event.button === 0 && !this.transform.axis ? { x:event.clientX, y:event.clientY, id:event.pointerId } : null;
    };
    this.onPointerUp = (event) => {
      const start = this.clickStart;
      this.clickStart = null;
      if (start && start.id === event.pointerId && Math.hypot(event.clientX-start.x,event.clientY-start.y)<6) this.pick(event);
    };
    this.onPointerMove = (event) => {
      const start=this.clickStart;
      if(start && Math.hypot(event.clientX-start.x,event.clientY-start.y)>=6)this.clickStart=null;
    };
    this.onPointerCancel = () => { this.clickStart = null; };
    this.element.addEventListener('pointerdown', this.onPointerDown);
    this.element.addEventListener('pointerup', this.onPointerUp);
    this.element.addEventListener('pointermove', this.onPointerMove);
    this.element.addEventListener('pointercancel', this.onPointerCancel);

    this.transform.addEventListener('dragging-changed', ({ value }) => {
      this.controls.enabled = !value;
      const selectedId=this.selectedId;
      if (!selectedId) return;
      if (value) {
        this.dragBlocked = Boolean(runtime.store.get(selectedId).state?.heldBy || runtime.interactions?.isHeld?.(selectedId) || runtime.interactions?.carry?.agentHeld?.has(selectedId)) || !runtime.beginMutation('editor:' + this.transform.getMode());
        if (this.dragBlocked) {
          this.transform.reset();
          this.controls.enabled = true;
          return;
        }
        runtime.commands.beginTransform(selectedId);
      } else if (this.dragBlocked) {
        this.dragBlocked = false;
      } else {
        runtime.commands.endTransform(selectedId);
        runtime.commitMutation({ source:'editor', id:selectedId, mode:this.transform.getMode() });
      }
    });
    this.transform.addEventListener('objectChange', () => {
      const selectedId=this.selectedId;
      if (!selectedId || this.dragBlocked) return;
      const object=runtime.store.get(selectedId).object;
      runtime.commands.transform(selectedId,{
        position:object.position.toArray(),
        quaternion:object.quaternion.toArray(),
        scale:object.scale.toArray()
      },{source:'editor'});
      runtime.events.emit('editor.transform', { id:selectedId, mode:this.transform.getMode() });
      this.box.update();
    });
  }

  get selection() {
    return this.getSelection?.() || null;
  }

  get selectedId() {
    const selection=this.selection;
    return selection?.source === 'runtime' ? selection.id : null;
  }

  pick(event) {
    if (this.transform.dragging) return;
    const rect = this.element.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const roots = this.runtime.store.list().map(([, record]) => record.object);
    if(this.runtime.environment?.root) roots.push(this.runtime.environment.root);
    const authoringRoot=this.getAuthoringRoot?.();
    if(authoringRoot)roots.push(authoringRoot);
    const hits = this.raycaster.intersectObjects(roots, true);
    this.selectSelection(resolvePointerSelection(hits,this.runtime.environment));
  }

  select(id) {return this.selectSelection(id ? {source:'runtime',id} : null);}

  selectSelection(next) {
    if(next && !['runtime','environment','authoring'].includes(next.source))throw new TypeError('Unknown selection source');
    if(sameSelection(next,this.selection))return;
    this.transform.detach();this.box.visible=false;
    this.setSelection(next);
    let object=null;
    if(next?.source==='runtime')object=this.runtime.store.get(next.id)?.object;
    if(next?.source==='environment')object=this.runtime.environment?.interactions?.find(item=>(item.contractId || item.id)===next.id)?.object;
    if(next?.source==='authoring')this.getAuthoringRoot?.()?.traverse(node=>{if(getAuthoringObjectId(node)===next.id)object=node;});
    if(object) {
      if(next.source==='runtime' && this.interactionMode==='edit')this.transform.attach(object);
      this.box.setFromObject(object);this.box.visible=true;
    }
    this.runtime.events.emit('editor.selection',{id:next?.source==='runtime'?next.id:null,selection:next});
  }

  setInteractionMode(mode) {
    if (!['explore','edit'].includes(mode)) return false;
    if (this.transform.dragging) this.transform.pointerUp({button:0});
    this.interactionMode=mode;
    this.transform.detach();
    this.transform.enabled=mode==='edit';
    if (mode==='edit' && this.selectedId) this.transform.attach(this.runtime.store.get(this.selectedId).object);
    return true;
  }

  setMode(mode) {
    if (this.interactionMode !== 'edit') return;
    if (!['translate', 'rotate'].includes(mode)) return;
    this.transform.setMode(mode);
    this.runtime.events.emit('editor.mode', { mode });
  }

  async duplicateSelected() {
    if (this.interactionMode !== 'edit') return null;
    const selectedId=this.selectedId;
    if (!selectedId) return null;
    const result = await this.runtime.mutate(
      'editor:duplicate',
      () => this.runtime.commands.duplicate(selectedId),
      { source:'editor', id:selectedId }
    );
    const id = typeof result === 'string' ? result : result?.id || null;
    if (id) this.select(id);
    return result;
  }

  deleteSelected() {
    if (this.interactionMode !== 'edit') return false;
    const selectedId=this.selectedId;
    if (!selectedId) return false;
    this.select(null);
    return this.runtime.mutate(
      'editor:delete',
      () => this.runtime.commands.remove(selectedId),
      { source:'editor', id:selectedId }
    );
  }

  dispose() {
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('pointerup', this.onPointerUp);
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointercancel', this.onPointerCancel);
    this.transform.detach();
    this.transform.dispose();
    this.box.geometry.dispose();
    this.box.material.dispose();
    this.runtime.rendering.removeDecoration(this.box);
    this.runtime.rendering.removeDecoration(this.transformHelper);
    this.runtime=null;
  }
}
