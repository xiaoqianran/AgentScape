import { gravityScenario } from "./gravity.js";
import { collisionScenario } from "./collision.js";
import { stackScenario } from "./stack.js";
import { hingeScenario } from "./hinge.js";
import { assetCupScenario } from "./assetCup.js";
import { assetCabinetScenario } from "./assetCabinet.js";

export const physicsScenarios = [
  gravityScenario,
  collisionScenario,
  stackScenario,
  hingeScenario,
  assetCupScenario,
  assetCabinetScenario
];
