import { InteractionLab } from "./InteractionLab.js";
import { interactionScenarios } from "./scenarios/index.js";

export const labDefinition = Object.freeze({
  id: "interaction",
  title: "交互",
  scenarios: interactionScenarios,
  backends: [Object.freeze({ id: "rapier-bvh", title: "Rapier + BVH" })],
  debugLayers: ["interaction-los", "interaction-support", "interaction-state", "normalized", "labels", "grid"],
  defaultDebugLayers: ["interaction-los", "interaction-support", "normalized", "labels", "grid"],
  normalizeBackend() { return "rapier-bvh"; },
  create(options) { return new InteractionLab(options); }
});
