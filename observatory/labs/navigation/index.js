import { NavigationLab } from "./NavigationLab.js";
import { navigationScenarios } from "./scenarios/index.js";

export const labDefinition = Object.freeze({
  id: "navigation",
  title: "Navigation",
  scenarios: navigationScenarios,
  backends: [Object.freeze({ id: "recast-detour", title: "Recast + Detour" })],
  debugLayers: ["navmesh", "path", "endpoints", "obstacles", "labels", "grid"],
  defaultDebugLayers: ["path", "endpoints", "labels", "grid"],
  normalizeBackend() { return "recast-detour"; },
  create(options) { return new NavigationLab(options); }
});
