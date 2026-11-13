import { executeAgentRun } from './execution/AgentRunSession.js';
export { normalizeModelToolCall } from './execution/AgentExecutionRules.js';

export class ToolCallingAgent {
  constructor({ tools, gateway, log = () => {}, maxSteps = 8, maxRecoveryReadRounds = 4, maxUnchangedFailures = 2 }) {
    this.tools = tools;
    this.gateway = gateway;
    this.log = log;
    this.maxSteps = maxSteps;
    this.maxRecoveryReadRounds = maxRecoveryReadRounds;
    this.maxUnchangedFailures = maxUnchangedFailures;
  }

  get mode() { return this.gateway?.isConfigured() ? 'llm' : 'unconfigured'; }

  async run(text, { signal, actor = this.tools.actor } = {}) {
    return executeAgentRun(this, text, { signal, actor });
  }
}
