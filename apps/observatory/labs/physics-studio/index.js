import { PhysicsStudioLab } from "./PhysicsStudioLab.js";
import { PhysicsStudioCompareLab } from "./PhysicsStudioCompareLab.js";
import { studioScenarios } from "./scenarios/index.js";
import { PHYSICS_BACKENDS, isPhysicsBackend } from "../physics/backends.js";

export const labDefinition = Object.freeze({
  id: "physics-studio",
  title: "物理工作台",
  scenarios: studioScenarios,
  backends: PHYSICS_BACKENDS,
  debugLayers: ["native", "manifest", "difference", "normalized", "velocity", "joint", "contact", "labels", "grid"],
  defaultDebugLayers: ["native", "normalized", "velocity", "joint", "contact", "labels", "grid"],
  normalizeBackend(id) { return isPhysicsBackend(id) ? id : "rapier"; },
  create(options) {
    return options.backendId === "compare"
      ? new PhysicsStudioCompareLab(options)
      : new PhysicsStudioLab(options);
  }
});
