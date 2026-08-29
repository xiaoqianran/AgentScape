import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/EventBus.js';
import { ObjectStore } from '../world/runtime/ObjectStore.js';
import { SpatialSystem } from '../world/runtime/systems/SpatialSystem.js';
import { createRapierPhysicsSystem } from './helpers/createRapierPhysicsSystem.js';
import { createRecastNavigationSystem } from './helpers/createRecastNavigationSystem.js';
import { LocomotionSystem } from '../world/runtime/systems/LocomotionSystem.js';
import { InteractionSystem } from '../world/runtime/systems/InteractionSystem.js';
import { SceneGraph } from '../world/runtime/graph/SceneGraph.js';
import { assetManifests } from '../asset/manifests/index.js';
import { DebugOverlay } from '../studio/debug/DebugOverlay.js';

const floorMesh = () => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(10, .2, 10));
  m.position.y = -.1; m.updateMatrixWorld(true); return m;
};

/** 与 agent-carry-e2e 同构：真实 Rapier + 真实 Three.Scene，仅不渲染像素。 */
async function setup({ withNav = true } = {}) {
  const store = new ObjectStore();
  const scene = new THREE.Scene();
  const ground = floorMesh();
  scene.add(ground);
  const physics = createRapierPhysicsSystem();
  await physics.init();
  physics.addEnvironment([{ shape: 'box', halfExtents: [5, .1, 5], translation: [0, -.1, 0] }]);

  const agent = new THREE.Group();
  agent.position.set(0, 0, 3);
  scene.add(agent); agent.updateMatrixWorld(true);
  const agentManifest = structuredClone(assetManifests.agent);
  store.add('agent_01', { id: 'agent_01', assetId: 'agent', object: agent, manifest: agentManifest, state: {} });
  physics.attach('agent_01', agentManifest, agent);

  const table = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.4, .16, 1.25));
  top.position.y = 1; table.add(top);
  table.position.set(0, 0, 0);
  scene.add(table); table.updateMatrixWorld(true);
  const tableManifest = structuredClone(assetManifests.table);
  store.add('table_01', { id: 'table_01', assetId: 'table', object: table, manifest: tableManifest, state: {} });
  physics.attach('table_01', tableManifest, table);

  const cup = new THREE.Group();
  const cupMesh = new THREE.Mesh(new THREE.CylinderGeometry(.15, .15, .32, 16));
  cupMesh.position.y = .16; cup.add(cupMesh);
  cup.position.set(0, 1.16, 0);
  scene.add(cup); cup.updateMatrixWorld(true);
  const cupManifest = structuredClone(assetManifests.cup);
  store.add('cup_01', { id: 'cup_01', assetId: 'cup', object: cup, manifest: cupManifest, state: {} });
  physics.attach('cup_01', cupManifest, cup);

  for (let i = 0; i < 120; i++) physics.step(1 / 60, store);

  const spatial = new SpatialSystem({ store, scene });
  const events = new EventBus();
  const navigation = withNav
    ? createRecastNavigationSystem({ store, physics, environmentRoots: [ground], events })
    : null;
  const locomotion = new LocomotionSystem({ store, physics, navigation, events });
  const interactions = new InteractionSystem({ store, physics, spatial, navigation, locomotion, events });
  const sceneGraph = new SceneGraph({ store, spatial, events });

  const runtime = {
    store, scene, physics, spatial, navigation, locomotion, interactions, sceneGraph,
    events, environment: { id: 'test-env' }
  };
  return { runtime, store, scene, physics, sceneGraph, interactions };
}

