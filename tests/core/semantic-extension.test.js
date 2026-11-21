import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { attach } from '../../sdk/typescript/src/core.js';

function tinyGlb() {
  const json = JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Cabinet', children: [1] }, { name: 'Door_L' }]
  });
  const padded = Buffer.from(json + ' '.repeat((4 - Buffer.byteLength(json) % 4) % 4));
  const glb = Buffer.alloc(20 + padded.length);
  glb.writeUInt32LE(0x46546c67, 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(padded.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(glb, 20);
  return glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength);
}

describe('standalone Three.js semantic extension', () => {
  it('attaches directly without renderer, physics, task compiler, permissions or plugins', async () => {
    const scene = new THREE.Scene();
    const cube = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    cube.name = 'Cube';
    scene.add(cube);
    const originalParent = cube.parent, originalGeometry = cube.geometry;
    const originalMaterial = cube.material;
    const world = attach(scene);
    const value = { color: 'red', updated: 0 };
    const unregister = world.register(cube, {
      id: 'cube', type: 'custom-model', properties: { tags: ['my-shape'] },
      read: () => value,
      actions: { recolor: ({ color }) => { value.color = color; value.updated++; return value.color; } }
    });
    expect(world.scene).toBe(scene);
    expect(world.list()).toHaveLength(1);
    expect(world.inspect('cube')).toMatchObject({
      id: 'cube', name: 'Cube', type: 'custom-model', attached: true,
      state: { color: 'red', updated: 0 }, actions: [{ name: 'recolor', available: true }]
    });
    expect(await world.invoke('cube', 'recolor', { color: 'blue' })).toBe('blue');
    expect(world.inspect(cube).state.color).toBe('blue');
    expect(scene.children).toContain(cube);
    expect(cube.parent).toBe(originalParent);
    expect(cube.geometry).toBe(originalGeometry);
    expect(cube.material).toBe(originalMaterial);
    expect(unregister()).toBe(true);
    expect(world.list()).toHaveLength(0);
    world.dispose();
    expect(scene.children).toContain(cube);
    expect(() => world.register(cube)).toThrow('SEMANTIC_WORLD_DISPOSED');
    world.dispose();
  });

  it('registers and invokes semantic actions on nodes imported from a real GLB buffer', async () => {
    const gltf = await new GLTFLoader().parseAsync(tinyGlb(), '');
    const scene = new THREE.Scene();
    scene.add(gltf.scene);
    const door = gltf.scene.getObjectByName('Door_L');
    expect(door).toBeTruthy();
    const world = attach(scene);
    const off = world.register(door, {
      id: 'door-left',
      type: 'cabinet-door',
      label: 'Left door',
      description: 'A movable part of the imported cabinet',
      read: () => ({ angle: door.rotation.y }),
      actions: {
        open: () => { door.rotation.y = -Math.PI / 2; },
        close: () => { door.rotation.y = 0; }
      }
    });
    await world.invoke('door-left', 'open');
    expect(door.rotation.y).toBeCloseTo(-Math.PI / 2);
    expect(world.inspect('door-left').state.angle).toBeCloseTo(-Math.PI / 2);
    door.parent.remove(door);
    expect(world.inspect('door-left').attached).toBe(false);
    expect(world.list({ attachedOnly: true })).toHaveLength(0);
    gltf.scene.add(door);
    expect(world.inspect('door-left').attached).toBe(true);
    await world.invoke('door-left', 'close');
    expect(door.rotation.y).toBe(0);
    expect(off()).toBe(true);
    world.dispose();
  });

  it('supports arbitrary actions and optional plugins without changing core execution', async () => {
    const scene = new THREE.Scene(), object = new THREE.Group();
    scene.add(object);
    const world = attach(scene);
    world.register(object, { id: 'device', type: 'unknown-type' });
    const observed = [], dispose = vi.fn();
    const uninstall = world.use({
      install(runtime, options) {
        expect(options).toEqual({ name: 'observer' });
        const unsubscribe = runtime.subscribe(event => observed.push(event.type));
        return () => { unsubscribe(); dispose(); };
      }
    }, { name: 'observer' });
    const removeAction = world.registerAction('device', 'teleport-to-moon', {
      description: 'Custom action never predefined by AgentScape',
      available: () => true,
      execute: async (args, { object: target }) => {
        target.position.x = args.x;
        return { moved: true };
      }
    });
    expect(await world.invoke('device', 'teleport-to-moon', { x: 7 })).toEqual({ moved: true });
    expect(object.position.x).toBe(7);
    expect(observed).toContain('action.registered');
    expect(observed).toContain('action.invoked');
    expect(uninstall()).toBe(true);
    expect(uninstall()).toBe(false);
    expect(dispose).toHaveBeenCalledOnce();
    expect(removeAction()).toBe(true);
    expect(world.inspect('device').actions).toEqual([]);
    expect(scene.children).toContain(object);
    world.dispose();
  });

  it('rejects invalid registrations but does not impose an ontology or render-loop policy', async () => {
    const scene = new THREE.Scene(), mesh = new THREE.Mesh();
    scene.add(mesh);
    const world = attach(scene);
    expect(() => attach(new THREE.Group())).toThrow('attach(scene)');
    expect(() => world.register({})).toThrow('THREE.Object3D');
    const off = world.register(mesh, { id: 'arbitrary-item' });
    expect(() => world.register(mesh, { id: 'same-object' })).toThrow('SEMANTIC_ENTITY_CONFLICT');
    expect(() => world.register(new THREE.Group(), { id: 'arbitrary-item' })).toThrow('SEMANTIC_ENTITY_CONFLICT');
    expect(() => world.registerAction('arbitrary-item', 'broken', { description: 'No execute' })).toThrow('Action requires');
    await expect(world.invoke('arbitrary-item', 'unknown')).rejects.toThrow('SEMANTIC_ACTION_NOT_FOUND');
    expect(off()).toBe(true);
    expect(world.inspect('arbitrary-item')).toBeNull();
    world.dispose();
  });

  it('allows independent semantic registries on different scenes', () => {
    const first = new THREE.Scene(), second = new THREE.Scene();
    const a = new THREE.Mesh(), b = new THREE.Mesh();
    first.add(a); second.add(b);
    const wa = attach(first), wb = attach(second);
    wa.register(a, { id: 'same-id' });
    wb.register(b, { id: 'same-id' });
    wa.dispose();
    expect(wb.inspect('same-id').attached).toBe(true);
    wb.dispose();
  });
});
