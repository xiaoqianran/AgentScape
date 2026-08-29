import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ObjectStore } from '../world/runtime/ObjectStore.js';
import { createRapierPhysicsSystem } from './helpers/createRapierPhysicsSystem.js';
import { bindDebugLayers } from '../studio/debug/bindDebugLayers.js';

/**
 * 用最小 DOM stub 验证绑定逻辑，不引入 jsdom 依赖。
 * 覆盖的是契约：菜单生成、capability 联动、未启用时不改 Runtime。
 * 真实像素渲染仍需浏览器验证（见 docs/debug-overlay.md）。
 */

function createDomStub() {
  const registry = [];
  const make = (tag) => {
    const node = {
      tagName: tag, className: '', textContent: '', title: '', type: '',
      dataset: {}, children: [], disabled: false, checked: false, style: {},
      parentElement: null,
      append(...items) { for (const i of items) { i.parentElement = node; node.children.push(i); } },
      replaceChildren(...items) { node.children = items; for (const i of items) i.parentElement = node; },
      addEventListener(event, handler) { (node.handlers ||= {})[event] = handler; },
      querySelectorAll(selector) {
        if (!selector.includes('data-layer')) return [];
        // 真实 DOM 的 querySelectorAll 递归匹配后代；stub 必须同构。
        const found = [];
        const walk = (target) => {
          for (const child of target.children) {
            if (child.dataset.layer) found.push(child);
            walk(child);
          }
        };
        walk(node);
        return found;
      }
    };
    if (tag === 'input') registry.push(node);
    return node;
  };
  const menu = make('div');
  globalThis.document = { querySelector: (sel) => (sel === '#debug-layer-menu' ? menu : null), createElement: make };
  return { menu, registry };
}

async function runtimeStub({ collision = true, articulated = true } = {}) {
  const store = new ObjectStore();
  const scene = new THREE.Scene();
  const physics = createRapierPhysicsSystem();
  await physics.init();
  physics.hasCapability = (cap) => {
    if (cap === 'collision') return collision;
    if (cap === 'articulated-body') return articulated;
    return true;
  };
  let updateCalls = 0;
  return {
    store, scene, physics,
    sceneGraph: { update() {}, list: () => [] },
    interactions: null,
    navigation: null,
    update() { updateCalls++; },
    get updateCalls() { return updateCalls; }
  };
}

describe('debug layer binding', () => {
  it('builds one checkbox per layer and leaves all unchecked', async () => {
    const { registry } = createDomStub();
    const world = await runtimeStub();
    const bound = bindDebugLayers(world, { log: () => {} });
    expect(registry.length).toBe(6);
    expect(registry.every((input) => input.checked === false)).toBe(true);
    bound.dispose();
  });

  it('disables collider layer when the physics backend lacks collision capability', async () => {
    const { registry } = createDomStub();
    const world = await runtimeStub({ collision: false });
    const bound = bindDebugLayers(world, { log: () => {} });
    const collider = registry.find((input) => input.dataset.layer === 'collider');
    expect(collider.disabled).toBe(true);
    // 不可用的图层必须给出原因，而不是静默灰掉。
    expect(collider.parentElement.title).toContain('不可用');
    bound.dispose();
  });

  it('enables collider layer when collision capability is present', async () => {
    const { registry } = createDomStub();
    const world = await runtimeStub({ collision: true });
    const bound = bindDebugLayers(world, { log: () => {} });
    const collider = registry.find((input) => input.dataset.layer === 'collider');
    expect(collider.disabled).toBe(false);
    bound.dispose();
  });

  it('does not touch world state when no layer is enabled', async () => {
    createDomStub();
    const world = await runtimeStub();
    const bound = bindDebugLayers(world, { log: () => {} });
    const before = world.store.list().length;
    world.update();
    expect(world.updateCalls).toBe(1);
    expect(world.store.list().length).toBe(before);
    bound.dispose();
  });

  it('dispose detaches the overlay and clears the menu', async () => {
    const { menu } = createDomStub();
    const world = await runtimeStub();
    const bound = bindDebugLayers(world, { log: () => {} });
    expect(world.scene.children.length).toBeGreaterThan(0);
    bound.dispose();
    expect(world.scene.children.length).toBe(0);
    expect(menu.children.length).toBe(0);
  });
});
