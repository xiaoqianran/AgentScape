import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { SimulationClock } from "../../core/SimulationClock.js";
import { ScenarioRunner } from "../../core/ScenarioRunner.js";
import { FrameCadence } from "../../core/FrameCadence.js";
import { createObservatoryGrid, disposeObservatoryGrid } from "../../visual/ObservatoryGrid.js";
import { createObservatoryGround, disposeObservatoryGround } from "../../visual/ObservatoryGround.js";
import { applyObservatorySceneTheme } from "../../visual/ObservatorySceneTheme.js";
import { resizeObservatoryRenderer } from "../../visual/RendererQuality.js";
import { WorldLabelLayer, worldLabelsForInteraction } from "../../visual/WorldLabelLayer.js";
import { CameraRig } from "../../visual/CameraRig.js";
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
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.05, 200);
    this.camera.position.set(6, 4.8, 7.5);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.shadowMap.enabled = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.sceneTheme = applyObservatorySceneTheme(this.scene, this.renderer);
    viewport.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.9, 0);
    this.controls.enableDamping = true;
    this.cameraRig = new CameraRig({ camera: this.camera, controls: this.controls });
    this.worldLabels = new WorldLabelLayer({ scene: this.scene, camera: this.camera, viewport });

    this.ground = createObservatoryGround({ size: 20, accentColor: 0x8caaee });
    this.grid = createObservatoryGrid({ size: 24 });
    this.scene.add(this.ground, this.grid);

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
    let position;
    let target;
    if (scenario.id.includes("place")) {
      position = [5.5, 4.8, 6.8];
      target = [0, 0.9, 0];
    } else if (scenario.id.includes("los")) {
      position = [4.6, 3.5, 5.8];
      target = [0, 0.8, 0.3];
    } else {
      position = [5, 4, 6];
      target = [0, 1, 0];
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

  setInteractionLosDebug(visible) { this.debugRenderer.setLosVisible(visible); }
  setInteractionSupportDebug(visible) { this.debugRenderer.setSupportVisible(visible); }
  setInteractionStateDebug(visible) { this.debugRenderer.setStateVisible(visible); }
  setNormalizedDebug(visible) { this.colliderRenderer.setVisible(visible); }
  setGridVisible(visible) { this.grid.visible = Boolean(visible); }

  refreshDebug() {
    const context = this.runner.context;
    if (!context) return;
    const scenario = this.runner.scenario;
    const isReach = scenario?.id?.includes("reach");
    const snapshot = context.debugSnapshot({ actorId: isReach ? "agent" : null, targetId: isReach ? "cup" : null });
    this.lastDebugSnapshot = snapshot;
    this.worldLabels.setLabels(worldLabelsForInteraction(snapshot || null));
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
    const cameraMoving = this.cameraRig.update(timestamp);
    if (!cameraMoving) this.controls.update();
    this.renderer.render(this.scene, this.camera);
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
    this.resizeObserver.disconnect();
    await this.runner.dispose();
    this.debugRenderer.dispose();
    this.colliderRenderer.dispose();
    this.worldLabels.dispose();
    this.controls.dispose();
    disposeObservatoryGround(this.ground);
    disposeObservatoryGrid(this.grid);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
