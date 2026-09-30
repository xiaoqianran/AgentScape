import { PhysicsLab } from "../physics/PhysicsLab.js";
import { createPhysicsWorkbench } from "./workbench.js";

/**
 * Dedicated physics frontend: the production PhysicsLab (viewport, debug contract,
 * fixed-step clock, checkpoint/replay, Rapier/Jolt switch) plus a workbench that exposes
 * the complete PhysicsSystem API surface as invokable operations.
 */
export class PhysicsStudioLab extends PhysicsLab {
  constructor(options) {
    super(options);
    const workbench = createPhysicsWorkbench({
      getContext:() => this.runner.context,
      afterInvoke:() => {
        this.refreshDebug();
        this.emitTelemetry();
      }
    });
    this.toolDefinitions = () => workbench.toolDefinitions();
    this.suggestedToolName = () => workbench.suggestedToolName();
    this.invokeTool = (name, args) => workbench.invokeTool(name, args);
    this.apiHistory = () => workbench.apiHistory();
    this.apiCoverageMetrics = () => workbench.apiCoverageMetrics();
  }

  telemetry() {
    const base = super.telemetry();
    if (!base) return base;
    return { ...base, metrics:{ ...base.metrics, ...this.apiCoverageMetrics() } };
  }

  get debugSummary() {
    return this.apiCoverageMetrics();
  }
}
