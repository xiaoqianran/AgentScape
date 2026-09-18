import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HUMAN_EYE_HEIGHT, HUMAN_QUERY_MANIFEST, HumanViewController } from '../../apps/studio/ui/HumanViewController.js';
import { createWoodlandWorkshop } from '../../modules/world/content/woodlandWorkshop.js';
import { PhysicsSystem } from '../../modules/world/runtime/systems/PhysicsSystem.js';
import { RapierPhysicsBackend } from '../../modules/physics/RapierPhysicsBackend.js';
import { disposeObject3D } from '../../modules/rendering/disposeObject3D.js';

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
      value: '',
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
  return { created, document: { createElement: make } };
}

function windowStub() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(name, handler) { listeners.set(name, handler); },
    removeEventListener(name) { listeners.delete(name); }
  };
}

function harness({ pose = { checked:true, clear:true, blockedBy:[] } } = {}) {
  const camera = new THREE.PerspectiveCamera(45, 2, 0.05, 120);
  camera.position.set(0, 6, 10);
  const controls = {
    enabled: true,
    target: new THREE.Vector3(0, 1, 0),
    update: vi.fn()
  };
  const element = {
    listeners: new Map(),
    addEventListener(name, handler) { this.listeners.set(name, handler); },
    removeEventListener(name) { this.listeners.delete(name); },
    getBoundingClientRect: () => ({ left:0, top:0, width:200, height:100 })
  };
  const scene = new THREE.Scene();
  const physics = {
    checkManifestPose: vi.fn(() => ({ ...pose, blockedBy:[...(pose.blockedBy || [])] })),
    // Vertical casts report the ground under the query; the third-person cast reports a wall.
    raycast: vi.fn((origin, target) => ({
      point: [target[0], 0, target[2]],
      distance: Math.hypot(target[0] - origin[0], target[1] - origin[1], target[2] - origin[2])
    }))
  };
  const world = {
    scene,
    physics,
    environment: { layout:{ groundY:0 } },
    events: { emit: vi.fn() },
    rendering: {
      viewport: () => ({ camera, controls, element }),
      cameraState: () => ({ position:[0,6,10], target:[0,1,0] }),
      applyCameraState: vi.fn()
    }
  };
  const windowTarget = windowStub();
  return { world, camera, controls, element, physics, scene, windowTarget };
}

const key = (type, code) => ({ code, target:null, preventDefault() {}, metaKey:false, ctrlKey:false, altKey:false });

