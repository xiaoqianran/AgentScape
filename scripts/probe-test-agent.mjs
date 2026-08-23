import { ToolCallingAgent } from '../src/agent/ToolCallingAgent.js';
import { HttpLLMGateway } from '../src/agent/gateway/HttpLLMGateway.js';
import { SkillRegistry } from '../src/skills/SkillRegistry.js';
import { registerCoreSkills } from '../src/skills/registerCoreSkills.js';
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  loadEnvFile,
  startServer
} from './openai-compatible-agent-gateway.mjs';

loadEnvFile();
const apiKey = process.env.AGENTSCAPE_TEST_LLM_API_KEY;
if (!apiKey) throw new Error('AGENTSCAPE_TEST_LLM_API_KEY is required in .env.local');
const model = process.env.AGENTSCAPE_TEST_LLM_MODEL || DEFAULT_MODEL;
const server = startServer({
  baseUrl:process.env.AGENTSCAPE_TEST_LLM_BASE_URL || DEFAULT_BASE_URL,
  apiKey,
  model,
  host:'127.0.0.1',
  port:0,
  quiet:true
});
await new Promise((resolve, reject) => {
  if (server.listening) return resolve();
  server.once('listening', resolve);
  server.once('error', reject);
});
const port = server.address().port;

try {
  const registry = registerCoreSkills(new SkillRegistry({ runtime:{} }), {});
  const toolCalls = [];
  const tools = {
    definitions:() => registry.definitions(),
    call:async(name, args = {}) => {
      if (name === 'listObjects') return [{ id:'agent_01', assetId:'agent', type:'agent' }];
      if (name === 'navigateTo') {
        toolCalls.push({ name, args });
        return { status:'arrived', id:args.id, target:args.end, position:args.end, elapsed:1.2 };
      }
      throw Object.assign(new Error(`Probe only permits listObjects/navigateTo, model called ${name}`), { code:'PROBE_TOOL_NOT_ALLOWED' });
    }
  };
  const gateway = new HttpLLMGateway({ endpoint:`http://127.0.0.1:${port}/agent`, timeoutMs:90000 });
  const agent = new ToolCallingAgent({ tools, gateway, fallbackGateway:null, maxSteps:4 });
  const result = await agent.run('Move agent_01 physically to [3,0,2]. Do not teleport it.');
  if (!toolCalls.some((call) => call.name === 'navigateTo' && call.args.id === 'agent_01')) {
    throw new Error('Model did not use navigateTo for the embodied movement probe');
  }
  console.log(JSON.stringify({ ok:true, model, toolCalls, final:result.message, steps:result.steps }, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
}
