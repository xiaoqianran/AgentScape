import { ToolCallingAgent } from "../../../agent/ToolCallingAgent.js";
import { AgentToolsScenarioContext } from "./AgentToolsScenarioContext.js";

export class ToolCallingAgentScenarioContext extends AgentToolsScenarioContext {
  constructor(options) {
    super(options);
    this.gatewayRequests = [];
    this.gatewayResponses = [];
    this.agentLogs = [];
    this.sequenceEvents = [];
    this.agentResult = null;
  }

  async init() {
    await super.init();
    this.world.events.on("agent.sequence", (event) => this.sequenceEvents.push(structuredClone(event)));
    return this;
  }

  createGateway(responses) {
    let index = 0;
    return {
      isConfigured: () => true,
      complete: async (request) => {
        this.gatewayRequests.push({
          round: index + 1,
          roles: request.messages.map((message) => message.role),
          toolCount: request.tools.length,
          context: structuredClone(request.context)
        });
        const response = responses[index] || { message: "done", toolCalls: [] };
        index += 1;
        this.gatewayResponses.push(structuredClone(response));
        return structuredClone(response);
      }
    };
  }

  createOrchestratorTools() {
    return {
      runtime: this.tools.runtime,
      definitions: () => this.tools.definitions(),
      executionPolicy: (name, result) => this.tools.executionPolicy(name, result),
      recordSequence: (payload) => this.tools.recordSequence(payload),
      call: async (name, args = {}, internalContext = {}) => {
        if (name === "dropHeld") return this.callAndDriveSettle(name, args, { maxFrames: 360 });
        return this.tools.call(name, args, internalContext);
      }
    };
  }

  async runAgent(goal, responses, { maxSteps = 5 } = {}) {
    const gateway = this.createGateway(responses);
    const agent = new ToolCallingAgent({
      tools: this.createOrchestratorTools(),
      gateway,
      maxSteps,
      log: (message, kind) => this.agentLogs.push({ message, kind })
    });
    this.agentResult = await agent.run(goal);
    return this.agentResult;
  }

  debugSnapshot() {
    const base = super.debugSnapshot();
    return {
      ...base,
      source: "tool-calling-agent",
      agent: this.agentResult ? structuredClone(this.agentResult) : null,
      gateway: {
        requests: this.gatewayRequests.map((item) => structuredClone(item)),
        responses: this.gatewayResponses.map((item) => structuredClone(item))
      },
      logs: this.agentLogs.map((item) => structuredClone(item)),
      sequences: this.sequenceEvents.map((item) => structuredClone(item))
    };
  }

  inspect() {
    const snapshot = this.debugSnapshot();
    return {
      title: "ToolCallingAgent 轨迹",
      kind: "脚本网关 → ToolCallingAgent → AgentTools → 领域技能",
      values: {
        taskStatus: snapshot.agent?.taskStatus || null,
        steps: snapshot.agent?.steps ?? null,
        message: snapshot.agent?.message || null,
        lastMutation: snapshot.agent?.lastMutation || null,
        unresolvedMutations: snapshot.agent?.unresolvedMutations?.length ?? 0,
        executionCount: snapshot.agent?.execution?.length ?? 0,
        gatewayRounds: snapshot.gateway.requests.length,
        sequenceEvents: snapshot.sequences.length,
        toolCalledEvents: snapshot.toolCalls.length
      }
    };
  }
}
