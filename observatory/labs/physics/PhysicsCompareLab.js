import { SimulationClock } from "../../core/SimulationClock.js";
import { FrameCadence } from "../../core/FrameCadence.js";
import { PhysicsLab } from "./PhysicsLab.js";
import { comparePhysicsSnapshots } from "./PhysicsStateComparator.js";

const formatDelta = (value) => Number.isFinite(value) ? value.toExponential(3) : "—";

export class PhysicsCompareLab {
  constructor({ viewport, onTelemetry }) {
    this.viewport = viewport;
    this.onTelemetry = onTelemetry;
    this.clock = new SimulationClock({ fixedDt:1/60, maxSubSteps:8 });
    this.scenario = null;
    this.checkpointFrame = null;
    this.cadence = new FrameCadence({ debugHz: 12, telemetryHz: 4 });

    this.host = document.createElement("div");
    this.host.className = "obs-compare-host";
    this.leftPane = this.createPane("Rapier");
    this.rightPane = this.createPane("Jolt");
    this.host.append(this.leftPane.root, this.rightPane.root);
    viewport.appendChild(this.host);

    this.left = new PhysicsLab({ viewport:this.leftPane.viewport, backendId:"rapier", onTelemetry:()=>{}, autoAnimate:false });
    this.right = new PhysicsLab({ viewport:this.rightPane.viewport, backendId:"jolt", onTelemetry:()=>{}, autoAnimate:false });
    this.animation = requestAnimationFrame((timestamp)=>this.frame(timestamp));
  }

  createPane(title) {
    const root=document.createElement("div");
    root.className="obs-compare-pane";
    const label=document.createElement("div");
    label.className="obs-compare-label";
    label.textContent=title;
    const viewport=document.createElement("div");
    viewport.className="obs-compare-viewport";
    root.append(label,viewport);
    return {root,viewport,label};
  }

  async load(scenario) {
    this.checkpointFrame = null;
    this.clock.reset();
    this.scenario=scenario;
    await Promise.all([this.left.load(scenario),this.right.load(scenario)]);
    this.emitTelemetry();
  }

  toggleRunning() {
    this.clock.toggle();
    this.emitTelemetry();
    return this.clock.running;
  }

  step(count=1) {
    this.clock.pause();
    this.stepBoth(count, { refresh:true });
    this.emitTelemetry();
  }

  stepBoth(count, { refresh=false } = {}) {
    this.left.runner.step(count);
    this.right.runner.step(count);
    for(let i=0;i<count;i+=1) this.clock.advance();
    if(refresh) {
      this.left.refreshDebug();
      this.right.refreshDebug();
    }
  }

  async reset() {
    this.clock.reset();
    await Promise.all([this.left.reset(),this.right.reset()]);
    this.emitTelemetry();
  }

  captureCheckpoint() {
    this.checkpointFrame=this.clock.frame;
    this.emitTelemetry();
    return this.checkpointFrame;
  }

  async restoreCheckpoint() {
    if(!Number.isInteger(this.checkpointFrame) || this.checkpointFrame<0) return null;
    const frame=this.checkpointFrame;
    this.clock.reset();
    await Promise.all([this.left.runner.replayTo(frame),this.right.runner.replayTo(frame)]);
    for(let i=0;i<frame;i+=1) this.clock.advance();
    this.left.refreshDebug();
    this.right.refreshDebug();
    this.emitTelemetry();
    return frame;
  }

  setNativeDebug(visible) {
    this.left.setNativeDebug(visible);
    this.right.setNativeDebug(visible);
  }

  setDifferenceDebug(visible) {
    this.left.setDifferenceDebug(visible);
    this.right.setDifferenceDebug(visible);
  }

  setManifestDebug(visible) {
    this.left.setManifestDebug(visible);
    this.right.setManifestDebug(visible);
  }

  setNormalizedDebug(visible) {
    this.left.setNormalizedDebug(visible);
    this.right.setNormalizedDebug(visible);
  }

