import { interactionPickupDropScenario } from "./pickupDrop.js";
import { interactionPlaceScenario } from "./place.js";
import { interactionPlaceSeatScenario } from "./placeSeat.js";
import { interactionLosBlockedScenario } from "./losBlocked.js";
import { interactionLosClearScenario } from "./losClear.js";

export const interactionScenarios = [
  interactionPickupDropScenario,
  interactionPlaceScenario,
  interactionPlaceSeatScenario,
  interactionLosBlockedScenario,
  interactionLosClearScenario
];
