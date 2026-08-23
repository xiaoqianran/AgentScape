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
  },
  pickup: {
    goal:'Walk agent_01 to cup_01 and pick it up so the Agent carries it. Do not use the low-level Human pickup tool.',
    world:[
      { id:'agent_01', asset:'agent', position:[0,0,3], actions:['navigate'] },
      { id:'cup_01', asset:'cup', position:[0,0,0], actions:['pickup','drop','place','move'] }
    ],
    expected:'approachAndPickup'
  },
  place: {
    goal:'agent_01 is already carrying cup_01. Place the held object onto table_01 using the embodied place abstraction. Do not use the low-level scene place tool. Only report success if settle support is verified.',
    world:[
      { id:'agent_01', asset:'agent', position:[0,0,3], actions:['navigate'] },
      { id:'cup_01', asset:'cup', position:[0,.95,2.38], actions:['pickup','drop','place','move'] },
      { id:'table_01', asset:'table', position:[0,0,0], actions:['move'] }
    ],
    expected:'approachAndPlace'
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
  let placeHeld = mode === 'place';
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
          status:'action-completed',targetReached:true,settled:true,statePromoted:true,
          coordinate:-1.31,error:.04,tolerance:.08,coordinateReference:'rest-zero-pose',
          actionSweep:{checked:true,clear:true,partName:'door'},
          interaction:{id:'cabinet_01',part:'door',action:'open',target:-1.35,requested:true}
        };
      }
      if (name === 'getArticulationStatus' && mode === 'interaction') return {
        id:'cabinet_01',parts:[{partName:'door',status:'action-completed',verifiedAction:'open',requestedAction:null,live:{coordinate:-1.31,target:-1.35,error:.04,tolerance:.08,coordinateReference:'rest-zero-pose'}}]
      };
      if (name === 'approachAndPickup' && mode === 'pickup') {
        if (args.actorId !== 'agent_01' || args.targetId !== 'cup_01') {
          throw Object.assign(new Error('Embodied pickup probe received wrong arguments'), { code:'PROBE_BAD_ARGUMENTS' });
        }
        return {
          status:'held', actorId:'agent_01', targetId:'cup_01',
          attachment:'kinematic-anchor', graspVerified:false,
          locomotion:{status:'arrived',position:[0,0,.8]},
          reach:{inRange:true,visible:true,interactable:true,distance:.4},
          transfer:{clear:true}
        };
      }
      if (name === 'getCarryStatus' && mode === 'pickup') return {status:'held',actorId:'agent_01',targetId:'cup_01',attachment:'kinematic-anchor',graspVerified:false};
      if (name === 'getCarryStatus' && mode === 'place') return placeHeld
        ? {status:'held',actorId:'agent_01',targetId:'cup_01',attachment:'kinematic-anchor',graspVerified:false}
        : {status:'empty',actorId:'agent_01'};
      if (name === 'findSupportSurface' && mode === 'place') return {targetId:'table_01',id:'top',center:[0,1.1,0],size:[2.2,1.05]};
      if (name === 'approachAndPlace' && mode === 'place') {
        if (args.actorId !== 'agent_01' || args.supportId !== 'table_01') {
          throw Object.assign(new Error('Embodied place probe received wrong arguments'), { code:'PROBE_BAD_ARGUMENTS' });
        }
        placeHeld=false;
        return {
          status:'placed',actorId:'agent_01',targetId:'table_01',heldId:'cup_01',
          supportVerified:true,settled:true,stillHeld:false,
          support:{on:true,surfaceId:'top',gap:.002},
          release:[0,1.13,0],
          transfer:[{clear:true},{clear:true},{clear:true}]
        };
      }
      if (name === 'place' && mode === 'place') {
        throw Object.assign(new Error('Probe rejects low-level scene place; use approachAndPlace'), { code:'REMOTE_PLACE_REJECTED' });
      }
      if (name === 'pickup' && mode === 'pickup') {
        throw Object.assign(new Error('Probe rejects low-level Human pickup; use approachAndPickup'), { code:'REMOTE_PICKUP_REJECTED' });
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
  if (mode === 'pickup' && toolCalls.some((call) => call.name === 'pickup')) {
    throw new Error('Model attempted low-level Human pickup during embodied pickup probe');
  }
  if (mode === 'place' && toolCalls.some((call) => call.name === 'place')) {
    throw new Error('Model attempted low-level scene place during embodied place probe');
  }
  console.log(JSON.stringify({ ok:true, mode, model, toolCalls, final:result.message, steps:result.steps }, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
}
