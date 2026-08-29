import { AgentToolsLab } from "./AgentToolsLab.js";
import { ToolCallingAgentScenarioContext } from "./ToolCallingAgentScenarioContext.js";
import { agentTraceScenarios } from "./scenarios/traceIndex.js";

export const labDefinition = Object.freeze({
  id: "agent-trace",
  title: "智能体轨迹",
  scenarios: agentTraceScenarios,
  backends: [Object.freeze({ id: "scripted-agent", title: "ToolCallingAgent + Scripted Gateway" })],
  debugLayers: ["agent-tool", "normalized", "labels", "grid"],
  defaultDebugLayers: ["agent-tool", "labels", "grid"],
  normalizeBackend() { return "scripted-agent"; },
  create(options) {
    return new AgentToolsLab({
      ...options,
      contextFactory: (contextOptions) => new ToolCallingAgentScenarioContext(contextOptions)
    });
  }
});
