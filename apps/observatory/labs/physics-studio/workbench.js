import { PhysicsSystem } from "../../../../modules/world/runtime/systems/PhysicsSystem.js";
import { invokePhysicsApi, physicsApiCoverage, physicsApiToolDefinitions } from "../../../../modules/physics/PhysicsApiSurface.js";

/**
 * Shared workbench behaviour for Physics Studio labs.
 *
 * The Lab only supplies how to reach the live `PhysicsScenarioContext`; every tool call
 * is forwarded to the production PhysicsSystem through `invokePhysicsApi`, so the UI
 * never owns physics truth and never touches a backend-private world.
 */
export function createPhysicsWorkbench({ getContext, afterInvoke = null, historyLimit = 100 } = {}) {
  if (typeof getContext !== "function") throw new TypeError("createPhysicsWorkbench requires getContext()");
  const history = [];

  const metrics = () => {
    const coverage = physicsApiCoverage(PhysicsSystem);
    const context = getContext();
    const profile = context?.profile?.() || null;
    const last = history.at(-1) || null;
    return {
      "api tools": physicsApiToolDefinitions().length,
      "api coverage": coverage.complete
        ? `complete (${coverage.direct.length} 直连 + ${coverage.hostCovered.length} 宿主 + ${coverage.excluded.length} 声明排除)`
        : `missing: ${coverage.missing.join(", ") || "—"}`,
      "api calls": history.length,
      "api last": last ? `${last.tool}${last.error ? " (错误)" : ""}` : "—",
      "physics capabilities": (profile?.capabilities || []).join(", ") || "—",
      "physics execution modes": (profile?.executionModes || []).join(", ") || "—",
      "physics solver": profile ? (profile.solverEnabled ? "enabled" : "disabled") : "—"
    };
  };

  return {
    toolDefinitions() {
      return physicsApiToolDefinitions();
    },
    suggestedToolName() {
      return "physics.debugSnapshot";
    },
    async invokeTool(name, args = {}) {
      const context = getContext();
      if (!context) throw new Error("物理工作台尚未准备完成");
      const outcome = await invokePhysicsApi(context, name, args);
      history.push(outcome);
      if (history.length > historyLimit) history.splice(0, history.length - historyLimit);
      await afterInvoke?.(outcome);
      if (outcome.error) {
        throw Object.assign(new Error(outcome.error.message), { code:outcome.error.code || undefined });
      }
      return outcome.result;
    },
    apiHistory() {
      return history.map((entry) => ({ ...entry }));
    },
    apiCoverageMetrics: metrics
  };
}
