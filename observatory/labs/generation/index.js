import { AgentToolsLab } from "../agent/AgentToolsLab.js";
import { GenerationAgentScenarioContext } from "./GenerationAgentScenarioContext.js";
import { generationAgentBuildScenario, generationEmbodiedBuildScenario } from "./scenarios/index.js";

export const labDefinition = {
  id: "generation",
  title: "生成与智能体构建",
  backends: [{ id: "fixture", title: "确定性 Fixture" }],
  normalizeBackend: () => "fixture",
  scenarios: [generationAgentBuildScenario, generationEmbodiedBuildScenario],
  debugLayers: ["normalized", "agent-tool", "labels", "grid"],
  defaultDebugLayers: ["normalized", "agent-tool", "labels", "grid"],
  create: ({ viewport, onTelemetry }) => new AgentToolsLab({
    viewport,
    onTelemetry,
    contextFactory: (options) => new GenerationAgentScenarioContext(options)
  })
};
