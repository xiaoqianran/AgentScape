import * as THREE from "three";
import { AgentTools } from "../../../agent/AgentTools.js";
import { ToolCallingAgent } from "../../../agent/ToolCallingAgent.js";
import { SkillRegistry } from "../../../agent/skills/SkillRegistry.js";
import { registerGenerationSkills } from "../../../agent/skills/packs/generationSkills.js";
import { registerSceneSkills } from "../../../agent/skills/packs/sceneSkills.js";
import { registerInteractionSkills } from "../../../agent/skills/packs/interactionSkills.js";
import { registerSpatialSkills } from "../../../agent/skills/packs/spatialSkills.js";
import { PolicyEngine } from "../../../core/PolicyEngine.js";
import { TraceRecorder } from "../../../core/TraceRecorder.js";
import { assetAdmission } from "../../../asset/admission.js";
import { GenerationRuntime } from "../../../generation/orchestration/GenerationRuntime.js";
import { ConnectorClient } from "../../../generation/connector/ConnectorClient.js";
import { SceneGraph } from "../../../world/runtime/graph/SceneGraph.js";
import { NavigationSystem } from "../../../world/runtime/systems/NavigationSystem.js";
import { RecastNavigationBackend } from "../../../world/runtime/navigation/RecastNavigationBackend.js";
import { LocomotionSystem } from "../../../world/runtime/systems/LocomotionSystem.js";
import { InteractionScenarioContext } from "../interaction/InteractionScenarioContext.js";
import {
  FIXTURE_ASSET_ID,
  FIXTURE_INSTANCE_ID,
  FIXTURE_PROVIDER_ID,
  FixtureGenerationConnector
} from "./FixtureGenerationConnector.js";

const clone = (value) => value == null ? value : structuredClone(value);
if (!globalThis.ProgressEvent) {
  globalThis.ProgressEvent = class ProgressEvent {
    constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
  };
}
const EMBODIED_TOOLS = new Set(["approachAndPickup", "navigateTo", "approachAndPlace", "dropHeld"]);
const DEFAULT_CONNECTOR_ENDPOINT = "http://127.0.0.1:48123";
const CONNECTOR_SMOKE_TIMEOUT_MS = 2500;
const timedFetch = async (url, options = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONNECTOR_SMOKE_TIMEOUT_MS);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
};

export class GenerationAgentScenarioContext {
  constructor({ scene, backendId = "fixture" }) {
    this.scene = scene;
    this.backendId = backendId === "connector" ? "connector" : "fixture";
    this.world = new InteractionScenarioContext({ scene });
    this.toolCalls = [];
    this.sequenceEvents = [];
    this.gatewayRequests = [];
    this.gatewayResponses = [];
    this.agentLogs = [];
    this.lifecycle = [];
    this.lastTool = null;
    this.agentResult = null;
    this.transition = null;
  }

