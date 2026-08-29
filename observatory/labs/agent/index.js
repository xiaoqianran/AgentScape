import { AgentToolsLab } from "./AgentToolsLab.js";
import { agentToolsScenarios } from "./scenarios/index.js";

export const labDefinition = Object.freeze({
  id: "agent",
  title: "AgentTools",
  scenarios: agentToolsScenarios,
  backends: [Object.freeze({ id: "agent-tools", title: "AgentTools + Domain Skills" })],
  debugLayers: ["agent-tool", "normalized", "grid"],
  defaultDebugLayers: ["agent-tool", "grid"],
  normalizeBackend() { return "agent-tools"; },
  create(options) { return new AgentToolsLab(options); }
});
