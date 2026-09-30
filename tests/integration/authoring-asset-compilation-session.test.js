import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSession } from '../../application/createSession.js';
import { AgentTools } from '../../application/AgentTools.js';
import { CommandHistory } from '../../modules/world/runtime/CommandHistory.js';
import { createRapierPhysicsSystem } from '../helpers/createRapierPhysicsSystem.js';
import { createRecastNavigationSystem } from '../helpers/createRecastNavigationSystem.js';

const cleanup = [];
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose(); vi.unstubAllGlobals(); });

// GLTFExporter uses browser FileReader, with real Blob bytes in this headless test.
function fileReader() {
  vi.stubGlobal('FileReader', class {
    readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }); }
    readAsDataURL(blob) { blob.arrayBuffer().then(result => { this.result = `data:${blob.type};base64,${Buffer.from(result).toString('base64')}`; this.onloadend?.(); }); }
  });
  vi.stubGlobal('ProgressEvent', class {});
}

const AGENT_BOX_CODE = `
const box = new THREE.Mesh(
  new THREE.BoxGeometry(0.8, 1.2, 0.8),
  new THREE.MeshStandardMaterial({ color: 0x4488ff })
);
box.name = 'agent-box';
box.userData.authoringId = 'agent-box';
box.position.set(1.5, 0.9, -0.5);
scene.add(box);
`;

async function fixture() {
  fileReader();
  const physics = createRapierPhysicsSystem();
  await physics.init();
  cleanup.push(() => physics.dispose());
  const viewport = { appendChild: vi.fn(), clientWidth: 960, clientHeight: 540 };
  const { world, generation, authoring, promotion } = createSession(viewport, {
    environmentFactory: () => null,
    physicsFactory: () => physics
  });
  cleanup.push(() => promotion.dispose());
  cleanup.push(() => authoring.dispose());
  const ground = new THREE.Mesh(new THREE.BoxGeometry(30, .1, 30), new THREE.MeshStandardMaterial());
  ground.position.y = -.05;
  world.environment = { id: 'agent-compiled-session', root: ground, colliders: [] };
  world.navigation = createRecastNavigationSystem({ store: world.store, physics, environmentRoots: [ground] });
  cleanup.push(() => world.navigation.dispose());
  world.locomotion = { cancel: vi.fn(), cancelAll: vi.fn() };
  world.interactions = { cancelPending: vi.fn(), beforeRemove: vi.fn(), rebuildHeldOwnership: vi.fn() };
  world.sceneGraph = { batch: async fn => fn(), changed: vi.fn(), update: vi.fn(), list: () => [], removeObject: vi.fn() };
  world.history = new CommandHistory({ apply: scene => world.restore(scene), events: world.events });
  const tools = new AgentTools(world, { actor: 'agent' });
  return { world, generation, authoring, promotion, tools };
}

describe('Agent-written three.js compiled as a world asset through createSession', () => {
  it('runs authoring code, compiles a verified artifact + asset, and promotes a physics-registered world entity', async () => {
    const { world, generation, authoring, tools } = await fixture();

    const run = await tools.call('runAuthoringCode', { code: AGENT_BOX_CODE, label: 'agent box' });
    expect(run.status).toBe('authoring-code-applied');
    expect(run.revision).toMatchObject({ created: true, revision: expect.objectContaining({ source: 'agent-code' }) });

    const prepared = await tools.call('prepareAuthoringAsset', { nodeId: 'agent-box', usage: 'movable' });
    expect(prepared.status).toBe('authoring-prepared');
    expect(prepared.assetId).toMatch(/^authored_/);
    // Documented gate: coarse collider + low-confidence semantics keep authored assets provisional.
    expect(prepared.admission.status).toBe('provisional');

    const artifacts = generation.artifacts.registry.list();
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].mime).toBe('model/gltf-binary');
    expect(artifacts[0].integrity.state).toBe('verified');
    expect(artifacts[0].producer.operation).toBe('authoring.export.glb.v1');

    const manifest = world.assetModule.getManifest(prepared.assetId);
    expect(manifest.compiler.normalization.preservedOrigin).toBe(true);
    expect(manifest.physics.body).toBe('dynamic');
    expect(manifest.actions).toContain('pickup');

    await expect(tools.call('promoteAuthoringNode', { nodeId: 'agent-box', usage: 'movable' }))
      .rejects.toMatchObject({ code: 'AUTHORING_ASSET_PROVISIONAL' });
    expect(world.store.list()).toHaveLength(0);

    const promoted = await tools.call('promoteAuthoringNode', { nodeId: 'agent-box', usage: 'movable', allowProvisional: true });
    expect(promoted.status).toBe('authoring-provisional');
    expect(world.store.has(promoted.entityId)).toBe(true);
    const position = world.physics.getPosition(promoted.entityId);
    expect(position[0]).toBeCloseTo(1.5, 5);
    expect(position[1]).toBeCloseTo(0.9, 5);
    expect(position[2]).toBeCloseTo(-0.5, 5);
    expect(promoted.verification.physics.registered).toBe(true);
    expect(promoted.verification.navigation.success).toBe(true);

    expect(authoring.get('agent-box').visible).toBe(false);
    expect(world.snapshot().objects[0].state.authoringPromotion.nodeId).toBe('agent-box');

    const rechecked = await tools.call('verifyAuthoringEntity', { nodeId: 'agent-box' });
    expect(rechecked.status).toBe('authoring-unverified');
    expect(rechecked.verification.physics.placement.clear).toBe(true);
    expect(rechecked.verification.navigation.success).toBe(true);
  });

  it('keeps forbidden ambient APIs out of the draft through the session skill gates', async () => {
    const { authoring, tools } = await fixture();
    const result = await tools.call('runAuthoringCode', { code: 'fetch("/models/leak.glb")', label: 'leak' });
    expect(result).toMatchObject({ status: 'authoring-code-rejected', reason: 'AUTHORING_CODE_FORBIDDEN_API' });
    expect(authoring.scene.children).toHaveLength(0);
  });

  it('restores the exact draft baseline when agent code throws mid-build', async () => {
    const { authoring, tools } = await fixture();
    const baseline = authoring.export();
    const result = await tools.call('runAuthoringCode', {
      code: 'scene.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial({}))); nope();',
      label: 'broken'
    });
    expect(result.status).toBe('authoring-code-failed');
    expect(result.reason).toBe('AUTHORING_CODE_EXECUTION_ERROR');
    expect(authoring.export()).toEqual(baseline);
  });
});
