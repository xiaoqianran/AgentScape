import { AgentToolsLab } from "../agent/AgentToolsLab.js";
import { GenerationAgentScenarioContext } from "./GenerationAgentScenarioContext.js";
import { generationAgentBuildScenario, generationConnectorDiscoveryScenario, generationEmbodiedBuildScenario } from "./scenarios/index.js";

export const labDefinition = {
  id: "generation",
  title: "生成与智能体构建",
  backends: [
    { id: "fixture", title: "确定性 Fixture" },
    { id: "connector", title: "真实 Connector（仅能力发现）" }
  ],
  normalizeBackend: (backendId) => backendId === "connector" ? "connector" : "fixture",
  scenarios: [generationAgentBuildScenario, generationEmbodiedBuildScenario, generationConnectorDiscoveryScenario],
  debugLayers: ["normalized", "agent-tool", "labels", "grid"],
  defaultDebugLayers: ["normalized", "agent-tool", "labels", "grid"],
  create: ({ viewport, onTelemetry, backendId, rendererMode, rendererTiming }) => new AgentToolsLab({
    viewport,
    onTelemetry,
    rendererMode,
    rendererTiming,
    contextOptions: { backendId },
    contextFactory: (options) => new GenerationAgentScenarioContext(options)
  })
};
