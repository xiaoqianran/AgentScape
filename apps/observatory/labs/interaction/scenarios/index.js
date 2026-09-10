import { interactionPickupDropScenario } from "./pickupDrop.js";
import { interactionPlaceScenario } from "./place.js";
import { interactionLosBlockedScenario } from "./losBlocked.js";
import { interactionLosClearScenario } from "./losClear.js";

export const interactionScenarios = [
  interactionPickupDropScenario,
  interactionPlaceScenario,
  interactionLosBlockedScenario,
  interactionLosClearScenario
];
