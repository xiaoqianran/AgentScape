import { navigationSimplePathScenario } from "./simplePath.js";
import { navigationDisconnectedScenario } from "./disconnectedIslands.js";
import { navigationGapScenario } from "./gapPath.js";
import { navigationDoorCounterfactualScenario } from "./doorCounterfactual.js";
import { navigationDoorOpenTransitionScenario } from "./doorOpenTransition.js";

export const navigationScenarios = [
  navigationSimplePathScenario,
  navigationDisconnectedScenario,
  navigationGapScenario,
  navigationDoorCounterfactualScenario,
  navigationDoorOpenTransitionScenario
];
