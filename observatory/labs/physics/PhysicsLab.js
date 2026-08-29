import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { SimulationClock } from "../../core/SimulationClock.js";
import { ScenarioRunner } from "../../core/ScenarioRunner.js";
import { PhysicsScenarioContext } from "./PhysicsScenarioContext.js";
import { PhysicsDebugRenderer } from "./visualizers/PhysicsDebugRenderer.js";
import { NormalizedColliderRenderer } from "./visualizers/NormalizedColliderRenderer.js";
import { ManifestColliderRenderer } from "./visualizers/ManifestColliderRenderer.js";
import { ColliderDifferenceRenderer } from "./visualizers/ColliderDifferenceRenderer.js";
import { PhysicsVectorRenderer } from "./visualizers/PhysicsVectorRenderer.js";
import { createPhysicsBackend } from "./backends.js";

export class PhysicsLab {
  constructor({ viewport, onTelemetry, backendId = "rapier" }) {
    this.viewport = viewport;
    this.backendId = backendId;
    this.onTelemetry = onTelemetry;
    this.clock = new SimulationClock({ fixedDt: 1 / 60, maxSubSteps: 8 });
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x11161d);
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.05, 200);
    this.camera.position.set(7.5, 5.5, 8.5);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    viewport.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.4, 0);
    this.controls.enableDamping = true;

    this.grid = new THREE.GridHelper(12, 24, 0x566171, 0x2a323d);
    this.axes = new THREE.AxesHelper(1.25);
    this.axes.position.set(-5, 0.02, 3.5);
    this.scene.add(this.grid, this.axes);

    this.scene.add(new THREE.HemisphereLight(0xd8e6ff, 0x20252c, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(5, 9, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    this.scene.add(key);

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
      },
      onStep: () => this.refreshDebug()
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(viewport);
    this.resize();
    this.animation = requestAnimationFrame((timestamp) => this.frame(timestamp));
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
    if (scenario.id.includes("hinge")) {
      this.camera.position.set(5.8, 3.8, 6.8);
      this.controls.target.set(0, 1.1, 0);
    } else if (scenario.id.includes("stack")) {
      this.camera.position.set(7, 5.5, 8);
      this.controls.target.set(0, 2.2, 0);
    } else {
      this.camera.position.set(7, 4.8, 8);
      this.controls.target.set(0, 1.8, 0);
    }
    this.controls.update();
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
    this.grid.visible = visible;
    this.axes.visible = visible;
  }

  refreshDebug() {
    const context = this.runner.context;
    const snapshot = context?.debugSnapshot({ nativeGeometry:this.nativeDebugVisible });
    const manifestSnapshot = context?.manifestSnapshot?.() || null;
    this.lastDebugSnapshot = snapshot || null;
    this.lastManifestSnapshot = manifestSnapshot;
    this.lastTruthComparison = context?.truthComparison?.() || null;
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

  frame(timestamp) {
    const stepped = this.runner.tick(timestamp);
    if (stepped) {
      this.refreshDebug();
      this.emitTelemetry();
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.animation = requestAnimationFrame((next) => this.frame(next));
  }

  resize() {
    const width = Math.max(this.viewport.clientWidth, 1);
    const height = Math.max(this.viewport.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  async dispose() {
    cancelAnimationFrame(this.animation);
    this.resizeObserver.disconnect();
    await this.runner.dispose();
    this.debugRenderer.dispose();
    this.normalizedColliderRenderer.dispose();
    this.manifestColliderRenderer.dispose();
    this.colliderDifferenceRenderer.dispose();
    this.vectorRenderer.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
