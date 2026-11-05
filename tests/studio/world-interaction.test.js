import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CABIN_INLINE_EDITORS, createInlineEditors, mountWorldInteraction } from '../../apps/studio/ui/WorldInteraction.js';

function domStub() {
  const created = [];
  const make = (tag) => {
    const classes = new Set();
    const element = {
      tagName: String(tag).toUpperCase(),
      children: [],
      listeners: new Map(),
      dataset: {},
      style: {},
      className: '',
      textContent: '',
      hidden: false,
      id: '',
      type: '',
      value: '',
      maxLength: 0,
      htmlFor: '',
      accept: '',
      setAttribute(name, value) { this[name] = value; },
      append(...items) { this.children.push(...items); },
      remove() {},
      focus() {},
      select() {},
      addEventListener(name, handler) { this.listeners.set(name, handler); },
      removeEventListener(name, handler) { if (this.listeners.get(name) === handler) this.listeners.delete(name); },
      classList: {
        add: (value) => classes.add(value),
        remove: (value) => classes.delete(value),
        contains: (value) => classes.has(value),
        toggle: (value, on) => (on ? classes.add(value) : classes.delete(value))
      }
    };
    created.push(element);
    return element;
  };
  const find = (selector) => created.find((element) => element.id === selector.replace(/^#/, ''));
  return { created, find, document: { createElement: make } };
}

function scene3d() {
  const camera = new THREE.PerspectiveCamera(45, 2, 0.05, 120);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const element = {
    listeners: new Map(),
    addEventListener(name, handler) { this.listeners.set(name, handler); },
    removeEventListener(name) { this.listeners.delete(name); },
    getBoundingClientRect: () => ({ left:0, top:0, width:200, height:100 })
  };
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  const board = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.1), new THREE.MeshBasicMaterial());
  board.name = 'Notice board';
  root.add(board);
  scene.add(root);
  scene.updateMatrixWorld(true);
  const controls = { target:new THREE.Vector3(), update: vi.fn() };
  const activated = vi.fn(() => true);
  const environment = {
    id: 'test-world',
    root,
    interactions: [{ id:'test:board', label:'告示板文字', object:board, activate:activated }],
    views: [{ label:'全景', position:[1,2,3], target:[0,0,0] }]
  };
  const world = {
    scene,
    environment,
    store: { list: () => [] },
    events: { emit: vi.fn() },
    rendering: { viewport: () => ({ camera, element, controls }) }
  };
  return { world, environment, camera, element, controls, activated, board };
}

describe('world-first interaction overlay', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('builds the declared inline editors with a stable DOM contract', () => {
    const stub = domStub();
    vi.stubGlobal('document', stub.document);
    const parent = stub.document.createElement('div');
    const host = createInlineEditors(parent, CABIN_INLINE_EDITORS);
    expect(host.className).toBe('cabin-editors');
    expect(parent.children).toContain(host);
    expect(stub.find('#signInput').maxLength).toBe(10);
    expect(stub.find('#noteInput').maxLength).toBe(10);
    expect(stub.find('#picInput').maxLength).toBe(2048);
    for (const id of ['sign', 'note', 'pic']) {
      // The save button belongs to the world module; this layer only guarantees its contract.
      expect(stub.find(`#${id}Ok`).textContent).toBe('保存');
      expect(stub.find(`#${id}Ok`).listeners.has('click')).toBe(false);
      expect(host.children.some((form) => form.id === `${id}Editor`)).toBe(true);
    }
    // Only the picture form accepts an uploaded file.
    const picForm = host.children.find((form) => form.id === 'picEditor');
    const signForm = host.children.find((form) => form.id === 'signEditor');
    expect(picForm.children.some((child) => child.type === 'file')).toBe(true);
    expect(signForm.children.some((child) => child.type === 'file')).toBe(false);
    expect(host.listeners.size).toBe(0);
  });

  it('owns camera controls without installing a competing pointer handler or prompt',()=>{
    const stub=domStub();vi.stubGlobal('document',stub.document);const h=scene3d();
    const ui={viewport:stub.document.createElement('div')};
    const overlay=mountWorldInteraction({world:h.world,ui});
    expect(ui.viewport.children.map(item=>item.className)).toEqual(['cabin-views']);
    expect(h.element.listeners.size).toBe(0);
    ui.viewport.children[0].children[0].listeners.get('click')();
    expect(h.camera.position.toArray()).toEqual([1,2,3]);overlay.dispose();
  });
  it('catalog selection uses the shared controller without executing',()=>{
    const stub=domStub();vi.stubGlobal('document',stub.document);const h=scene3d();
    h.environment.catalog={label:'Objects'};h.environment.interactions[0].contractId='board';
    const editor={selectSelection:vi.fn()};const ui={viewport:stub.document.createElement('div')};
    const overlay=mountWorldInteraction({world:h.world,ui,editor});
    const catalog=ui.viewport.children[0].children.at(-1);
    catalog.children[1].children[0].listeners.get('click')();
    expect(editor.selectSelection).toHaveBeenCalledWith({source:'environment',id:'board'});
    expect(h.activated).not.toHaveBeenCalled();overlay.dispose();
  });

  it('does not mount when the world declares no interactions', () => {
    const h = scene3d();
    h.environment.interactions = [];
    const ui = { viewport: { append: vi.fn() } };
    expect(mountWorldInteraction({ world:h.world, ui })).toBeNull();
    expect(ui.viewport.append).not.toHaveBeenCalled();
  });
});
