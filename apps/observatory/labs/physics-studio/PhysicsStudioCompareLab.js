import { PhysicsCompareLab } from "../physics/PhysicsCompareLab.js";
import { attachPhysicsWorkbench } from "./attachPhysicsWorkbench.js";

/**
 * Same workbench, but the API calls are routed to the Rapier pane so a single live
 * PhysicsSystem remains the authority while the Lab compares both backends.
 */
export class PhysicsStudioCompareLab extends PhysicsCompareLab {
  constructor(options) {
    super(options);
    attachPhysicsWorkbench(this, {
      getContext:() => this.left?.runner?.context || null,
      afterInvoke:() => {
        this.left?.refreshDebug?.();
        this.right?.refreshDebug?.();
        this.emitTelemetry();
      }
    });
  }

  telemetry() {
    const base = super.telemetry();
    if (!base) return base;
    return {
      ...base,
      metrics:{
        ...base.metrics,
        ...this.apiCoverageMetrics(),
        "api target": "rapier pane"
      }
    };
  }
}
