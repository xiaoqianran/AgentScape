import { physicsScenarios } from "../../physics/scenarios/index.js";
import { characterScenario } from "./character.js";
import { sensorScenario } from "./sensor.js";
import { filterScenario } from "./filter.js";
import { queryScenario } from "./query.js";

/**
 * Physics Studio reuses the existing deterministic presets and adds presets for the
 * engine surface they do not reach yet (character controller, semantic collision
 * events, collision filtering, structured pose/ray queries).
 */
export const studioScenarios = [
  ...physicsScenarios,
  characterScenario,
  sensorScenario,
  filterScenario,
  queryScenario
];
