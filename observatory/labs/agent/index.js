import { AgentToolsLab } from "./AgentToolsLab.js";
import { agentToolsScenarios } from "./scenarios/index.js";

export const labDefinition = Object.freeze({
  id: "agent",
  title: "智能体工具",
  scenarios: agentToolsScenarios,
  backends: [Object.freeze({ id: "agent-tools", title: "AgentTools + Domain Skills" })],
  debugLayers: ["agent-tool", "normalized", "labels", "grid"],
  defaultDebugLayers: ["agent-tool", "labels", "grid"],
  normalizeBackend() { return "agent-tools"; },
  create(options) { return new AgentToolsLab(options); }
});
