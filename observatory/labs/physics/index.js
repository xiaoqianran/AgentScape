import { PhysicsLab } from "./PhysicsLab.js";
import { PhysicsCompareLab } from "./PhysicsCompareLab.js";
import { physicsScenarios } from "./scenarios/index.js";
import { PHYSICS_BACKENDS, isPhysicsBackend } from "./backends.js";

export const labDefinition = Object.freeze({
  id: "physics",
  title: "Physics",
  scenarios: physicsScenarios,
  backends: PHYSICS_BACKENDS,
  debugLayers: ["native", "manifest", "difference", "normalized", "velocity", "joint", "contact", "grid"],
  defaultDebugLayers: ["normalized", "grid"],
  normalizeBackend(id) { return isPhysicsBackend(id) ? id : "rapier"; },
  create(options) {
    return options.backendId === "compare"
      ? new PhysicsCompareLab(options)
      : new PhysicsLab(options);
  }
});