  setVelocityDebug(visible) {
    this.left.setVelocityDebug(visible);
    this.right.setVelocityDebug(visible);
  }

  setJointDebug(visible) {
    this.left.setJointDebug(visible);
    this.right.setJointDebug(visible);
  }

  setContactDebug(visible) {
    this.left.setContactDebug(visible);
    this.right.setContactDebug(visible);
  }

  setGridVisible(visible) {
    this.left.setGridVisible(visible);
    this.right.setGridVisible(visible);
  }

  setWorldLabelsVisible(visible) {
    this.left.setWorldLabelsVisible(visible);
    this.right.setWorldLabelsVisible(visible);
  }

  focusScenario() {
    this.left.focusScenario();
    this.right.focusScenario();
  }

  comparison() {
    const left=this.left.lastDebugSnapshot || this.left.runner.context?.debugSnapshot({nativeGeometry:false,contacts:false});
    const right=this.right.lastDebugSnapshot || this.right.runner.context?.debugSnapshot({nativeGeometry:false,contacts:false});
    return comparePhysicsSnapshots(left,right);
  }

  telemetry() {
    if(!this.scenario) return null;
    const comparison=this.comparison();
    const leftTelemetry=this.left.telemetry();
    const rightTelemetry=this.right.telemetry();
    const summary=comparison.summary || {};
    const leftAssertions=leftTelemetry?.assertions || [];
    const rightAssertions=rightTelemetry?.assertions || [];
    return {
      scenario:this.scenario,
      clock:this.clock,
      checkpointFrame:this.checkpointFrame,
      inspector:{
        title:"Rapier ↔ Jolt",
        kind:"normalized physics state diff",
        values:{
          "position Δ max":formatDelta(summary.maxPositionDelta),
          "linear velocity Δ max":formatDelta(summary.maxLinearVelocityDelta),
          "angular velocity Δ max":formatDelta(summary.maxAngularVelocityDelta),
          "joint coordinate Δ max":formatDelta(summary.maxJointCoordinateDelta),
          "sleeping mismatches":summary.sleepingMismatchCount ?? 0,
          "missing bodies":summary.missingBodies ?? 0,
          "missing joints":summary.missingJoints ?? 0,
          "contact count Δ":summary.contactCountDelta ?? 0
        }
      },
      assertions:[
        ...leftAssertions.map((item)=>({...item,label:`Rapier · ${item.label}`})),
        ...rightAssertions.map((item)=>({...item,label:`Jolt · ${item.label}`}))
      ],
      metrics:{
        backend:"rapier ↔ jolt",
        "rapier step":leftTelemetry?.metrics?.["physics.step"] || "—",
        "jolt step":rightTelemetry?.metrics?.["physics.step"] || "—",
        "position Δ max":formatDelta(summary.maxPositionDelta),
        "velocity Δ max":formatDelta(summary.maxLinearVelocityDelta),
        "joint Δ max":formatDelta(summary.maxJointCoordinateDelta),
        "contact count Δ":summary.contactCountDelta ?? 0
      }
    };
  }

  emitTelemetry() {
    const data=this.telemetry();
    if(data) this.onTelemetry?.(data);
  }

  frame(timestamp) {
    const count=this.clock.consume(timestamp);
    if(count) this.stepBoth(count);
    if(count && this.cadence.shouldDebug(timestamp)) {
      this.left.refreshDebug();
      this.right.refreshDebug();
    }
    if(count && this.cadence.shouldTelemetry(timestamp)) this.emitTelemetry();
    this.left.renderFrame(timestamp);
    this.right.renderFrame(timestamp);
    this.animation=requestAnimationFrame((next)=>this.frame(next));
  }

  async dispose() {
    cancelAnimationFrame(this.animation);
    this.clock.pause();
    await Promise.all([this.left.dispose(),this.right.dispose()]);
    this.host.remove();
  }
}
