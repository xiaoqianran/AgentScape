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
const mode = process.argv[2] || 'locomotion';
const scenarios = {
  locomotion: {
    goal:'Move agent_01 physically to [3,0,2]. Do not teleport it.',
    world:[{ id:'agent_01', asset:'agent', position:[0,0,4], actions:['navigate'] }],
    expected:'navigateTo'
  },
  interaction: {
    goal:'Walk agent_01 to cabinet_01 and open its door. Do not open it remotely; use the embodied interaction abstraction.',
    world:[
      { id:'agent_01', asset:'agent', position:[0,0,4], actions:['navigate'] },
      { id:'cabinet_01', asset:'cabinet', position:[0,0,0], actions:['open','close','move'] }
    ],
    expected:'approachAndInteract'
  }
};
const scenario = scenarios[mode];
if (!scenario) throw new Error(`Unknown probe mode: ${mode}`);

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
      if (name === 'listObjects') return scenario.world;
      toolCalls.push({ name, args });
      if (name === 'navigateTo' && mode === 'locomotion') {
        return { status:'arrived', id:args.id, target:args.end, position:args.end, elapsed:1.2 };
      }
      if (name === 'findInteractionPose' && mode === 'interaction') {
        return { status:'approach-pose', position:[0,0,1], routeCost:3, distance:.55, lineOfSight:{hit:{id:'cabinet_01'}} };
      }
      if (name === 'getBounds' && mode === 'interaction') {
        return args.id === 'cabinet_01'
          ? { id:'cabinet_01', min:[-.85,0,-.36], max:[.85,2,.43], center:[0,1,.035], size:[1.7,2,.79] }
          : { id:'agent_01', min:[-.32,0,-.32], max:[.32,1.7,.32], center:[0,.85,0], size:[.64,1.7,.64] };
      }
      if (name === 'findNearby' && mode === 'interaction') return [{ id:'cabinet_01', asset:'cabinet', distance:4 }];
      if (name === 'approachAndInteract' && mode === 'interaction') {
        if (args.actorId !== 'agent_01' || args.targetId !== 'cabinet_01' || args.action !== 'open') {
          throw Object.assign(new Error('Embodied interaction probe received wrong arguments'), { code:'PROBE_BAD_ARGUMENTS' });
        }
        return {
          actorId:'agent_01', targetId:'cabinet_01', action:'open',
          locomotion:{status:'arrived',position:[0,0,1]},
          reach:{inRange:true,visible:true,interactable:true,distance:.55},
          status:'interaction-requested',
          actionSweep:{checked:true,clear:true,partName:'door'},
          interaction:{id:'cabinet_01',part:'door',action:'open',target:-1.35,requested:true}
        };
      }
      if (name === 'open' && mode === 'interaction') {
        throw Object.assign(new Error('Probe rejects remote low-level open; use approachAndInteract'), { code:'REMOTE_OPEN_REJECTED' });
      }
      throw Object.assign(new Error(`Probe does not allow ${name} in ${mode} mode`), { code:'PROBE_TOOL_NOT_ALLOWED' });
    }
  };
  const gateway = new HttpLLMGateway({ endpoint:`http://127.0.0.1:${port}/agent`, timeoutMs:90000 });
  const trace = process.env.AGENTSCAPE_TEST_LLM_TRACE === '1';
  const agent = new ToolCallingAgent({ tools, gateway, fallbackGateway:null, maxSteps:6, log:trace ? (message,type)=>console.error(`[${type}] ${message}`) : ()=>{} });
  const result = await agent.run(scenario.goal);
  if (!toolCalls.some((call) => call.name === scenario.expected)) {
    throw new Error(`Model did not use ${scenario.expected} for the ${mode} probe`);
  }
  if (mode === 'interaction' && toolCalls.some((call) => call.name === 'open')) {
    throw new Error('Model attempted low-level remote open during embodied interaction probe');
  }
  console.log(JSON.stringify({ ok:true, mode, model, toolCalls, final:result.message, steps:result.steps }, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
}