describe('HumanViewController', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps orbit in charge until a human view is selected', () => {
    const h = harness();
    const controller = new HumanViewController({ world:h.world, windowTarget:h.windowTarget });
    expect(controller.mode).toBe('orbit');
    expect(controller.update(0)).toBe(false);
    expect(h.controls.enabled).toBe(true);
    expect(controller.viewPose()).toBeNull();
    expect(h.scene.children).toContain(controller.avatar.group);
    expect(controller.avatar.group.visible).toBe(false);
    controller.dispose();
  });

  it('walks forward through production physics instead of a guessed plane', () => {
    const h = harness();
    const controller = new HumanViewController({ world:h.world, windowTarget:h.windowTarget });
    controller.setMode('first');
    expect(h.controls.enabled).toBe(false);
    expect(controller.mode).toBe('first');
    const start = controller.position.clone();

    h.windowTarget.listeners.get('keydown')(key('keydown', 'KeyW'));
    controller.update(0);
    controller.update(16.7);
    const moved = controller.position.clone();
    expect(moved.z).toBeLessThan(start.z);
    expect(moved.x).toBeCloseTo(start.x, 6);
    expect(h.physics.checkManifestPose).toHaveBeenCalledWith(
      expect.objectContaining({ physics:{ colliders:[expect.objectContaining({ shape:'capsule' })] } }),
      expect.any(Array)
    );

    h.windowTarget.listeners.get('keyup')(key('keyup', 'KeyW'));
    controller.update(33.4);
    expect(controller.position.z).toBeCloseTo(moved.z, 6);
    controller.dispose();
  });

  it('refuses a blocked step and reports the real ground height', () => {
    const h = harness();
    h.physics.raycast.mockImplementation((origin, target) => ({ point:[target[0], 0.9, target[2]], distance:2 }));
    const controller = new HumanViewController({ world:h.world, windowTarget:h.windowTarget });
    controller.setMode('first');
    expect(controller.position.y).toBe(0.9);
    const start = controller.position.clone();

    h.physics.checkManifestPose.mockReturnValue({ checked:true, clear:false, blockedBy:['environment:$environment'] });
    h.windowTarget.listeners.get('keydown')(key('keydown', 'KeyD'));
    controller.update(0);
    controller.update(16.7);
    expect(controller.position.x).toBeCloseTo(start.x, 6);
    expect(controller.position.z).toBeCloseTo(start.z, 6);
    controller.dispose();
  });

  it('falls back to the orbit camera spot when the look-at target sits against a wall', () => {
    const h = harness();
    h.controls.target.set(0.2, 1.7, -7.4);
    h.camera.position.set(-0.6, 2.4, 3.2);
    h.physics.checkManifestPose.mockImplementation((manifest, position) => ({
      checked:true, clear:position[2] > -3, blockedBy:position[2] > -3 ? [] : ['environment:$environment']
    }));
    const controller = new HumanViewController({ world:h.world, windowTarget:h.windowTarget });
    controller.setMode('first');
    expect(controller.position.x).toBeCloseTo(-0.6, 6);
    expect(controller.position.z).toBeCloseTo(3.2, 6);
    // The spawn probe is deliberately wider than the walking capsule.
    expect(h.physics.checkManifestPose.mock.calls[0][0].physics.colliders[0].radius).toBeGreaterThan(0.3);
    controller.dispose();
  });

  it('exposes the head view pose so in-world interaction uses the real viewpoint', () => {
    const h = harness();
    const controller = new HumanViewController({ world:h.world, windowTarget:h.windowTarget });
    controller.setMode('first');
    controller.update(0);
    controller.update(16.7);
    const pose = controller.viewPose();
    expect(pose.position[1]).toBeCloseTo(controller.position.y + HUMAN_EYE_HEIGHT, 6);
    expect(pose.rotation).toHaveLength(4);
    expect(h.camera.position.y).toBeCloseTo(pose.position[1], 6);
    expect(h.world.events.emit).toHaveBeenCalledWith('human-view.mode', { mode:'first' });
    controller.dispose();
  });

  it('pulls the third-person camera in front of a real wall hit', () => {
    const h = harness();
    const controller = new HumanViewController({ world:h.world, windowTarget:h.windowTarget });
    controller.setMode('third');
    expect(controller.avatar.group.visible).toBe(true);
    h.physics.raycast.mockImplementation(() => ({ point:[0, 1.6, -0.5], distance:1 }));
    controller.update(0);
    controller.update(16.7);
    const distance = h.camera.position.distanceTo(controller.eye);
    expect(distance).toBeCloseTo(0.7, 4);
    controller.dispose();
  });

  it('restores the saved orbit pose when the human view ends', () => {
    const h = harness();
    const controller = new HumanViewController({ world:h.world, windowTarget:h.windowTarget });
    controller.setMode('third');
    controller.update(0);
    controller.dispose();
    expect(h.controls.enabled).toBe(true);
    expect(h.world.rendering.applyCameraState).toHaveBeenCalledWith({ position:[0,6,10], target:[0,1,0] });
    expect(h.scene.children).not.toContain(controller.avatar.group);
  });

  it('drops an active human view when the Runtime environment changes without restoring the old camera', () => {
    const h = harness();
    const controller = new HumanViewController({ world:h.world, windowTarget:h.windowTarget });
    controller.setMode('third');
    h.world.rendering.cameraState = vi.fn(() => ({ position:[9,4,2], target:[1,0,1] }));
    h.world.rendering.applyCameraState.mockClear();

    controller.resetForEnvironment();

    expect(controller.mode).toBe('orbit');
    expect(h.controls.enabled).toBe(true);
    expect(controller.avatar.group.visible).toBe(false);
    expect(controller.orbitState).toEqual({ position:[9,4,2], target:[1,0,1] });
    expect(h.world.rendering.applyCameraState).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('mounts the view switcher inside the world viewport', () => {
    const stub = domStub();
    vi.stubGlobal('document', stub.document);
    const h = harness();
    const viewport = { append: vi.fn() };
    const controller = new HumanViewController({ world:h.world, ui:{ viewport }, windowTarget:h.windowTarget });
    const panel = viewport.append.mock.calls[0][0];
    expect(panel.className).toBe('cabin-views human-views');
    const buttons = panel.children.filter((child) => child.tagName === 'BUTTON');
    expect(buttons.map((button) => button.textContent)).toEqual(['轨道', '第一人称', '第三人称']);
    buttons[2].listeners.get('click')();
    expect(controller.mode).toBe('third');
    expect(buttons[2].classList.contains('active')).toBe(true);
    expect(buttons[0].classList.contains('active')).toBe(false);
    controller.dispose();
  });

  it('admits the human query capsule on the real workshop floor and blocks it at the wall', async () => {
    const environment = createWoodlandWorkshop();
    const physics = new PhysicsSystem({ backend:new RapierPhysicsBackend() });
    await physics.init();
    try {
      physics.addEnvironment(environment.colliders, { id:environment.id });
      const inside = physics.checkManifestPose(HUMAN_QUERY_MANIFEST, [0, 0.02, -2]);
      expect(inside.checked).toBe(true);
      expect(inside.clear).toBe(true);
      const wall = physics.checkManifestPose(HUMAN_QUERY_MANIFEST, [0, 0.02, -8]);
      expect(wall.checked).toBe(true);
      expect(wall.clear).toBe(false);
      expect(wall.blockedBy.join(' ')).toContain('environment');
    } finally {
      physics.dispose();
      environment.dispose();
      disposeObject3D(environment.root);
    }
  }, 20000);
});
