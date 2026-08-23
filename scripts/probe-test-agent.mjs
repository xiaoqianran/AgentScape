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
  },
  sequence: {
    goal:'Complete this embodied task in verified order: first open cabinet_01 with agent_01 and wait for action-completed; only then pick up cup_01 so the Agent holds it; only after held, place it onto table_01 and require placed + supportVerified + settled. Replan after every world-changing step. Never use low-level open, pickup, or place.',
    world:[
      { id:'agent_01', asset:'agent', position:[0,0,4], actions:['navigate'] },
      { id:'cabinet_01', asset:'cabinet', position:[0,0,0], actions:['open','close','move'] },
      { id:'cup_01', asset:'cup', position:[1.8,0,1.2], actions:['pickup','drop','place','move'] },
      { id:'table_01', asset:'table', position:[3.2,0,1.4], actions:['move'] }
    ],
    expected:['approachAndInteract','approachAndPickup','approachAndPlace']
  },
  'sequence-failure': {
    goal:'Try to complete this ordered embodied task: open cabinet_01, then pick up cup_01, then place it on table_01. The cabinet may be physically blocked. If approachAndInteract returns action-failed/STALLED or any unverified/blocked result, do not advance to pickup or place. You may inspect the failure, then report the task incomplete. Never use low-level open, pickup, or place.',
    world:[
      { id:'agent_01', asset:'agent', position:[0,0,4], actions:['navigate'] },
      { id:'cabinet_01', asset:'cabinet', position:[0,0,0], actions:['open','close','move'] },
      { id:'cup_01', asset:'cup', position:[1.8,0,1.2], actions:['pickup','drop','place','move'] },
      { id:'table_01', asset:'table', position:[3.2,0,1.4], actions:['move'] }
    ],
    expected:'approachAndInteract'
  }
,
  attribution: {
    goal:'Call approachAndInteract directly so agent_01 walks to cabinet_01 and tries to open its door. Do not call navigateTo or findInteractionPose separately. If it fails with STALL and current-contact-at-failure evidence, stop immediately and report the named blocker candidate as current physical contact evidence. Do not claim it is the uniquely proven root cause. Do not move the blocker and do not use any low-level open/pickup/place tool.',
    world:[
      { id:'agent_01', asset:'agent', position:[0,0,4], actions:['navigate'] },
      { id:'cabinet_01', asset:'cabinet', position:[0,0,0], actions:['open','close','move'] },
      { id:'obstacle_03', asset:'blocker', position:[-.64,1,1.08], actions:['move'] }
    ],
    expected:'approachAndInteract'
  }
