import { SpatialLab } from "./SpatialLab.js";
import { spatialScenarios } from "./scenarios/index.js";

export const labDefinition = Object.freeze({
  id: "spatial",
  title: "空间",
  scenarios: spatialScenarios,
  backends: [Object.freeze({ id: "three-bvh", title: "Three + BVH" })],
  debugLayers: ["bounds", "ray", "spatial-query", "labels", "grid"],
  defaultDebugLayers: ["bounds", "ray", "spatial-query", "labels", "grid"],
  normalizeBackend() { return "three-bvh"; },
  create(options) { return new SpatialLab(options); }
});
