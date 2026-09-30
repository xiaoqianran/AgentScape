import { PhysicsCompareLab } from "../physics/PhysicsCompareLab.js";
import { createPhysicsWorkbench } from "./workbench.js";

/**
 * Same workbench, but the API calls are routed to the Rapier pane so a single live
 * PhysicsSystem remains the authority while the Lab compares both backends.
 */
export class PhysicsStudioCompareLab extends PhysicsCompareLab {
  constructor(options) {
    super(options);
    const workbench = createPhysicsWorkbench({
      getContext:() => this.left?.runner?.context || null,
      afterInvoke:() => {
        this.left?.refreshDebug?.();
        this.right?.refreshDebug?.();
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
