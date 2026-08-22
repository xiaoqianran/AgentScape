import { toolDefinitionsForLLM } from './toolCatalog.js';

const SYSTEM_PROMPT = `You are AgentScape, a spatial agent controlling an interactive 3D world.
Use tools instead of inventing world state. Inspect objects before acting when identities or geometry are uncertain.
Prefer place/findFreeSpace over guessing coordinates. Never claim a world mutation succeeded unless the tool result confirms it.
Keep the final response concise.`;

export class ToolCallingAgent {
  constructor({ tools, gateway, fallbackGateway, log = () => {}, maxSteps = 8 }) {
    this.tools = tools;
    this.gateway = gateway;
    this.fallbackGateway = fallbackGateway;
    this.log = log;
    this.maxSteps = maxSteps;
  }

  get mode() { return this.gateway?.isConfigured() ? 'llm' : 'local'; }

  async run(text) {
    this.log(`goal: ${text}`, 'goal');
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: text }
    ];
    const gateway = this.gateway?.isConfigured() ? this.gateway : this.fallbackGateway;
    if (!gateway) throw new Error('No agent gateway available');

    for (let step = 0; step < this.maxSteps; step++) {
      const response = await gateway.complete({
        messages,
        tools: toolDefinitionsForLLM(),
        context: { world: await this.tools.call('listObjects') }
      });
      if (response.message) messages.push({ role: 'assistant', content: response.message });
      if (!response.toolCalls.length) {
        const final = response.message || '任务完成。';
        this.log(final, 'result');
        return { message: final, steps: step + 1 };
      }

      for (const call of response.toolCalls) {
        this.log(`plan: ${call.name} ${JSON.stringify(call.args)}`, 'plan');
        let result;
        try {
          result = await this.tools.call(call.name, call.args);
        } catch (error) {
          result = { error: error.message, code: error.code || 'TOOL_ERROR' };
        }
        const safeResult = result === undefined ? { ok: true } : result;
        messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: JSON.stringify(safeResult) });
        this.log(`result: ${call.name} ${JSON.stringify(safeResult)}`, result?.error ? 'error' : 'tool');
      }
    }
    throw new Error(`Agent exceeded ${this.maxSteps} planning steps`);
  }
}
