import * as THREE from "three";
import { SimulationClock } from "../../core/SimulationClock.js";
import { ScenarioRunner } from "../../core/ScenarioRunner.js";
import { FrameCadence } from "../../core/FrameCadence.js";
import { createObservatoryGrid, disposeObservatoryGrid } from "../../visual/ObservatoryGrid.js";
import { resizeObservatoryRenderer } from "../../visual/RendererQuality.js";
import { createObservatoryRenderSurface } from "../../visual/ObservatoryRenderSurface.js";
import { WorldLabelLayer, worldLabelsForSpatial } from "../../visual/WorldLabelLayer.js";
import { SpatialScenarioContext } from "./SpatialScenarioContext.js";
import { SpatialDebugRenderer } from "./visualizers/SpatialDebugRenderer.js";

export class SpatialLab {
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
    this.camera.position.set(7, 5.5, 8);

    this.worldLabels = new WorldLabelLayer({ scene: this.scene, camera: this.camera, viewport });

    this.grid = createObservatoryGrid({ size: 24 });
    this.scene.add(this.grid);

    this.debugRenderer = new SpatialDebugRenderer(this.scene);
    this.runner = new ScenarioRunner({
      clock: this.clock,
      createContext: async () => new SpatialScenarioContext({ scene: this.scene }).init()
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
      controlsTarget: [0, 1.2, 0],
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
      position = [4.5, 4.2, 8.5];
      target = [0.5, 0.7, 0];
    } else if (scenario.id.includes("support")) {
      position = [5.5, 4.5, 6.5];
      target = [0, 1.1, 0];
    } else {
      position = [5.5, 4, 6.5];
      target = [0.8, 0.7, 0];
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

  setBoundsDebug(visible) { this.debugRenderer.setBoundsVisible(visible); }
  setRayDebug(visible) { this.debugRenderer.setRayVisible(visible); }
  setSpatialQueryDebug(visible) { this.debugRenderer.setQueryVisible(visible); }
  setGridVisible(visible) {
    this.grid.visible = Boolean(visible);
  }

  refreshDebug() {
    const snapshot = this.runner.context?.debugSnapshot?.();
    this.lastDebugSnapshot = snapshot || null;
    this.worldLabels.setLabels(worldLabelsForSpatial(snapshot || null));
    this.debugRenderer.update(snapshot || null);
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
      inspector: context.inspect(scenario.inspect),
      assertions: this.runner.assertions(),
      metrics: {
        backend: snapshot.bvh?.raycast || "unknown",
        objects: snapshot.metrics?.objectCount ?? 0,
        overlaps: snapshot.metrics?.collisionPairCount ?? 0,
        "ray hits": snapshot.ray?.hits?.length ?? 0,
        "free space": snapshot.freeSpace?.point ? snapshot.freeSpace.point.map((value) => Number(value.toFixed(3))).join(", ") : "—",
        "fixed dt": `${(this.clock.fixedDt * 1000).toFixed(3)} ms`
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
      viewport: this.viewport
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