  async init() {
    await this.world.init();
    this.connector = this.backendId === "fixture"
      ? await FixtureGenerationConnector.create()
      : new ConnectorClient({ endpoint: DEFAULT_CONNECTOR_ENDPOINT, fetchImpl: timedFetch });
    this.trace = new TraceRecorder({ events: this.world.events });
    this.policy = new PolicyEngine();
    this.sceneGraph = new SceneGraph({ store: this.world.store, spatial: this.world.spatial, events: this.world.events });
    this.ground = new THREE.Mesh(
      new THREE.BoxGeometry(12, 0.2, 12),
      new THREE.MeshStandardMaterial({ color: 0x5f6876, roughness: 0.92, metalness: 0 })
    );
    this.ground.name = "GenerationObservatoryGround";
    this.ground.position.y = -0.1;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.ground.updateMatrixWorld(true);
    this.world.visuals.push(this.ground);
    this.navigation = new NavigationSystem({
      store: this.world.store,
      physics: this.world.physics,
      environmentRoots: [this.ground],
      events: this.world.events,
      backend: new RecastNavigationBackend()
    });
    this.locomotion = new LocomotionSystem({
      store: this.world.store,
      physics: this.world.physics,
      navigation: this.navigation,
      events: this.world.events
    });
    this.world.interaction.navigation = this.navigation;
    this.world.interaction.locomotion = this.locomotion;

    const runtime = {
      events: this.world.events,
      policy: this.policy,
      trace: this.trace,
      assetModule: this.world.assetModule,
      assets: this.world.assets,
      assetCatalog: this.world.assetModule.catalog,
      compiledAssetStore: this.world.assetModule.compiledStore,
      store: this.world.store,
      physics: this.world.physics,
      spatial: this.world.spatial,
      interactions: this.world.interaction,
      sceneGraph: this.sceneGraph,
      navigation: this.navigation,
      locomotion: this.locomotion,
      currentWorldRevision: null,
      listObjects: () => this.world.store.list().map(([id, record]) => ({
        id,
        asset: record.assetId,
        position: record.object.position.toArray().map((value) => Number(value.toFixed(3))),
        actions: [...record.manifest.actions]
      })),
      spawn: async (assetId, { position = [0, 0, 0], id } = {}) => {
        const instanceId = id || `${assetId}_${crypto.randomUUID()}`;
        await this.world.addAsset({ id: instanceId, assetId, position });
        this.navigation.invalidateIfStatic(this.world.store.get(instanceId), "generation.spawn");
        return instanceId;
      },
      mutate: async (label, operation) => {
        this.lifecycle.push({ stage: "mutation-started", label });
        const result = await operation();
        this.advanceFrames(24);
        this.sceneGraph.changed();
        this.lifecycle.push({ stage: "mutation-completed", label });
        return result;
      }
    };

    const generation = new GenerationRuntime({
      assetModule: runtime.assetModule,
      assetManager: runtime.assets,
      assetCatalog: runtime.assetCatalog,
      compiledAssetStore: runtime.compiledAssetStore,
      events: runtime.events,
      version: this.backendId === "fixture" ? "observatory-fixture-v1" : "observatory-connector-smoke-v1",
      connectorClient: this.connector
    });
    if (this.backendId === "fixture") {
      const snapshot = generation.capabilityAdapter.normalizeSnapshot(this.connector.capabilityPayload(), this.connector.session());
      generation.capabilityAdapter.applySnapshot(generation.providerRegistry, snapshot);
    }
    runtime.generation = generation;
    this.generation = generation;
    this.runtime = runtime;

    const registry = new SkillRegistry({ policy: this.policy, trace: this.trace, runtime });
    const add = (name, options, handler) => registry.register({ name, ...options, handler });
    registerGenerationSkills(add, runtime);
    registerSceneSkills(add, runtime);
    registerSpatialSkills(add, runtime);
    registerInteractionSkills(add, runtime);
    runtime.skills = registry;
    this.registry = registry;
    this.tools = new AgentTools(runtime, { profile: "builder", actor: "generation-agent" });

    for (const type of [
      "tool.called", "agent.sequence", "generation.job.submitted", "generation.artifact.imported",
      "assetCompiler.pass.started", "assetCompiler.pass.completed", "asset.registered", "interaction"
    ]) {
      this.world.events.on(type, (payload) => {
        this.lifecycle.push({ stage: type, payload: clone(payload) });
        if (type === "tool.called") this.toolCalls.push(clone(payload));
        if (type === "agent.sequence") this.sequenceEvents.push(clone(payload));
      });
    }
    return this;
  }

  async call(name, args = {}) {
    const started = performance.now();
    try {
      const result = await this.tools.call(name, args);
      const policy = this.tools.executionPolicy(name, result);
      this.lastTool = { name, args: clone(args), result: clone(result), policy, elapsedMs: performance.now() - started };
      return result;
    } catch (error) {
      this.lastTool = { name, args: clone(args), error: { message: error.message, code: error.code || null }, elapsedMs: performance.now() - started };
      throw error;
    }
  }

  advanceFrames(frames = 1) {
    for (let frame = 0; frame < frames; frame += 1) {
      this.locomotion?.update(1 / 60);
      this.world.physics.step(1 / 60, this.world.store);
      this.world.interaction.update(1 / 60, this.world.debugCamera);
    }
  }

