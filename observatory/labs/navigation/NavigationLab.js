import * as THREE from "three";
import { SimulationClock } from "../../core/SimulationClock.js";
import { ScenarioRunner } from "../../core/ScenarioRunner.js";
import { FrameCadence } from "../../core/FrameCadence.js";
import { createObservatoryGrid, disposeObservatoryGrid } from "../../visual/ObservatoryGrid.js";
import { resizeObservatoryRenderer } from "../../visual/RendererQuality.js";
import { createObservatoryRenderSurface } from "../../visual/ObservatoryRenderSurface.js";
import { WorldLabelLayer, worldLabelsForNavigation } from "../../visual/WorldLabelLayer.js";
import { NavigationScenarioContext } from "./NavigationScenarioContext.js";
import { NavigationDebugRenderer } from "./visualizers/NavigationDebugRenderer.js";

export class NavigationLab {
  constructor({ viewport, onTelemetry, rendererMode = "auto", rendererTiming = false, onRendererFailure = null }) {
    this.viewport = viewport;
    this.onTelemetry = onTelemetry;
    this.rendererMode = rendererMode;
    this.rendererTiming = Boolean(rendererTiming);
    this.onRendererFailure = onRendererFailure;
    this.clock = new SimulationClock({ fixedDt: 1 / 60, maxSubSteps: 8 });
    this.checkpointFrame = null;
    this.cadence = new FrameCadence({ debugHz: 15, telemetryHz: 5 });

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.05, 200);
    this.camera.position.set(8, 6.5, 9);

    this.worldLabels = new WorldLabelLayer({ scene: this.scene, camera: this.camera, viewport });

    this.grid = createObservatoryGrid({ size: 32 });
    this.scene.add(this.grid);

    this.debugRenderer = new NavigationDebugRenderer(this.scene);
    this.runner = new ScenarioRunner({
      clock: this.clock,
      createContext: async () => new NavigationScenarioContext({ scene: this.scene }).init()
    });

  }

  async init() {
    Object.assign(this, await createObservatoryRenderSurface({
      viewport: this.viewport,
      scene: this.scene,
      camera: this.camera,
      rendererMode: this.rendererMode,
      rendererTiming: this.rendererTiming,
      onRendererFailure: this.onRendererFailure,
      controlsTarget: [0, 0.6, 0],
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
    if (scenario.id.includes("disconnected")) {
      position = [8, 6.8, 9.5];
      target = [0, 0.2, 0];
    } else if (scenario.id.includes("gap")) {
      position = [7.8, 6.2, 8.6];
      target = [0, 0.8, 0];
    } else {
      position = [7.5, 5.8, 8.5];
      target = [0, 0.2, 0];
    }
    this.cameraRig.moveTo(position, target);
  }

  focusScenario() {
    if (this.runner.scenario) this.fitScenario(this.runner.scenario);
  }

  setWorldLabelsVisible(visible) {
    this.worldLabels.setVisible(visible);
  }


  toggleRunning() {
    this.clock.toggle();
    this.emitTelemetry();
    return this.clock.running;
  }

  step(count = 1) {
    this.clock.pause();
    this.runner.step(count);
    this.refreshDebug();
    this.emitTelemetry();
  }

  async reset() {
    await this.runner.reset();
    this.refreshDebug();
    this.emitTelemetry();
  }

  captureCheckpoint() {
    this.checkpointFrame = this.clock.frame;
    this.emitTelemetry();
    return this.checkpointFrame;
  }

  async restoreCheckpoint() {
    if (!Number.isInteger(this.checkpointFrame) || this.checkpointFrame < 0) return null;
    const frame = this.checkpointFrame;
    this.clock.pause();
    await this.runner.replayTo(frame);
    this.refreshDebug();
    this.emitTelemetry();
    return frame;
  }

  setNavMeshDebug(visible) { this.debugRenderer.setNavMeshVisible(visible); }
  setPathDebug(visible) { this.debugRenderer.setPathVisible(visible); }
  setEndpointsDebug(visible) { this.debugRenderer.setEndpointsVisible(visible); }
  setObstaclesDebug(visible) { this.debugRenderer.setObstaclesVisible(visible); }
  setGridVisible(visible) {
    this.grid.visible = Boolean(visible);
  }

  refreshDebug({ force = false } = {}) {
    const context = this.runner.context;
    if (!context) return false;
    const revision = context.debugRevision ?? 0;
    if (!force && revision === this.lastDebugRevision) return false;
    const snapshot = context.debugSnapshot?.();
    this.lastDebugRevision = revision;
    this.lastDebugSnapshot = snapshot || null;
    this.worldLabels.setLabels(worldLabelsForNavigation(snapshot || null));
    this.debugRenderer.update(snapshot || null);
    return true;
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
        backend: snapshot.status?.backend?.identity || "unknown",
        state: snapshot.status?.state || "unknown",
        "nav triangles": snapshot.navMesh?.triangleCount ?? 0,
        reachable: snapshot.route?.reachable ?? "—",
        reason: snapshot.route?.reason || "—",
        waypoints: snapshot.route?.path?.length ?? 0,
        cost: snapshot.route?.cost ?? "—",
        "query time": `${context.lastStepMs.toFixed(3)} ms`
      }
    };
  }

  emitTelemetry() {
    const data = this.telemetry();
    if (data) this.onTelemetry?.(data);
  }

  frame(timestamp) {
    if (this.rendererState?.failed) return;
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
      viewport: this.viewport,
      pixelBudget: 600000
    });
    this.worldLabels.resize();
  }

  async dispose() {
    cancelAnimationFrame(this.animation);
    this.resizeObserver?.disconnect?.();
    await this.runner.dispose();
    this.debugRenderer.dispose();
    this.worldLabels.dispose();
    this.controls?.dispose?.();
    disposeObservatoryGrid(this.grid);
    this.renderer?.dispose?.();
    this.renderer?.domElement?.remove?.();
  }
}
