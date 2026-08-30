import * as THREE from "three";
import { SimulationClock } from "../../core/SimulationClock.js";
import { ScenarioRunner } from "../../core/ScenarioRunner.js";
import { FrameCadence } from "../../core/FrameCadence.js";
import { createObservatoryGrid, disposeObservatoryGrid } from "../../visual/ObservatoryGrid.js";
import { resizeObservatoryRenderer } from "../../visual/RendererQuality.js";
import { createObservatoryRenderSurface } from "../../visual/ObservatoryRenderSurface.js";
import { WorldLabelLayer, worldLabelsForAgent } from "../../visual/WorldLabelLayer.js";
import { AgentToolsScenarioContext } from "./AgentToolsScenarioContext.js";
import { AgentToolsDebugRenderer } from "./visualizers/AgentToolsDebugRenderer.js";
import { NormalizedColliderRenderer } from "../physics/visualizers/NormalizedColliderRenderer.js";

export class AgentToolsLab {
  constructor({ viewport, onTelemetry, contextFactory = null, contextOptions = {}, rendererMode = "auto", rendererTiming = false }) {
    this.viewport = viewport;
    this.onTelemetry = onTelemetry;
    this.rendererMode = rendererMode;
    this.rendererTiming = Boolean(rendererTiming);
    this.clock = new SimulationClock({ fixedDt: 1 / 60, maxSubSteps: 8 });
    this.checkpointFrame = null;
    this.cadence = new FrameCadence({ debugHz: 15, telemetryHz: 5 });
    this.contextFactory = contextFactory || ((options) => new AgentToolsScenarioContext(options));
    this.contextOptions = { ...contextOptions };

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.05, 200);
    this.camera.position.set(6, 4.6, 7);

    this.worldLabels = new WorldLabelLayer({ scene: this.scene, camera: this.camera, viewport });

    this.grid = createObservatoryGrid({ size: 24 });
    this.scene.add(this.grid);

