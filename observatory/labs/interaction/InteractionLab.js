import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { SimulationClock } from "../../core/SimulationClock.js";
import { ScenarioRunner } from "../../core/ScenarioRunner.js";
import { FrameCadence } from "../../core/FrameCadence.js";
import { InteractionScenarioContext } from "./InteractionScenarioContext.js";
import { InteractionDebugRenderer } from "./visualizers/InteractionDebugRenderer.js";
import { NormalizedColliderRenderer } from "../physics/visualizers/NormalizedColliderRenderer.js";

export class InteractionLab {
  constructor({ viewport, onTelemetry }) {
    this.viewport = viewport;
    this.onTelemetry = onTelemetry;
    this.clock = new SimulationClock({ fixedDt: 1 / 60, maxSubSteps: 8 });
    this.checkpointFrame = null;
    this.cadence = new FrameCadence({ debugHz: 15, telemetryHz: 5 });

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x11161d);
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.05, 200);
    this.camera.position.set(6, 4.8, 7.5);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    viewport.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.9, 0);
    this.controls.enableDamping = true;

    this.grid = new THREE.GridHelper(12, 24, 0x566171, 0x2a323d);
    this.axes = new THREE.AxesHelper(1.25);
    this.axes.position.set(-5, 0.02, 3.5);
    this.scene.add(this.grid, this.axes);
    this.scene.add(new THREE.HemisphereLight(0xd8e6ff, 0x20252c, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 3);
    key.position.set(5, 9, 4);
    key.castShadow = false;
    this.scene.add(key);

    this.debugRenderer = new InteractionDebugRenderer(this.scene);
    this.colliderRenderer = new NormalizedColliderRenderer(this.scene);
    this.runner = new ScenarioRunner({
      clock: this.clock,
      createContext: async () => new InteractionScenarioContext({ scene: this.scene }).init()
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
    if (scenario.id.includes("place")) {
      this.camera.position.set(5.5, 4.8, 6.8);
      this.controls.target.set(0, 0.9, 0);
    } else if (scenario.id.includes("los")) {
      this.camera.position.set(4.6, 3.5, 5.8);
      this.controls.target.set(0, 0.8, 0.3);
    } else {
      this.camera.position.set(5, 4, 6);
      this.controls.target.set(0, 1, 0);
    }
    this.controls.update();
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

  setInteractionLosDebug(visible) { this.debugRenderer.setLosVisible(visible); }
  setInteractionSupportDebug(visible) { this.debugRenderer.setSupportVisible(visible); }
  setInteractionStateDebug(visible) { this.debugRenderer.setStateVisible(visible); }
  setNormalizedDebug(visible) { this.colliderRenderer.setVisible(visible); }
  setGridVisible(visible) { this.grid.visible = Boolean(visible); this.axes.visible = Boolean(visible); }

  refreshDebug() {
    const context = this.runner.context;
    if (!context) return;
    const scenario = this.runner.scenario;
    const isReach = scenario?.id?.includes("reach");
    const snapshot = context.debugSnapshot({ actorId: isReach ? "agent" : null, targetId: isReach ? "cup" : null });
    this.lastDebugSnapshot = snapshot;
    this.debugRenderer.update(snapshot);
    this.colliderRenderer.update(snapshot.physics || null);
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
        backend: "rapier + bvh",
        held: snapshot.held?.human || "—",
        action: snapshot.action?.name || "—",
        interactable: snapshot.reach?.interactable ?? "—",
        blocker: snapshot.reach?.lineOfSight?.hit?.id || "—",
        "support on": snapshot.support?.on ?? "—",
        events: snapshot.events?.length ?? 0
      }
    };
  }

  emitTelemetry() { const data = this.telemetry(); if (data) this.onTelemetry?.(data); }
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
    this.colliderRenderer.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
