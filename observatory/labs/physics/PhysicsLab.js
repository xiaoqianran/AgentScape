import * as THREE from "three";
import { SimulationClock } from "../../core/SimulationClock.js";
import { ScenarioRunner } from "../../core/ScenarioRunner.js";
import { FrameCadence } from "../../core/FrameCadence.js";
import { createObservatoryGrid, disposeObservatoryGrid } from "../../visual/ObservatoryGrid.js";
import { resizeObservatoryRenderer } from "../../visual/RendererQuality.js";
import { createObservatoryRenderSurface } from "../../visual/ObservatoryRenderSurface.js";
import { WorldLabelLayer, worldLabelsForPhysics } from "../../visual/WorldLabelLayer.js";
import { PhysicsScenarioContext } from "./PhysicsScenarioContext.js";
import { compareManifestToPhysics } from "./ManifestColliderSnapshot.js";
import { PhysicsDebugRenderer } from "./visualizers/PhysicsDebugRenderer.js";
import { NormalizedColliderRenderer } from "./visualizers/NormalizedColliderRenderer.js";
import { ManifestColliderRenderer } from "./visualizers/ManifestColliderRenderer.js";
import { ColliderDifferenceRenderer } from "./visualizers/ColliderDifferenceRenderer.js";
import { PhysicsVectorRenderer } from "./visualizers/PhysicsVectorRenderer.js";
import { createPhysicsBackend } from "./backends.js";

export class PhysicsLab {
  constructor({ viewport, onTelemetry, backendId = "rapier", autoAnimate = true, rendererMode = "auto", rendererTiming = false }) {
    this.viewport = viewport;
    this.backendId = backendId;
    this.onTelemetry = onTelemetry;
    this.rendererMode = rendererMode;
    this.rendererTiming = Boolean(rendererTiming);
    this.autoAnimate = autoAnimate;
    this.cadence = new FrameCadence({ debugHz: 15, telemetryHz: 5 });
    this.clock = new SimulationClock({ fixedDt: 1 / 60, maxSubSteps: 8 });
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.05, 200);
    this.camera.position.set(7.5, 5.5, 8.5);

    this.worldLabels = new WorldLabelLayer({ scene: this.scene, camera: this.camera, viewport });

    this.grid = createObservatoryGrid({ size: 24 });
    this.scene.add(this.grid);


