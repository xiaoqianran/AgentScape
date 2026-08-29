import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { SimulationClock } from "../../core/SimulationClock.js";
import { ScenarioRunner } from "../../core/ScenarioRunner.js";
import { FrameCadence } from "../../core/FrameCadence.js";
import { NavigationScenarioContext } from "./NavigationScenarioContext.js";
import { NavigationDebugRenderer } from "./visualizers/NavigationDebugRenderer.js";

export class NavigationLab {
  constructor({ viewport, onTelemetry }) {
    this.viewport = viewport;
    this.onTelemetry = onTelemetry;
    this.clock = new SimulationClock({ fixedDt: 1 / 60, maxSubSteps: 8 });
    this.checkpointFrame = null;
    this.cadence = new FrameCadence({ debugHz: 15, telemetryHz: 5 });

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x11161d);
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.05, 200);
    this.camera.position.set(8, 6.5, 9);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    viewport.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.6, 0);
    this.controls.enableDamping = true;

    this.grid = new THREE.GridHelper(14, 28, 0x566171, 0x2a323d);
    this.axes = new THREE.AxesHelper(1.25);
    this.axes.position.set(-6, 0.02, 4.5);
    this.scene.add(this.grid, this.axes);
    this.scene.add(new THREE.HemisphereLight(0xd8e6ff, 0x20252c, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 3);
    key.position.set(5, 9, 4);
    key.castShadow = false;
    this.scene.add(key);

    this.debugRenderer = new NavigationDebugRenderer(this.scene);
    this.runner = new ScenarioRunner({
      clock: this.clock,
      createContext: async () => new NavigationScenarioContext({ scene: this.scene }).init()
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
    if (scenario.id.includes("disconnected")) {
      this.camera.position.set(8, 6.8, 9.5);
      this.controls.target.set(0, 0.2, 0);
    } else if (scenario.id.includes("gap")) {
      this.camera.position.set(7.8, 6.2, 8.6);
      this.controls.target.set(0, 0.8, 0);
    } else {
      this.camera.position.set(7.5, 5.8, 8.5);
      this.controls.target.set(0, 0.2, 0);
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
    this.axes.visible = Boolean(visible);
  }

  refreshDebug({ force = false } = {}) {
    const context = this.runner.context;
    if (!context) return false;
    const revision = context.debugRevision ?? 0;
    if (!force && revision === this.lastDebugRevision) return false;
    const snapshot = context.debugSnapshot?.();
    this.lastDebugRevision = revision;
    this.lastDebugSnapshot = snapshot || null;
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
    const stepped = this.runner.tick(timestamp);
    if (stepped && this.cadence.shouldDebug(timestamp)) this.refreshDebug();
    if (stepped && this.cadence.shouldTelemetry(timestamp)) this.emitTelemetry();
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
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