    this.debugRenderer = new AgentToolsDebugRenderer(this.scene);
    this.colliderRenderer = new NormalizedColliderRenderer(this.scene);
    this.runner = new ScenarioRunner({
      clock: this.clock,
      createContext: async () => this.contextFactory({ scene: this.scene, ...this.contextOptions }).init()
    });

  }

  async init() {
    Object.assign(this, await createObservatoryRenderSurface({
      viewport: this.viewport,
      scene: this.scene,
      camera: this.camera,
      rendererMode: this.rendererMode,
      rendererTiming: this.rendererTiming,
      controlsTarget: [0, 0.8, 0],
    }));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.viewport);
    this.resize();
    this.animation = requestAnimationFrame((timestamp) => this.frame(timestamp));
    return this;
  }

  async load(scenario) {
    this.checkpointFrame = null;
    this.clock.pause();
    await this.runner.load(scenario);
    this.fitScenario(scenario);
    this.refreshDebug();
    this.emitTelemetry();
  }

  fitScenario(scenario) {
    let position;
    let target;
    if (scenario.id.includes("raycast")) {
      position = [4.5, 3.6, 7.5];
      target = [0, 0.5, 0];
    } else if (scenario.id.includes("free-space")) {
      position = [5.8, 4.8, 6.8];
      target = [0, 0.8, 0];
    } else {
      position = [5.5, 4.5, 6.5];
      target = [0, 0.7, 0];
    }
    this.cameraRig.moveTo(position, target);
  }

  focusScenario() {
    if (this.runner.scenario) this.fitScenario(this.runner.scenario);
  }

  setWorldLabelsVisible(visible) {
    this.worldLabels.setVisible(visible);
  }


  toggleRunning() { this.clock.toggle(); this.emitTelemetry(); return this.clock.running; }
  step(count = 1) { this.clock.pause(); this.runner.step(count); this.refreshDebug(); this.emitTelemetry(); }
  async reset() { await this.runner.reset(); this.refreshDebug(); this.emitTelemetry(); }
  captureCheckpoint() { this.checkpointFrame = this.clock.frame; this.emitTelemetry(); return this.checkpointFrame; }
  async restoreCheckpoint() {
    if (!Number.isInteger(this.checkpointFrame) || this.checkpointFrame < 0) return null;
    const frame = this.checkpointFrame;
    this.clock.pause();
    await this.runner.replayTo(frame);
    this.refreshDebug();
    this.emitTelemetry();
    return frame;
  }

  setAgentToolDebug(visible) { this.debugRenderer.setVisible(visible); }
  setNormalizedDebug(visible) { this.colliderRenderer.setVisible(visible); }
  setGridVisible(visible) { this.grid.visible = Boolean(visible); }

  toolDefinitions() {
    return this.runner.context?.tools?.definitions?.() || [];
  }

  suggestedToolName() {
    return this.lastDebugSnapshot?.lastTool?.name || null;
  }

  async invokeTool(name, args = {}) {
    const context = this.runner.context;
    if (!context) throw new Error("工具运行时尚未准备完成");
    const started = performance.now();
    const result = await context.callAndDriveSettle(name, args);
    const policy = context.tools.executionPolicy(name, result);
    this.refreshDebug();
    this.emitTelemetry();
    return { result, policy, elapsedMs: performance.now() - started };
  }

  refreshDebug() {
    const snapshot = this.runner.context?.debugSnapshot?.();
    this.lastDebugSnapshot = snapshot || null;
    this.worldLabels.setLabels(worldLabelsForAgent(snapshot || null));
    this.debugRenderer.update(snapshot || null);
    this.colliderRenderer.update(snapshot?.physics || null);
  }

  telemetry() {
    const scenario = this.runner.scenario;
    const context = this.runner.context;
    if (!scenario || !context) return null;
    const snapshot = this.lastDebugSnapshot || context.debugSnapshot();
    return {
      scenario,
      clock: this.clock,
      checkpointFrame: this.checkpointFrame,
      inspector: context.inspect(),
      assertions: this.runner.assertions(),
      metrics: {
        backend: snapshot.agent ? "ToolCallingAgent + AgentTools" : "AgentTools + domain skills",
        definitions: snapshot.definitions?.length ?? 0,
        tool: snapshot.lastTool?.name || "—",
        outcome: snapshot.lastTool?.policy?.outcome?.state || "—",
        verified: snapshot.lastTool?.policy?.outcome?.verified ?? "—",
        "tool.called": snapshot.toolCalls?.length ?? 0,
        "elapsed": snapshot.lastTool?.elapsedMs ? `${snapshot.lastTool.elapsedMs.toFixed(3)} ms` : "—",
        ...(snapshot.agent ? {
          "task status": snapshot.agent.taskStatus,
          "planning steps": snapshot.agent.steps,
          "gateway rounds": snapshot.gateway?.requests?.length ?? 0,
          "sequence events": snapshot.sequences?.length ?? 0
        } : {})
      }
    };
  }

  emitTelemetry() { const data = this.telemetry(); if (data) this.onTelemetry?.(data); }
  frame(timestamp) {
    const stepped = this.runner.tick(timestamp);
    if (stepped && this.cadence.shouldDebug(timestamp)) this.refreshDebug();
    if ((stepped || this.rendererTiming) && this.cadence.shouldTelemetry(timestamp)) this.emitTelemetry();
    const cameraMoving = this.cameraRig.update(timestamp);
    if (!cameraMoving) this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.rendererProbe?.afterRender(timestamp);
    this.worldLabels.render();
    this.animation = requestAnimationFrame((next) => this.frame(next));
  }
  resize() {
    this.renderQuality = resizeObservatoryRenderer({
      renderer: this.renderer,
      camera: this.camera,
      viewport: this.viewport
    });
    this.worldLabels.resize();
  }
  async dispose() {
    cancelAnimationFrame(this.animation);
    this.resizeObserver?.disconnect?.();
    await this.runner.dispose();
    this.debugRenderer.dispose();
    this.colliderRenderer.dispose();
    this.worldLabels.dispose();
    this.controls?.dispose?.();
    disposeObservatoryGrid(this.grid);
    this.renderer?.dispose?.();
    this.renderer?.domElement?.remove?.();
  }
}