describe('DebugOverlay', () => {
  it('attaches to a runtime scene without mutating world state', async () => {
    const { runtime, store } = await setup();
    const before = store.list().map(([id]) => id).sort();
    const overlay = new DebugOverlay(runtime);
    overlay.attach();
    expect(runtime.scene.children).toContain(overlay.group);
    expect(store.list().map(([id]) => id).sort()).toEqual(before);
    overlay.dispose();
  });

  it('draws nothing until a layer is enabled', async () => {
    const { runtime } = await setup();
    const overlay = new DebugOverlay(runtime);
    overlay.attach();
    for (const group of overlay.layers.values()) expect(group.children.length).toBe(0);
    overlay.dispose();
  });

  it('renders collider wireframes from Manifest colliders with instance provenance', async () => {
    const { runtime } = await setup();
    const overlay = new DebugOverlay(runtime);
    overlay.attach();
    overlay.toggle('collider', true);
    const group = overlay.layers.get('collider');
    expect(group.children.length).toBeGreaterThan(0);
    // 每个线框都应能追溯到实例，而不是凭空画的装饰。
    for (const child of group.children) expect(child.userData.instanceId).toBeTruthy();
    overlay.dispose();
  });

  it('renders joint axes for articulated parts only', async () => {
    const { runtime, store, scene } = await setup();
    // 追加一个带 joint 的 cabinet，节点名必须匹配 Manifest 的 requiredNodes。
    const cabinet = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.64, 1.9, .78));
    body.name = 'Body'; body.position.y = .95; cabinet.add(body);
    const hinge = new THREE.Group(); hinge.name = 'doorHinge'; hinge.position.set(-.82, 1, .39);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(.81, .95, .04));
    leaf.name = 'Door'; leaf.position.x = .81;
    hinge.add(leaf); cabinet.add(hinge);
    cabinet.position.set(3, 0, 0); scene.add(cabinet); cabinet.updateMatrixWorld(true);
    const manifest = structuredClone(assetManifests.cabinet);
    store.add('cabinet_01', { id: 'cabinet_01', assetId: 'cabinet', object: cabinet, manifest, state: {} });

    const overlay = new DebugOverlay(runtime);
    overlay.attach();
    overlay.toggle('joint', true);
    const jointLines = overlay.layers.get('joint').children.filter(
      (child) => child.userData.partName
    );
    expect(jointLines.length).toBeGreaterThan(0);
    expect(jointLines.every((line) => line.userData.instanceId === 'cabinet_01')).toBe(true);
    overlay.dispose();
  });

  it('renders spatial relation edges from the SceneGraph', async () => {
    const { runtime, sceneGraph } = await setup();
    sceneGraph.update();
    sceneGraph.set('cup_01', 'ON', 'table_01', { surfaceId: 'top' });
    const overlay = new DebugOverlay(runtime);
    overlay.attach();
    overlay.toggle('relations', true);
    const group = overlay.layers.get('relations');
    expect(group.children.length).toBeGreaterThan(0);
    expect(group.children.some((line) => String(line.userData.relation).includes('ON'))).toBe(true);
    overlay.dispose();
  });

  it('survives dangling relations without throwing', async () => {
    const { runtime, sceneGraph } = await setup();
    sceneGraph.update();
    // 悬空关系：对象已移除但关系残留，图层必须跳过而不是抛错。
    sceneGraph.set('cup_01', 'ON', 'table_that_was_removed', {});
    sceneGraph.set('ghost_object', 'NEAR', 'cup_01', {});
    const overlay = new DebugOverlay(runtime);
    overlay.attach();
    expect(() => overlay.toggle('relations', true)).not.toThrow();
    // 只画两端都能解析的关系；悬空的一侧必须被跳过，不产生连线。
    const group = overlay.layers.get('relations');
    for (const edge of group.children) {
      expect(String(edge.userData.relation)).not.toContain('table_that_was_removed');
      expect(String(edge.userData.relation)).not.toContain('ghost_object');
    }
    overlay.dispose();
  });

  it('renders agent hold anchor and carry link only when an object is held', async () => {
    const { runtime, interactions } = await setup();
    const overlay = new DebugOverlay(runtime);
    overlay.attach();
    overlay.toggle('interaction', true);
    const group = overlay.layers.get('interaction');
    // 未持物时仍应画出 hold anchor 与交互距离圈，但不画 carry 连线。
    expect(group.children.some((child) => child.userData.carried === undefined)).toBe(true);
    const carryLinks = group.children.filter((child) => child.userData.carried);
    expect(carryLinks.length).toBe(0);
    overlay.dispose();
  });

  it('reports navmesh layer availability without depending on private nav internals', async () => {
    const { runtime } = await setup();
    const overlay = new DebugOverlay(runtime);
    overlay.attach();
    const available = overlay.availableLayers;
    expect(available.navmesh).toBe(true);
    expect(available.bounds).toBe(true);
    expect(available.relations).toBe(true);
    overlay.dispose();
  });

  it('disables collider layer when the physics backend lacks collision capability', async () => {
    const { runtime } = await setup();
    // 模拟无求解器 backend：capability 缺失时不得假装能画碰撞体。
    runtime.physics = { hasCapability: () => false, profile: () => ({ identity: 'transform' }) };
    const overlay = new DebugOverlay(runtime);
    overlay.attach();
    expect(overlay.availableLayers.collider).toBe(false);
    overlay.dispose();
  });

  it('rebuild is idempotent and does not leak objects between toggles', async () => {
    const { runtime } = await setup();
    const overlay = new DebugOverlay(runtime);
    overlay.attach();
    overlay.toggle('collider', true);
    const first = overlay.layers.get('collider').children.length;
    overlay.toggle('collider', true);
    overlay.rebuild('collider');
    const second = overlay.layers.get('collider').children.length;
    expect(second).toBe(first);
    overlay.dispose();
  });

  it('dispose detaches from the scene and clears all layers', async () => {
    const { runtime } = await setup();
    const overlay = new DebugOverlay(runtime);
    overlay.attach();
    overlay.toggle('collider', true);
    overlay.toggle('bounds', true);
    overlay.dispose();
    expect(runtime.scene.children).not.toContain(overlay.group);
    expect(overlay.layers.size).toBe(0);
  });
});