    this.debugRenderer = new PhysicsDebugRenderer(this.scene);
    this.normalizedColliderRenderer = new NormalizedColliderRenderer(this.scene);
    this.manifestColliderRenderer = new ManifestColliderRenderer(this.scene);
    this.colliderDifferenceRenderer = new ColliderDifferenceRenderer(this.scene);
    this.vectorRenderer = new PhysicsVectorRenderer(this.scene);
    this.checkpointFrame = null;
    this.nativeDebugVisible = true;
    this.normalizedDebugVisible = true;
    this.manifestDebugVisible = true;
    this.differenceDebugVisible = true;
    this.velocityDebugVisible = true;
    this.jointDebugVisible = true;
    this.contactDebugVisible = true;
    this.runner = new ScenarioRunner({
      clock: this.clock,
      createContext: async () => {
        const backend = await createPhysicsBackend(this.backendId);
        return new PhysicsScenarioContext({ scene: this.scene, backend }).init();
      }
    });

  }

  async init() {
    Object.assign(this, await createObservatoryRenderSurface({
      viewport: this.viewport,
      scene: this.scene,
      camera: this.camera,
      rendererMode: this.rendererMode,
      rendererTiming: this.rendererTiming,
      controlsTarget: [0, 1.4, 0],
      shadowType: THREE.PCFSoftShadowMap,
    }));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.viewport);
    this.resize();
    this.animation = this.autoAnimate ? requestAnimationFrame((timestamp) => this.frame(timestamp)) : null;
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
    if (scenario.id.includes("hinge")) {
      position = [5.8, 3.8, 6.8];
      target = [0, 1.1, 0];
    } else if (scenario.id.includes("stack")) {
      position = [7, 5.5, 8];
      target = [0, 2.2, 0];
    } else {
      position = [7, 4.8, 8];
      target = [0, 1.8, 0];
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

  setNativeDebug(visible) {
    this.nativeDebugVisible = visible;
    this.debugRenderer.setVisible(visible);
    this.refreshDebug();
  }

  setDifferenceDebug(visible) {
    this.differenceDebugVisible = Boolean(visible);
    this.colliderDifferenceRenderer.setVisible(visible);
    this.refreshDebug();
  }

  setManifestDebug(visible) {
    this.manifestDebugVisible = Boolean(visible);
    this.manifestColliderRenderer.setVisible(visible);
    this.refreshDebug();
  }

  setNormalizedDebug(visible) {
    this.normalizedDebugVisible = Boolean(visible);
    this.normalizedColliderRenderer.setVisible(visible);
    this.refreshDebug();
  }

  setVelocityDebug(visible) {
    this.velocityDebugVisible = Boolean(visible);
    this.vectorRenderer.setVelocityVisible(visible);
    this.refreshDebug();
  }

  setJointDebug(visible) {
    this.jointDebugVisible = Boolean(visible);
    this.vectorRenderer.setJointVisible(visible);
    this.refreshDebug();
  }

  setContactDebug(visible) {
    this.contactDebugVisible = Boolean(visible);
    this.vectorRenderer.setContactVisible(visible);
    this.refreshDebug();
  }

  setGridVisible(visible) {
    this.grid.visible = Boolean(visible);
  }

  refreshDebug() {
    const context = this.runner.context;
    const snapshot = context?.debugSnapshot({ nativeGeometry:this.nativeDebugVisible, contacts:this.contactDebugVisible });
    const manifestSnapshot = context?.manifestSnapshot?.() || null;
    this.lastDebugSnapshot = snapshot || null;
    this.worldLabels.setLabels(worldLabelsForPhysics(snapshot || null));
    this.lastManifestSnapshot = manifestSnapshot;
    this.lastTruthComparison = snapshot && manifestSnapshot ? compareManifestToPhysics(manifestSnapshot, snapshot) : null;
    if (this.nativeDebugVisible) this.debugRenderer.update(snapshot?.nativeGeometry || null);
    if (this.normalizedDebugVisible) this.normalizedColliderRenderer.update(snapshot || null);
    if (this.manifestDebugVisible) this.manifestColliderRenderer.update(manifestSnapshot);
    if (this.differenceDebugVisible) this.colliderDifferenceRenderer.update(this.lastTruthComparison);
    this.vectorRenderer.update(snapshot || null);
  }

  telemetry() {
    const scenario = this.runner.scenario;
    const context = this.runner.context;
    if (!scenario || !context) return null;
    const profile = context.profile();
    return {
      scenario,
      clock: this.clock,
      checkpointFrame: this.checkpointFrame,
      inspector: context.inspect(scenario.inspect),
      assertions: this.runner.assertions(),
      metrics: {
        "physics.step": `${context.lastStepMs.toFixed(3)} ms`,
        backend: profile.identity,
        solver: profile.solverEnabled ? "enabled" : "disabled",
        "native debug": this.lastDebugSnapshot?.nativeGeometryAvailable ? "available" : "unavailable",
        bodies: this.lastDebugSnapshot?.metrics?.bodyCount ?? 0,
        colliders: this.lastDebugSnapshot?.metrics?.colliderCount ?? 0,
        joints: this.lastDebugSnapshot?.metrics?.jointCount ?? 0,
        contacts: this.lastDebugSnapshot?.metrics?.contactPairCount ?? 0,
        "manifest colliders": this.lastManifestSnapshot?.colliders?.length ?? 0,
        "manifest→physics pos Δ": this.lastTruthComparison?.summary?.maxPositionDelta?.toExponential?.(2) ?? "—",
        "manifest→physics rot Δ": this.lastTruthComparison?.summary?.maxRotationDelta?.toExponential?.(2) ?? "—",
        "manifest→physics shape Δ": this.lastTruthComparison?.summary?.maxShapeDelta?.toExponential?.(2) ?? "—",
        "manifest missing": this.lastTruthComparison?.summary?.missingCount ?? 0,
        "manifest shape mismatch": this.lastTruthComparison?.summary?.shapeMismatchCount ?? 0,
        entities: context.entities.size,
        "fixed dt": `${(this.clock.fixedDt * 1000).toFixed(3)} ms`
      }
    };
  }

  emitTelemetry() {
    const data = this.telemetry();
    if (data) this.onTelemetry?.(data);
  }

  renderFrame(timestamp = performance.now()) {
    const cameraMoving = this.cameraRig.update(timestamp);
    if (!cameraMoving) this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.rendererProbe?.afterRender(timestamp);
    this.worldLabels.render();
  }

  frame(timestamp) {
    const stepped = this.runner.tick(timestamp);
    if (stepped && this.cadence.shouldDebug(timestamp)) this.refreshDebug();
    if ((stepped || this.rendererTiming) && this.cadence.shouldTelemetry(timestamp)) this.emitTelemetry();
    this.renderFrame(timestamp);
    if (this.autoAnimate) this.animation = requestAnimationFrame((next) => this.frame(next));
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
    if (this.animation != null) cancelAnimationFrame(this.animation);
    this.resizeObserver?.disconnect?.();
    await this.runner.dispose();
    this.debugRenderer.dispose();
    this.normalizedColliderRenderer.dispose();
    this.manifestColliderRenderer.dispose();
    this.colliderDifferenceRenderer.dispose();
    this.vectorRenderer.dispose();
    this.worldLabels.dispose();
    this.controls?.dispose?.();
    disposeObservatoryGrid(this.grid);
    this.renderer?.dispose?.();
    this.renderer?.domElement?.remove?.();
  }
}
