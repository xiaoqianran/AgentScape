import { agentGetBoundsScenario } from "./getBounds.js";
import { agentRaycastScenario } from "./raycast.js";
import { agentFindFreeSpaceScenario } from "./findFreeSpace.js";
import { agentDropHeldScenario } from "./dropHeld.js";

export const agentToolsScenarios = [
  agentGetBoundsScenario,
  agentRaycastScenario,
  agentFindFreeSpaceScenario,
  agentDropHeldScenario
];
