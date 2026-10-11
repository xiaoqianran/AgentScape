import { PhysicsLab } from "../physics/PhysicsLab.js";
import { attachPhysicsWorkbench } from "./attachPhysicsWorkbench.js";

/**
 * Dedicated physics frontend: the production PhysicsLab (viewport, debug contract,
 * fixed-step clock, checkpoint/replay, Rapier/Jolt switch) plus a workbench that exposes
 * the complete PhysicsSystem API surface as invokable operations.
 */
export class PhysicsStudioLab extends PhysicsLab {
  constructor(options) {
    super(options);
    attachPhysicsWorkbench(this, {
      getContext:() => this.runner.context,
      afterInvoke:() => {
        this.refreshDebug();
        this.emitTelemetry();
      }
    });
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
