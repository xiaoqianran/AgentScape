import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AgentTools } from '../../agent/AgentTools.js';
import { SkillRegistry } from '../../agent/skills/SkillRegistry.js';
import { registerCoreSkills } from '../../agent/skills/registerCoreSkills.js';
import { disposeObject3D } from '../../core/disposeObject3D.js';
import { createAssetModule } from '../../generation/orchestration/createAssetModule.js';
import { attachGenerationRuntime } from '../../generation/orchestration/GenerationRuntime.js';
import { ConnectorClient } from '../../generation/connector/ConnectorClient.js';
import { WorldRuntime } from '../../world/runtime/WorldRuntime.js';
import { SceneGraph } from '../../world/runtime/graph/SceneGraph.js';
import { RapierPhysicsBackend } from '../../world/runtime/physics/RapierPhysicsBackend.js';
import { InteractionSystem } from '../../world/runtime/systems/InteractionSystem.js';
import { PhysicsSystem } from '../../world/runtime/systems/PhysicsSystem.js';
import { SpatialSystem } from '../../world/runtime/systems/SpatialSystem.js';
import { makeGeneratedCupGlb } from '../fixtures/generatedCupGlb.js';
import { startModalGenConnector } from '../helpers/startModalGenConnector.js';

async function runtimeFixture() {
  const originalProgressEvent = globalThis.ProgressEvent;
  globalThis.ProgressEvent ||= class ProgressEvent {
    constructor(type, init = {}) {
      this.type = type;
      Object.assign(this, init);
    }
  };
  const connector = await startModalGenConnector({ glbBytes: await makeGeneratedCupGlb() });
  const httpCalls = [];
  const fetchImpl = async (input, options) => {
    httpCalls.push({ url: String(input), method: options?.method || 'GET' });
    return fetch(input, options);
  };
  const assetModule = createAssetModule();
  const runtime = new WorldRuntime({ appendChild() {} }, {
    environmentFactory: () => null,
    assetModule,
    physicsFactory: () => new PhysicsSystem({ backend: new RapierPhysicsBackend() })
  });
  runtime.scene = new THREE.Scene();
  await runtime.physics.init();
  runtime.physics.addFloor();
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(8, 0.2, 8),
    new THREE.MeshStandardMaterial({ color: 0x777777 })
  );
  floor.name = 'Floor';
  floor.position.y = -0.1;
  runtime.scene.add(floor);
  runtime.spatial = new SpatialSystem({ store: runtime.store, scene: runtime.scene });
  runtime.sceneGraph = new SceneGraph({
    store: runtime.store, spatial: runtime.spatial, events: runtime.events
  });
  runtime.interactions = new InteractionSystem({
    store: runtime.store,
    physics: runtime.physics,
    spatial: runtime.spatial,
    events: runtime.events
  });

  const connectorClient = new ConnectorClient({
    endpoint: connector.endpoint,
    origin: connector.origin,
    fetchImpl
  });
  const generation = attachGenerationRuntime(runtime, {
    connectorClient, compilerEndpoint: '', pollIntervalMs: 0
  });
  runtime.skills = registerCoreSkills(new SkillRegistry({
    policy: runtime.policy, trace: runtime.trace, runtime
  }), runtime);
  const tools = new AgentTools(runtime, {
    profile: 'builder', actor: 'agent_generated_cup_e2e'
  });

  return {
    runtime,
    generation,
    tools,
    connector,
    httpCalls,
    async dispose() {
      try {
        runtime.physics.dispose();
        disposeObject3D(runtime.scene);
        if (originalProgressEvent) globalThis.ProgressEvent = originalProgressEvent;
        else delete globalThis.ProgressEvent;
      } finally {
        await connector.dispose();
      }
    }
  };
}

describe('Browser Agent → Python modal-gen-client → WorldRuntime E2E', () => {
  it('generates cup.glb through the live Connector process, then spawns, places, and renders it', async () => {
    const { runtime, generation, tools, connector, httpCalls, dispose } = await runtimeFixture();
    try {
      const pending = await generation.initialize({ pair: true });
      expect(pending).toMatchObject({
        status: 'connection-required', reason: 'APPROVAL_REQUIRED'
      });
      await expect(connector.approve(pending.pairingId)).resolves.toMatchObject({ status: 'approved' });
      await expect(generation.initialize({
        pair: true, pairingId: pending.pairingId
      })).resolves.toMatchObject({ status: 'generation-ready', providers: 2 });

      await runtime.spawn('table', { id: 'table_01', position: [0, 0, 0] });
      const generated = await tools.call('generateAsset', { prompt: 'cup' });
      expect(generated).toMatchObject({
        id: 'generated_cup',
        type: 'cup',
        status: 'asset-provisional',
        generation: { route: { kind: 'text-image-3d' } }
      });
      expect(runtime.assets.getManifest('generated_cup')).toMatchObject({
        type: 'cup',
        source: { kind: 'compiled', key: 'generated_cup' },
        actions: expect.arrayContaining(['pickup', 'drop', 'place']),
        provenance: { assetProduction: { sourceArtifact: { producer: { provider: 'modal-3d' } } } }
      });

      await runtime.spawn('generated_cup', { id: 'cup_generated_01', position: [0, 1.8, 0] });
      const placed = runtime.interactions.place('cup_generated_01', 'table_01', {
        surfaceId: 'top', clearance: 0.03
      });
      expect(placed).toMatchObject({ id: 'cup_generated_01', targetId: 'table_01' });

      const cup = runtime.store.get('cup_generated_01');
      const support = runtime.spatial.supportStatus('cup_generated_01', 'table_01', {
        surfaceId: 'top'
      });
      const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.05, 20);
      camera.position.set(3, 2.4, 4);
      camera.lookAt(0, 1, 0);
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();
      const viewProjection = new THREE.Matrix4().multiplyMatrices(
        camera.projectionMatrix, camera.matrixWorldInverse
      );
      const frustum = new THREE.Frustum().setFromProjectionMatrix(viewProjection);
      expect(support).toMatchObject({ on: true, aboveSurface: true });
      expect(cup.object.parent).toBe(runtime.scene);
      expect(cup.object.visible).toBe(true);
      expect(cup.object.getObjectsByProperty('isMesh', true)).toHaveLength(3);
      expect(frustum.intersectsBox(new THREE.Box3().setFromObject(cup.object))).toBe(true);
      const paths = httpCalls.map(({ url }) => new URL(url).pathname);
      expect(paths).toEqual(expect.arrayContaining([
        '/connector/v1/session', '/connector/v1/capabilities', '/connector/v1/jobs'
      ]));
      expect(paths.some((path) => path.startsWith('/connector/v1/jobs/job_'))).toBe(true);
      expect(paths.filter((path) => path.startsWith('/connector/v1/artifacts/artifact_'))).toHaveLength(1);
      expect(connector.pid).toEqual(expect.any(Number));
    } finally {
      await dispose();
    }
  }, 45_000);
});
