import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { SimulationClock } from "../../core/SimulationClock.js";
import { ScenarioRunner } from "../../core/ScenarioRunner.js";
import { SpatialScenarioContext } from "./SpatialScenarioContext.js";
import { SpatialDebugRenderer } from "./visualizers/SpatialDebugRenderer.js";

export class SpatialLab {
  constructor({ viewport, onTelemetry }) {
    this.viewport = viewport;
    this.onTelemetry = onTelemetry;
    this.clock = new SimulationClock({ fixedDt: 1 / 60, maxSubSteps: 8 });
    this.checkpointFrame = null;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x11161d);
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.05, 200);
    this.camera.position.set(7, 5.5, 8);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    viewport.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.2, 0);
    this.controls.enableDamping = true;

    this.grid = new THREE.GridHelper(12, 24, 0x566171, 0x2a323d);
    this.axes = new THREE.AxesHelper(1.25);
    this.axes.position.set(-5, 0.02, 3.5);
    this.scene.add(this.grid, this.axes);
    this.scene.add(new THREE.HemisphereLight(0xd8e6ff, 0x20252c, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 3);
    key.position.set(5, 9, 4);
    key.castShadow = true;
    this.scene.add(key);

    this.debugRenderer = new SpatialDebugRenderer(this.scene);
    this.runner = new ScenarioRunner({
      clock: this.clock,
      createContext: async () => new SpatialScenarioContext({ scene: this.scene }).init(),
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
    if (scenario.id.includes("raycast")) {
      this.camera.position.set(4.5, 4.2, 8.5);
      this.controls.target.set(0.5, 0.7, 0);
    } else if (scenario.id.includes("support")) {
      this.camera.position.set(5.5, 4.5, 6.5);
      this.controls.target.set(0, 1.1, 0);
    } else {
      this.camera.position.set(5.5, 4, 6.5);
      this.controls.target.set(0.8, 0.7, 0);
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

  setBoundsDebug(visible) { this.debugRenderer.setBoundsVisible(visible); }
  setRayDebug(visible) { this.debugRenderer.setRayVisible(visible); }
  setSpatialQueryDebug(visible) { this.debugRenderer.setQueryVisible(visible); }
  setGridVisible(visible) {
    this.grid.visible = Boolean(visible);
    this.axes.visible = Boolean(visible);
  }

  refreshDebug() {
    const snapshot = this.runner.context?.debugSnapshot?.();
    this.lastDebugSnapshot = snapshot || null;
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
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
