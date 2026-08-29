import { SpatialLab } from "./SpatialLab.js";
import { spatialScenarios } from "./scenarios/index.js";

export const labDefinition = Object.freeze({
  id: "spatial",
  title: "Spatial",
  scenarios: spatialScenarios,
  backends: [Object.freeze({ id: "three-bvh", title: "Three + BVH" })],
  debugLayers: ["bounds", "ray", "spatial-query", "grid"],
  normalizeBackend() { return "three-bvh"; },
  create(options) { return new SpatialLab(options); }
});