  async drivePromise(promise, { maxFrames = 1800 } = {}) {
    let done = false;
    let value;
    let failure;
    promise.then((result) => { done = true; value = result; }, (error) => { done = true; failure = error; });
    for (let spin = 0; spin < 160 && !done && this.locomotion.tasks.size === 0 && this.world.interaction.settleTasks.size === 0; spin += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    for (let frame = 0; frame < maxFrames && !done; frame += 1) {
      this.advanceFrames(1);
      if (frame % 24 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      else await Promise.resolve();
    }
    await promise.catch(() => {});
    if (failure) throw failure;
    if (!done) throw new Error("Embodied Observatory tool did not settle");
    this.sceneGraph.changed();
    return value;
  }

  async callAndDriveSettle(name, args = {}, { frames = 24, maxFrames = 1800 } = {}) {
    const result = EMBODIED_TOOLS.has(name)
      ? await this.drivePromise(this.call(name, args), { maxFrames })
      : await this.call(name, args);
    this.advanceFrames(frames);
    this.sceneGraph.changed();
    return result;
  }

  createGateway(responses) {
    let index = 0;
    return {
      isConfigured: () => true,
      complete: async (request) => {
        this.gatewayRequests.push({
          round: index + 1,
          roles: request.messages.map((message) => message.role),
          toolCount: request.tools.length,
          context: clone(request.context)
        });
        const response = responses[index] || { message: "done", toolCalls: [] };
        index += 1;
        this.gatewayResponses.push(clone(response));
        return clone(response);
      }
    };
  }

  createOrchestratorTools() {
    return {
      runtime: this.runtime,
      definitions: () => this.tools.definitions(),
      executionPolicy: (name, result) => this.tools.executionPolicy(name, result),
      taskObservation: (state) => this.tools.taskObservation(state),
      recordSequence: (payload) => this.tools.recordSequence(payload),
      call: (name, args = {}, internalContext = {}) => {
        const promise = this.tools.call(name, args, internalContext);
        return EMBODIED_TOOLS.has(name) ? this.drivePromise(promise) : promise;
      }
    };
  }

  async runAgent(goal, responses, { maxSteps = 8 } = {}) {
    const agent = new ToolCallingAgent({
      tools: this.createOrchestratorTools(),
      gateway: this.createGateway(responses),
      maxSteps,
      log: (message, kind) => this.agentLogs.push({ message, kind })
    });
    this.agentResult = await agent.run(goal);
    return this.agentResult;
  }

  step() {
    this.advanceFrames(1);
    this.sceneGraph.invalidate();
  }

  generatedAssetState() {
    if (!this.runtime.assets.has(FIXTURE_ASSET_ID)) return null;
    const manifest = this.runtime.assets.getManifest(FIXTURE_ASSET_ID);
    return {
      id: manifest.id,
      type: manifest.type,
      actions: [...manifest.actions],
      compilerQuality: manifest.compiler?.quality?.status || null,
      admission: assetAdmission(manifest, { generated: true })
    };
  }

  debugSnapshot() {
    const artifacts = this.generation.artifactRegistry?.list?.() || [];
    const jobs = this.generation.listGenerationJobs?.().jobs || [];
    const generated = this.generatedAssetState();
    const relations = this.sceneGraph.list({ subject: FIXTURE_INSTANCE_ID });
    return {
      schemaVersion: 1,
      source: "generation-agent-build",
      definitions: this.tools.definitions(),
      lastTool: this.lastTool ? clone(this.lastTool) : null,
      toolCalls: this.toolCalls.map(clone),
      agent: this.agentResult ? clone(this.agentResult) : null,
      gateway: { requests: this.gatewayRequests.map(clone), responses: this.gatewayResponses.map(clone) },
      logs: this.agentLogs.map(clone),
      sequences: this.sequenceEvents.map(clone),
      lifecycle: this.lifecycle.map(clone),
      connector: {
        provider: FIXTURE_PROVIDER_ID,
        requests: this.connector.requests.map(clone)
      },
      generation: {
        jobs: jobs.map(clone),
        artifacts: artifacts.map((artifact) => ({
          id: artifact.id,
          role: artifact.role,
          mime: artifact.mime,
          bytes: artifact.bytes,
          hash: artifact.hash,
          integrity: artifact.integrity?.state || null,
          producer: clone(artifact.producer)
        })),
        asset: generated,
        instanceId: this.runtime.store.has(FIXTURE_INSTANCE_ID) ? FIXTURE_INSTANCE_ID : null,
        relations: relations.map(clone)
      },
      interaction: this.world.interaction.debugSnapshot(),
      navigation: this.navigation.debugSnapshot(),
      physics: this.world.physics.debugSnapshot({ nativeGeometry: false, contacts: true }),
      spatial: this.world.spatial.debugSnapshot()
    };
  }

  inspect() {
    const snapshot = this.debugSnapshot();
    const job = snapshot.generation.jobs.at(-1) || null;
    const artifact = snapshot.generation.artifacts.find((item) => item.id === "artifact_obs_red_apple") || null;
    const onTable = snapshot.generation.relations.some((edge) => edge.predicate === "ON" && edge.object === "table_01");
    return {
      title: "Generation / Agent Build",
      kind: "ToolCallingAgent → GenerationRuntime → Artifact → Compiler → World",
      values: {
        provider: snapshot.connector.provider,
        jobStatus: job?.status || null,
        artifactIntegrity: artifact?.integrity || null,
        assetId: snapshot.generation.asset?.id || null,
        assetAdmission: snapshot.generation.asset?.admission?.status || null,
        compilerQuality: snapshot.generation.asset?.compilerQuality || null,
        instanceId: snapshot.generation.instanceId,
        supportOn: onTable,
        taskStatus: snapshot.agent?.taskStatus || null,
        planningRounds: snapshot.gateway.requests.length,
        connectorRequests: snapshot.connector.requests.length
      }
    };
  }

  dispose() {
    this.locomotion?.cancelAll?.();
    this.navigation?.dispose?.();
    this.world.dispose();
  }
}