,
  recovery: {
    goal:'Open cabinet_01 with agent_01 using approachAndInteract. The first attempt will STALL with current-contact evidence for obstacle_03. Then call suggestRecoveryActions for that failed cabinet Part. If it returns an eligible recoverPickupBlocker proposal, execute that exact high-level recovery. Recovery success only means the blocker is held; do NOT claim the cabinet task is complete. Fresh-replan and retry the original approachAndInteract open. Only action-completed + targetReached + settled on that retry means success. Never use low-level open/pickup/place, moveObject, navigateTo, or direct approachAndPickup for the blocker.',
    world:[
      { id:'agent_01', asset:'agent', position:[0,0,4], actions:['navigate'] },
      { id:'cabinet_01', asset:'cabinet', position:[0,0,0], actions:['open','close','move'] },
      { id:'obstacle_03', asset:'recovery-blocker', position:[-.64,0,1.08], actions:['pickup','drop','move'] }
    ],
    expected:['approachAndInteract','suggestRecoveryActions','recoverPickupBlocker']
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
  let sequenceDoorOpen=false, sequenceHeld=false, sequencePlaced=false, sequenceAttemptedOpen=false, recoveryApplied=false;
  const sequenceEvents=[];
  const tools = {
    definitions:() => registry.definitions(),
    executionPolicy:(name,result) => registry.executionPolicy(name,result),
    recordSequence:(payload) => sequenceEvents.push(payload),
    call:async(name, args = {}) => {
      if (name === 'listObjects') return scenario.world;
      toolCalls.push({ name, args });
      if (mode === 'sequence' || mode === 'sequence-failure' || mode === 'attribution' || mode === 'recovery') {
        if (name === 'findInteractionPose') return {status:'approach-pose',position:[0,0,args.targetId==='cabinet_01'?1:1.2],routeCost:2,distance:.7,lineOfSight:{hit:{id:args.targetId}}};
        if (name === 'getBounds') {
          const map={
            agent_01:{id:'agent_01',min:[-.32,0,3.68],max:[.32,1.7,4.32],center:[0,.85,4],size:[.64,1.7,.64]},
            obstacle_03:{id:'obstacle_03',min:[-.82,0,.9],max:[-.46,2,1.26],center:[-.64,1,1.08],size:[.36,2,.36]},
            cabinet_01:{id:'cabinet_01',min:[-.85,0,-.36],max:[.85,2,.43],center:[0,1,.035],size:[1.7,2,.79]},
            cup_01:{id:'cup_01',min:[1.65,0,1.05],max:[1.95,.32,1.35],center:[1.8,.16,1.2],size:[.3,.32,.3]},
            table_01:{id:'table_01',min:[2.1,0,0.875],max:[4.3,1.1,1.925],center:[3.2,.55,1.4],size:[2.2,1.1,1.05]}
          }; return map[args.id] || null;
        }
        if (name === 'findNearby') return scenario.world.filter((item)=>item.id!==args.id).map((item,index)=>({...item,distance:index+1}));
        if (name === 'findSupportSurface') return {targetId:'table_01',id:'top',center:[3.2,1.1,1.4],size:[2.2,1.05]};
        if (name === 'findFreeSpace') return [3.2,1.13,1.4];
        if (name === 'canReach') return {reachable:true,cost:2};
        if (name === 'findPath') return {reachable:true,path:[args.start,args.end],cost:2,end:{snapped:args.end}};
        if (name === 'getNavigationStatus') return {state:'ready',scope:'current'};
        if (name === 'getArticulationStatus') {
          const failed=sequenceAttemptedOpen&&!sequenceDoorOpen&&(mode==='sequence-failure'||mode==='attribution'||mode==='recovery');
          const attribution=(mode==='attribution'||mode==='recovery')?{
            status:'contact-evidence',evidence:'current-contact-at-failure',
            blockerCandidates:[{kind:'object',objectId:'obstacle_03',partName:'$root',colliderIndex:0}],
            contactEvidence:[{source:{kind:'object',objectId:'cabinet_01',partName:'door',colliderIndex:0},target:{kind:'object',objectId:'obstacle_03',partName:'$root',colliderIndex:0},external:true,contactCount:2,activeContactCount:2,minDistance:-.004,totalImpulse:3.1,normal:[1,0,0]}]
          }:undefined;
          return {id:'cabinet_01',parts:[{partName:'door',status:sequenceDoorOpen?'action-completed':(failed?'action-failed':'verified-state'),verifiedAction:sequenceDoorOpen?'open':'close',requestedAction:null,last:failed?{status:'action-failed',reason:'STALL',targetReached:false,settled:false,...(attribution?{attribution}:{})}:undefined,live:{coordinate:sequenceDoorOpen?-1.31:(sequenceAttemptedOpen?-.42:0),target:sequenceDoorOpen?-1.35:0,error:sequenceDoorOpen?.04:(sequenceAttemptedOpen?.42:0),tolerance:.08,coordinateReference:'rest-zero-pose'}}]};
        }
        if (name === 'getCarryStatus') {
          if (mode==='recovery' && recoveryApplied) return {status:'held',actorId:'agent_01',targetId:'obstacle_03',attachment:'kinematic-anchor',graspVerified:false};
          return sequenceHeld
            ? {status:'held',actorId:'agent_01',targetId:'cup_01',attachment:'kinematic-anchor',graspVerified:false}
            : {status:'empty',actorId:'agent_01'};
        }
        if (name === 'listRelations') return sequencePlaced ? [{subject:'cup_01',predicate:'ON',object:'table_01',surfaceId:'top'}] : [];
        if (name === 'describeObjectRelations') return sequencePlaced && args.id==='cup_01' ? {id:'cup_01',outgoing:[{predicate:'ON',object:'table_01'}],incoming:[]} : {id:args.id,outgoing:[],incoming:[]};
        if (name === 'approachAndInteract') {
          if (args.actorId!=='agent_01'||args.targetId!=='cabinet_01'||args.action!=='open') throw Object.assign(new Error('Sequence open arguments invalid'),{code:'PROBE_BAD_ARGUMENTS'});
          sequenceAttemptedOpen=true;
          const failRecoveryFirst=mode==='recovery'&&!recoveryApplied;
          if (mode==='sequence-failure'||mode==='attribution'||failRecoveryFirst) {
            const attribution=(mode==='attribution'||mode==='recovery')?{
              status:'contact-evidence',evidence:'current-contact-at-failure',
              blockerCandidates:[{kind:'object',objectId:'obstacle_03',partName:'$root',colliderIndex:0}],
              contactEvidence:[{source:{kind:'object',objectId:'cabinet_01',partName:'door',colliderIndex:0},target:{kind:'object',objectId:'obstacle_03',partName:'$root',colliderIndex:0},external:true,contactCount:2,activeContactCount:2,minDistance:-.004,totalImpulse:3.1,normal:[1,0,0]}]
            }:undefined;
            return {status:'action-failed',reason:'STALL',partName:'door',actorId:'agent_01',targetId:'cabinet_01',action:'open',targetReached:false,settled:false,statePromoted:false,stateFinalized:true,coordinate:-.42,error:.93,tolerance:.08,coordinateReference:'rest-zero-pose',...(attribution?{attribution}:{})};
          }
          if (mode==='recovery'&&!recoveryApplied) throw Object.assign(new Error('Recovery retry occurred before recovery mutation'),{code:'PROBE_RECOVERY_ORDER'});
          if (sequenceDoorOpen) return {status:'action-completed',partName:'door',targetReached:true,settled:true,statePromoted:true,alreadyOpen:true};
          sequenceDoorOpen=true;
          return {status:'action-completed',partName:'door',actorId:'agent_01',targetId:'cabinet_01',action:'open',targetReached:true,settled:true,statePromoted:true,coordinate:-1.31,error:.04,tolerance:.08,coordinateReference:'rest-zero-pose'};
        }
        if (name === 'suggestRecoveryActions' && mode==='recovery') {
          if (!sequenceAttemptedOpen || recoveryApplied) throw Object.assign(new Error('Recovery suggestion requested outside failed-open state'),{code:'PROBE_RECOVERY_ORDER'});
          return {
            status:'recovery-proposed',actorId:'agent_01',targetId:'cabinet_01',partName:'door',originalAction:'open',evidence:'current-contact-at-failure',
            proposals:[{
              blocker:{kind:'object',objectId:'obstacle_03',partName:'$root',colliderIndex:0},eligible:true,status:'provisional',recovery:'pickup-blocker',evidence:'current-contact-at-failure',
              policy:{allow:true,profile:'builder',missing:[]},preflight:{pose:{status:'approach-pose',position:[-.8,0,1.2]},transfer:{clear:true}},
              tool:'recoverPickupBlocker',args:{actorId:'agent_01',targetId:'cabinet_01',partName:'door',blockerId:'obstacle_03'},
              verification:{required:'retry-original-post-condition',tool:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'open',partName:'door'},success:{status:'action-completed',targetReached:true,settled:true}}
            }]
          };
        }
        if (name === 'recoverPickupBlocker' && mode==='recovery') {
          if (!sequenceAttemptedOpen || recoveryApplied) throw Object.assign(new Error('Recovery mutation order invalid'),{code:'PROBE_RECOVERY_ORDER'});
          if (args.actorId!=='agent_01'||args.targetId!=='cabinet_01'||args.partName!=='door'||args.blockerId!=='obstacle_03') throw Object.assign(new Error('Recovery arguments invalid'),{code:'PROBE_BAD_ARGUMENTS'});
          recoveryApplied=true;
          return {
            status:'held',actorId:'agent_01',targetId:'obstacle_03',attachment:'kinematic-anchor',graspVerified:false,transfer:{clear:true},
            recovery:{kind:'pickup-blocker',blockerId:'obstacle_03',evidence:'current-contact-at-failure'},retryOriginal:true,
            verification:{required:'retry-original-post-condition',tool:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'open',partName:'door'},success:{status:'action-completed',targetReached:true,settled:true}}
          };
        }
        if (name === 'approachAndPickup') {
          if (mode==='recovery') throw Object.assign(new Error('Recovery probe rejects direct approachAndPickup; use recoverPickupBlocker proposal'),{code:'PROBE_RECOVERY_LOW_LEVEL_REJECTED'});
          if (!sequenceDoorOpen) throw Object.assign(new Error('Sequence tried pickup before verified open'),{code:'PROBE_SEQUENCE_ORDER'});
          if (args.actorId!=='agent_01'||args.targetId!=='cup_01') throw Object.assign(new Error('Sequence pickup arguments invalid'),{code:'PROBE_BAD_ARGUMENTS'});
          sequenceHeld=true;
          return {status:'held',actorId:'agent_01',targetId:'cup_01',attachment:'kinematic-anchor',graspVerified:false,transfer:{clear:true}};
        }
        if (name === 'approachAndPlace') {
          if (!sequenceHeld) throw Object.assign(new Error('Sequence tried place before verified held ownership'),{code:'PROBE_SEQUENCE_ORDER'});
          if (args.actorId!=='agent_01'||args.supportId!=='table_01') throw Object.assign(new Error('Sequence place arguments invalid'),{code:'PROBE_BAD_ARGUMENTS'});
          sequenceHeld=false; sequencePlaced=true;
          return {status:'placed',actorId:'agent_01',targetId:'table_01',heldId:'cup_01',supportVerified:true,settled:true,stillHeld:false,support:{on:true,surfaceId:'top',gap:.002}};
        }
        if (['open','pickup','place','navigateTo','moveObject','dropHeld'].includes(name)) throw Object.assign(new Error(`Sequence probe rejects ${name}; use the verified embodied abstraction`),{code:'PROBE_SEQUENCE_LOW_LEVEL_REJECTED'});
      }
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
  const agent = new ToolCallingAgent({ tools, gateway, fallbackGateway:null, maxSteps:(mode.startsWith('sequence')||mode==='recovery')?12:8, log:trace ? (message,type)=>console.error(`[${type}] ${message}`) : ()=>{} });
  const result = await agent.run(scenario.goal);
  const expectedTools=Array.isArray(scenario.expected)?scenario.expected:[scenario.expected];
  for (const expected of expectedTools) if (!toolCalls.some((call)=>call.name===expected)) {
    throw new Error(`Model did not use ${expected} for the ${mode} probe`);
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
  if (mode === 'sequence') {
    const mutations=toolCalls.filter((call)=>['approachAndInteract','approachAndPickup','approachAndPlace'].includes(call.name)).map((call)=>call.name);
    if (JSON.stringify(mutations)!==JSON.stringify(['approachAndInteract','approachAndPickup','approachAndPlace'])) throw new Error(`Unexpected executed mutation order: ${mutations.join(' -> ')}`);
    if (!sequenceDoorOpen||sequenceHeld||!sequencePlaced) throw new Error(`Sequence world state incomplete: open=${sequenceDoorOpen} held=${sequenceHeld} placed=${sequencePlaced}`);
    if (result.taskStatus!=='completed') throw new Error(`Sequence taskStatus is ${result.taskStatus}, expected completed`);
    if (toolCalls.some((call)=>['open','pickup','place','navigateTo','moveObject','dropHeld'].includes(call.name))) throw new Error('Sequence used a forbidden low-level mutation');
  }
  if (mode === 'attribution') {
    if (!sequenceAttemptedOpen) throw new Error('Attribution probe never attempted embodied open');
    if (toolCalls.some((call)=>['open','pickup','place','approachAndPickup','approachAndPlace','moveObject','navigateTo'].includes(call.name))) throw new Error('Attribution probe performed a forbidden mutation');
    if (result.taskStatus!=='incomplete') throw new Error(`Attribution taskStatus is ${result.taskStatus}, expected incomplete`);
    if (!/obstacle_03/i.test(result.message || '')) throw new Error(`Attribution final did not name obstacle_03: ${result.message}`);
    if (!/(contact|接触|candidate|候选)/i.test(result.message || '')) throw new Error(`Attribution final did not frame obstacle_03 as contact evidence: ${result.message}`);
  }
  if (mode === 'recovery') {
    const mutations=toolCalls.filter((call)=>['approachAndInteract','recoverPickupBlocker','approachAndPickup','moveObject','open','pickup','place'].includes(call.name)).map((call)=>call.name);
    if (JSON.stringify(mutations)!==JSON.stringify(['approachAndInteract','recoverPickupBlocker','approachAndInteract'])) throw new Error(`Unexpected recovery mutation order: ${mutations.join(' -> ')}`);
    const suggestIndex=toolCalls.findIndex((call)=>call.name==='suggestRecoveryActions');
    const recoveryIndex=toolCalls.findIndex((call)=>call.name==='recoverPickupBlocker');
    if (suggestIndex<0 || suggestIndex>recoveryIndex) throw new Error('Recovery mutation was not preceded by suggestRecoveryActions');
    if (!recoveryApplied||!sequenceDoorOpen) throw new Error(`Recovery world state incomplete: recoveryApplied=${recoveryApplied} open=${sequenceDoorOpen}`);
    if (result.taskStatus!=='completed'||result.unresolvedMutations.length) throw new Error(`Recovery task did not resolve original open: status=${result.taskStatus} unresolved=${result.unresolvedMutations.length}`);
    if (toolCalls.some((call)=>['open','pickup','place','moveObject','navigateTo','approachAndPickup'].includes(call.name))) throw new Error('Recovery probe used a forbidden bypass mutation');
    const executed=result.execution.filter((entry)=>entry.executed&&entry.mutates);
    if (!executed.find((entry)=>entry.tool==='recoverPickupBlocker'&&entry.auxiliary===true&&entry.outcome.state==='verified')) throw new Error('Recovery mutation was not recorded as verified auxiliary execution');
  }
  if (mode === 'sequence-failure') {
    if (!sequenceAttemptedOpen) throw new Error('Failure sequence never attempted embodied open');
    if (toolCalls.some((call)=>['approachAndPickup','approachAndPlace','pickup','place'].includes(call.name))) throw new Error('Failure sequence advanced past failed open');
    if (result.taskStatus!=='incomplete') throw new Error(`Failure sequence taskStatus is ${result.taskStatus}, expected incomplete`);
    if (!result.unresolvedMutations.some((entry)=>entry.tool==='approachAndInteract'&&entry.outcome.state==='failed')) throw new Error('Failure sequence lost unresolved open failure');
    if (result.unresolvedMutations.length!==1) throw new Error(`Failure sequence accumulated ${result.unresolvedMutations.length} unresolved mutations; expected one semantic open failure`);
    if (result.termination && !['recovery-observation-limit','planning-limit'].includes(result.termination)) throw new Error(`Unexpected failure termination: ${result.termination}`);
  }
  console.log(JSON.stringify({ ok:true, mode, model, toolCalls, final:result.message, steps:result.steps, taskStatus:result.taskStatus, execution:result.execution, sequenceEvents }, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
}
