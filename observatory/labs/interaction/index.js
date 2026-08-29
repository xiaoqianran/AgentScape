import { InteractionLab } from "./InteractionLab.js";
import { interactionScenarios } from "./scenarios/index.js";

export const labDefinition = Object.freeze({
  id: "interaction",
  title: "Interaction",
  scenarios: interactionScenarios,
  backends: [Object.freeze({ id: "rapier-bvh", title: "Rapier + BVH" })],
  debugLayers: ["interaction-los", "interaction-support", "interaction-state", "normalized", "grid"],
  defaultDebugLayers: ["interaction-los", "interaction-support", "normalized", "grid"],
  normalizeBackend() { return "rapier-bvh"; },
  create(options) { return new InteractionLab(options); }
});
