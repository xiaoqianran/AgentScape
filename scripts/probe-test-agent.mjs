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
,
  'recovery-multi': {
    goal:'Open cabinet_01 with agent_01. The first approachAndInteract will STALL with two current-contact blocker candidates. Call suggestRecoveryActions and follow exactly its recommended rank-1 proposal. The ranking is execution-cost evidence only, not causal proof. Execute at most one recovery mutation from this failure evidence epoch, then immediately retry the original approachAndInteract open. Only the retried original action-completed + targetReached + settled means task success. Do not recover the other candidate first, and never use moveObject, navigateTo, direct approachAndPickup, or low-level open/pickup/place.',
    world:[
      { id:'agent_01', asset:'agent', position:[0,0,4], actions:['navigate'] },
      { id:'cabinet_01', asset:'cabinet', position:[0,0,0], actions:['open','close','move'] },
      { id:'obstacle_01', asset:'recovery-blocker', position:[-1.2,0,1.2], actions:['pickup','drop','move'] },
      { id:'obstacle_02', asset:'recovery-blocker', position:[-.5,0,1.1], actions:['pickup','drop','move'] }
    ],
    expected:['approachAndInteract','suggestRecoveryActions','recoverPickupBlocker']
  }
,
  'recovery-cleanup': {
    goal:'Open cabinet_01 with verified recovery across two blockers. First call approachAndInteract; it will STALL with obstacle_01 and obstacle_02. Use suggestRecoveryActions and recover only its rank-1 obstacle_02. Immediately retry the original open; it will still STALL on obstacle_01 while obstacle_02 is held. Call suggestRecoveryActions again. Because hands are full with a prior recovery blocker, follow cleanupRecommended using cleanupRecoveryBlocker (suggestRecoveryCleanup is optional diagnosis). recovery-cleaned only means housekeeping succeeded, not cabinet success. Fresh-replan, call suggestRecoveryActions again, recover obstacle_01, then retry the original approachAndInteract. Only final action-completed + targetReached + settled means success. Never use dropHeld, moveObject, navigateTo, direct approachAndPickup/approachAndPlace, or low-level open/pickup/place.',
    world:[
      { id:'agent_01', asset:'agent', position:[0,0,4], actions:['navigate'] },
      { id:'cabinet_01', asset:'cabinet', position:[0,0,0], actions:['open','close','move'] },
      { id:'obstacle_01', asset:'recovery-blocker', position:[-1.2,0,1.2], actions:['pickup','drop','move'] },
      { id:'obstacle_02', asset:'recovery-blocker', position:[-.5,0,1.1], actions:['pickup','drop','move'] }
    ],
    expected:['approachAndInteract','suggestRecoveryActions','recoverPickupBlocker','cleanupRecoveryBlocker']
  }
,
  'recovery-articulated': {
    goal:'Open cabinet_A with agent_01 using approachAndInteract. The first attempt will STALL with current-contact-at-failure evidence that cabinet_B/door is blocking it. Call suggestRecoveryActions. Follow exactly the eligible recommended recoverArticulatedBlocker proposal: cabinet_B door is currently verified open and the unique alternate executable action is close. Do not directly call approachAndInteract on cabinet_B; the recovery must go through recoverArticulatedBlocker so Runtime can revalidate contact/state/Policy at execution time. After blocker recovery is action-completed + targetReached + settled, do not claim the original task is complete: fresh-replan and retry the original approachAndInteract open on cabinet_A. Only that original retry being action-completed + targetReached + settled means success. Never use low-level open/close, moveObject, navigateTo, pickup/place, or direct recovery bypasses.',
    world:[
      { id:'agent_01', asset:'agent', position:[2.5,0,4], actions:['navigate'] },
      { id:'cabinet_A', asset:'cabinet', position:[0,0,0], actions:['open','close','move'] },
      { id:'cabinet_B', asset:'cabinet', position:[-2.2,0,1], actions:['open','close','move'] }
    ],
    expected:['approachAndInteract','suggestRecoveryActions','recoverArticulatedBlocker']
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
  let multiAttemptedOpen=false,multiRecoveredBlocker=null,multiDoorOpen=false;
  let cleanupOpenAttempts=0,cleanupHeld=null,cleanupFirstDone=false,cleanupFirstCleaned=false,cleanupSecondDone=false,cleanupDoorOpen=false;
  let articulatedAttemptedOpen=false,articulatedBlockerClosed=false,articulatedDoorOpen=false;
  const sequenceEvents=[];
  const tools = {
    definitions:() => registry.definitions(),
    executionPolicy:(name,result) => registry.executionPolicy(name,result),
    recordSequence:(payload) => sequenceEvents.push(payload),
    call:async(name, args = {}) => {
      if (name === 'listObjects') return scenario.world;
      toolCalls.push({ name, args });
      if (mode === 'recovery-articulated') {
        const blocker={kind:'object',objectId:'cabinet_B',partName:'door',colliderIndex:0};
        const contact={
          source:{kind:'object',objectId:'cabinet_A',partName:'door',colliderIndex:0},target:blocker,external:true,
          contactCount:4,activeContactCount:2,minDistance:-.0012,totalImpulse:.45,normal:[1,0,0]
        };
        const attribution={status:'contact-evidence',evidence:'current-contact-at-failure',blockerCandidates:[blocker],contactEvidence:[contact]};
        if (name === 'getArticulationStatus') {
          if (args.id==='cabinet_B') return {id:'cabinet_B',parts:[{
            partName:'door',status:'verified-state',requestedAction:null,verifiedAction:articulatedBlockerClosed?'close':'open',
            live:{coordinate:articulatedBlockerClosed?0:-1.35,target:articulatedBlockerClosed?0:-1.35,error:0,tolerance:.08,coordinateReference:'rest-zero-pose'}
          }]};
          if (args.id==='cabinet_A') return {id:'cabinet_A',parts:[{
            partName:'door',status:articulatedDoorOpen?'action-completed':(articulatedAttemptedOpen?'action-failed':'verified-state'),
            requestedAction:null,verifiedAction:articulatedDoorOpen?'open':'close',
            last:articulatedAttemptedOpen&&!articulatedDoorOpen?{status:'action-failed',reason:'STALL',targetReached:false,settled:false,action:'open',attribution}:undefined,
            live:{coordinate:articulatedDoorOpen?-1.35:(articulatedAttemptedOpen?-1.02:0),target:articulatedDoorOpen?-1.35:0,error:articulatedDoorOpen?0:(articulatedAttemptedOpen?.33:0),tolerance:.08,coordinateReference:'rest-zero-pose'}
          }]};
        }
        if (name === 'approachAndInteract') {
          if (args.targetId==='cabinet_B') throw Object.assign(new Error('Articulated recovery probe requires recoverArticulatedBlocker wrapper for cabinet_B'),{code:'PROBE_RECOVERY_BYPASS'});
          if (args.actorId!=='agent_01'||args.targetId!=='cabinet_A'||args.action!=='open') throw Object.assign(new Error('Articulated original action arguments invalid'),{code:'PROBE_BAD_ARGUMENTS'});
          articulatedAttemptedOpen=true;
          if (!articulatedBlockerClosed) return {
            status:'action-failed',reason:'STALL',partName:'door',actorId:'agent_01',targetId:'cabinet_A',action:'open',
            targetReached:false,settled:false,stateFinalized:true,coordinate:-1.02,error:.33,tolerance:.08,coordinateReference:'rest-zero-pose',attribution
          };
          articulatedDoorOpen=true;
          return {status:'action-completed',partName:'door',actorId:'agent_01',targetId:'cabinet_A',action:'open',targetReached:true,settled:true,statePromoted:true,coordinate:-1.35,error:0,tolerance:.08,coordinateReference:'rest-zero-pose'};
        }
        if (name === 'suggestRecoveryActions') {
          if (!articulatedAttemptedOpen||articulatedBlockerClosed||articulatedDoorOpen) throw Object.assign(new Error('Articulated suggestion requested outside first failed evidence epoch'),{code:'PROBE_RECOVERY_ORDER'});
          const proposal={
            blocker,candidateType:'articulated-part',eligible:true,status:'provisional',recovery:'articulated-blocker',evidence:'current-contact-at-failure',rank:1,
            currentContact:{pairCount:1,contactCount:4,activeContactCount:2,minDistance:-.0012,totalImpulse:.45,colliderIndices:[0]},
            blockerState:{partName:'door',status:'verified-state',requestedAction:null,verifiedAction:'open',live:{coordinate:-1.35,target:-1.35,error:0,tolerance:.08,coordinateReference:'rest-zero-pose'}},
            blockerAction:'close',policy:{allow:true,profile:'builder',missing:[]},
            preflight:{pose:{status:'approach-pose',position:[-3,0,-.3],routeCost:2.2,actionSweep:{checked:true,clear:true,partName:'door'}},actionSweep:{checked:true,clear:true,partName:'door'}},
            rankingEvidence:{causal:false,recoveryRouteCost:2.2},
            tool:'recoverArticulatedBlocker',args:{actorId:'agent_01',targetId:'cabinet_A',partName:'door',blockerId:'cabinet_B',blockerPartName:'door',blockerAction:'close'},
            verification:{required:'retry-original-post-condition',tool:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_A',action:'open',partName:'door'},success:{status:'action-completed',targetReached:true,settled:true}}
          };
          return {
            status:'recovery-proposed',actorId:'agent_01',targetId:'cabinet_A',partName:'door',originalAction:'open',evidence:'current-contact-at-failure',
            ranking:{strategy:'eligible-recovery-route-cost-v2',causal:false,criteria:['eligible','recoveryRouteCostAsc','stableBlockerKeyAsc']},
            recommended:{rank:1,blocker,tool:'recoverArticulatedBlocker',args:proposal.args},proposals:[proposal]
          };
        }
        if (name === 'recoverArticulatedBlocker') {
          if (!articulatedAttemptedOpen||articulatedBlockerClosed) throw Object.assign(new Error('Articulated recovery mutation order invalid'),{code:'PROBE_RECOVERY_ORDER'});
          if (args.actorId!=='agent_01'||args.targetId!=='cabinet_A'||args.partName!=='door'||args.blockerId!=='cabinet_B'||args.blockerPartName!=='door'||args.blockerAction!=='close') throw Object.assign(new Error('Articulated recovery arguments invalid'),{code:'PROBE_BAD_ARGUMENTS'});
          articulatedBlockerClosed=true;
          return {
            status:'action-completed',partName:'door',actorId:'agent_01',targetId:'cabinet_B',action:'close',targetReached:true,settled:true,statePromoted:true,coordinate:0,error:0,tolerance:.08,coordinateReference:'rest-zero-pose',
            recovery:{kind:'articulated-blocker',blockerId:'cabinet_B',blockerPartName:'door',blockerAction:'close',evidence:'current-contact-at-failure'},retryOriginal:true,
            verification:{required:'retry-original-post-condition',tool:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_A',action:'open',partName:'door'},success:{status:'action-completed',targetReached:true,settled:true}}
          };
        }
        if (['open','close','pickup','place','moveObject','navigateTo','approachAndPickup','approachAndPlace','dropHeld','recoverPickupBlocker'].includes(name)) throw Object.assign(new Error(`Articulated recovery probe rejects bypass ${name}`),{code:'PROBE_RECOVERY_LOW_LEVEL_REJECTED'});
        throw Object.assign(new Error(`Probe does not allow ${name} in recovery-articulated mode`),{code:'PROBE_TOOL_NOT_ALLOWED'});
      }
        if (mode === 'recovery-cleanup') {
        const first={kind:'object',objectId:'obstacle_01',partName:'$root',colliderIndex:0};
        const second={kind:'object',objectId:'obstacle_02',partName:'$root',colliderIndex:0};
        const contactsFor=(candidates)=>candidates.map((target,index)=>({
          source:{kind:'object',objectId:'cabinet_01',partName:'door',colliderIndex:0},target,external:true,
          contactCount:index?1:3,activeContactCount:index?1:3,minDistance:index?-.002:-.012,totalImpulse:index?2:30,normal:index?[0,0,1]:[1,0,0]
        }));
        const failedCandidates=()=>cleanupOpenAttempts<=1?[first,second]:[first];
        const failedReport=()=>({status:'contact-evidence',evidence:'current-contact-at-failure',blockerCandidates:failedCandidates(),contactEvidence:contactsFor(failedCandidates())});
        const proposal=(blocker,rank,routeCost)=>({
          blocker,candidateType:'object-root',eligible:true,status:'provisional',recovery:'pickup-blocker',evidence:'current-contact-at-failure',rank,
          currentContact:{pairCount:1,contactCount:1,activeContactCount:1,minDistance:-.002,totalImpulse:2,colliderIndices:[0]},
          policy:{allow:true,profile:'builder',missing:[]},preflight:{pose:{status:'approach-pose',position:[0,0,1],routeCost},transfer:{clear:true}},rankingEvidence:{causal:false,pickupRouteCost:routeCost},
          tool:'recoverPickupBlocker',args:{actorId:'agent_01',targetId:'cabinet_01',partName:'door',blockerId:blocker.objectId},
          verification:{required:'retry-original-post-condition',tool:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'open',partName:'door'},success:{status:'action-completed',targetReached:true,settled:true}}
        });
        const cleanupPlan={status:'cleanup-proposed',actorId:'agent_01',targetId:'cabinet_01',partName:'door',action:'open',blockerId:'obstacle_02',pose:{status:'approach-pose',position:[2,0,2],routeCost:1},release:[2,.05,2],support:{environment:true,point:[2,0,2]},actionSweep:{checked:true,partName:'door'},preflight:{sweepClear:true,endpointClear:true,releaseDistance:.8}};
        if (name === 'getCarryStatus') return cleanupHeld?{status:'held',actorId:'agent_01',targetId:cleanupHeld,attachment:'kinematic-anchor',graspVerified:false}:{status:'empty',actorId:'agent_01'};
        if (name === 'getArticulationStatus') return {
          id:'cabinet_01',parts:[{partName:'door',status:cleanupDoorOpen?'action-completed':(cleanupOpenAttempts?'action-failed':'verified-state'),verifiedAction:cleanupDoorOpen?'open':'close',requestedAction:null,
            last:cleanupOpenAttempts&&!cleanupDoorOpen?{status:'action-failed',reason:'STALL',targetReached:false,settled:false,attribution:failedReport()}:undefined,
            live:{coordinate:cleanupDoorOpen?-1.31:(cleanupOpenAttempts?-.42:0),target:cleanupDoorOpen?-1.35:0,error:cleanupDoorOpen?.04:(cleanupOpenAttempts?.93:0),tolerance:.08,coordinateReference:'rest-zero-pose'}}]
        };
        if (name === 'approachAndInteract') {
          if (args.actorId!=='agent_01'||args.targetId!=='cabinet_01'||args.action!=='open') throw Object.assign(new Error('Cleanup recovery open arguments invalid'),{code:'PROBE_BAD_ARGUMENTS'});
          cleanupOpenAttempts++;
          if (cleanupSecondDone) {
            cleanupDoorOpen=true;
            return {status:'action-completed',partName:'door',actorId:'agent_01',targetId:'cabinet_01',action:'open',targetReached:true,settled:true,statePromoted:true,coordinate:-1.31,error:.04,tolerance:.08,coordinateReference:'rest-zero-pose'};
          }
          if (cleanupOpenAttempts===1 || cleanupFirstDone) return {status:'action-failed',reason:'STALL',partName:'door',actorId:'agent_01',targetId:'cabinet_01',action:'open',targetReached:false,settled:false,stateFinalized:true,coordinate:-.42,error:.93,tolerance:.08,coordinateReference:'rest-zero-pose',attribution:failedReport()};
          throw Object.assign(new Error('Cleanup recovery original retry occurred out of order'),{code:'PROBE_RECOVERY_ORDER'});
        }
        if (name === 'suggestRecoveryActions') {
          if (!cleanupOpenAttempts || cleanupDoorOpen) throw Object.assign(new Error('Cleanup recovery suggestion outside failed state'),{code:'PROBE_RECOVERY_ORDER'});
          if (!cleanupFirstDone) {
            const p2=proposal(second,1,2),p1=proposal(first,2,5);
            return {status:'recovery-proposed',actorId:'agent_01',targetId:'cabinet_01',partName:'door',originalAction:'open',evidence:'current-contact-at-failure',ranking:{strategy:'eligible-recovery-route-cost-v2',causal:false,criteria:['eligible','recoveryRouteCostAsc','stableBlockerKeyAsc']},recommended:{rank:1,blocker:second,tool:'recoverPickupBlocker',args:p2.args},proposals:[p2,p1]};
          }
          if (!cleanupFirstCleaned) {
            const blocked={...proposal(first,undefined,undefined),eligible:false,status:'ineligible',reason:'HANDS_FULL'}; delete blocked.rank; delete blocked.rankingEvidence;
            return {status:'recovery-cleanup-proposed',actorId:'agent_01',targetId:'cabinet_01',partName:'door',originalAction:'open',evidence:'current-contact-at-failure',ranking:{strategy:'eligible-recovery-route-cost-v2',causal:false,criteria:['eligible','recoveryRouteCostAsc','stableBlockerKeyAsc']},recommended:null,cleanupRecommended:{status:'provisional',reason:'HANDS_FULL_WITH_RECOVERY_BLOCKER',blockerId:'obstacle_02',tool:'cleanupRecoveryBlocker',args:{actorId:'agent_01',targetId:'cabinet_01',partName:'door',action:'open',blockerId:'obstacle_02'},plan:cleanupPlan,verification:{required:'replan-recovery-after-cleanup',cleanupStatus:'recovery-cleaned'}},proposals:[blocked]};
          }
          if (!cleanupSecondDone) {
            const p1=proposal(first,1,3);
            return {status:'recovery-proposed',actorId:'agent_01',targetId:'cabinet_01',partName:'door',originalAction:'open',evidence:'current-contact-at-failure',ranking:{strategy:'eligible-recovery-route-cost-v2',causal:false,criteria:['eligible','recoveryRouteCostAsc','stableBlockerKeyAsc']},recommended:{rank:1,blocker:first,tool:'recoverPickupBlocker',args:p1.args},proposals:[p1]};
          }
          throw Object.assign(new Error('Cleanup recovery suggestion requested after all blockers recovered'),{code:'PROBE_RECOVERY_ORDER'});
        }
        if (name === 'suggestRecoveryCleanup') {
          if (cleanupHeld!=='obstacle_02'||!cleanupFirstDone||cleanupFirstCleaned) throw Object.assign(new Error('Cleanup plan requested outside held-recovery state'),{code:'PROBE_RECOVERY_ORDER'});
          return cleanupPlan;
        }
        if (name === 'recoverPickupBlocker') {
          if (!cleanupFirstDone) {
            if (args.blockerId!=='obstacle_02') throw Object.assign(new Error(`Expected first ranked blocker obstacle_02, got ${args.blockerId}`),{code:'PROBE_RECOVERY_RANKING'});
            cleanupFirstDone=true; cleanupHeld='obstacle_02';
          } else if (cleanupFirstCleaned&&!cleanupSecondDone) {
            if (args.blockerId!=='obstacle_01') throw Object.assign(new Error(`Expected second blocker obstacle_01 after cleanup, got ${args.blockerId}`),{code:'PROBE_RECOVERY_RANKING'});
            cleanupSecondDone=true; cleanupHeld='obstacle_01';
          } else throw Object.assign(new Error('Cleanup recovery pickup order invalid'),{code:'PROBE_RECOVERY_ORDER'});
          return {status:'held',actorId:'agent_01',targetId:args.blockerId,attachment:'kinematic-anchor',graspVerified:false,transfer:{clear:true},recovery:{kind:'pickup-blocker',blockerId:args.blockerId,evidence:'current-contact-at-failure'},retryOriginal:true,verification:{required:'retry-original-post-condition',tool:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'open',partName:'door'},success:{status:'action-completed',targetReached:true,settled:true}}};
        }
        if (name === 'cleanupRecoveryBlocker') {
          if (args.blockerId!=='obstacle_02'||cleanupHeld!=='obstacle_02'||cleanupFirstCleaned||!cleanupFirstDone||cleanupOpenAttempts<2) throw Object.assign(new Error('Cleanup mutation order or arguments invalid'),{code:'PROBE_RECOVERY_ORDER'});
          cleanupFirstCleaned=true; cleanupHeld=null;
          return {status:'recovery-cleaned',actorId:'agent_01',targetId:'cabinet_01',blockerId:'obstacle_02',partName:'door',action:'open',released:true,settled:true,sweepClear:true,contactClear:true,stillHeld:false,release:[2,.05,2],recovery:{blockerId:'obstacle_02',targetId:'cabinet_01',partName:'door',action:'open'}};
        }
        if (['open','pickup','place','moveObject','navigateTo','approachAndPickup','approachAndPlace','dropHeld'].includes(name)) throw Object.assign(new Error(`Cleanup recovery probe rejects bypass ${name}`),{code:'PROBE_RECOVERY_LOW_LEVEL_REJECTED'});
        throw Object.assign(new Error(`Probe does not allow ${name} in recovery-cleanup mode`),{code:'PROBE_TOOL_NOT_ALLOWED'});
      }
  if (mode === 'recovery-multi') {
        const candidates=[
          {kind:'object',objectId:'obstacle_01',partName:'$root',colliderIndex:0},
          {kind:'object',objectId:'obstacle_02',partName:'$root',colliderIndex:0}
        ];
        const contactEvidence=[
          {source:{kind:'object',objectId:'cabinet_01',partName:'door',colliderIndex:0},target:candidates[0],external:true,contactCount:4,activeContactCount:4,minDistance:-.02,totalImpulse:100,normal:[1,0,0]},
          {source:{kind:'object',objectId:'cabinet_01',partName:'door',colliderIndex:0},target:candidates[1],external:true,contactCount:1,activeContactCount:1,minDistance:-.001,totalImpulse:1,normal:[0,0,1]}
        ];
        if (name === 'getArticulationStatus') return {
          id:'cabinet_01',parts:[{partName:'door',status:multiDoorOpen?'action-completed':(multiAttemptedOpen?'action-failed':'verified-state'),verifiedAction:multiDoorOpen?'open':'close',requestedAction:null,
            last:multiAttemptedOpen&&!multiDoorOpen?{status:'action-failed',reason:'STALL',targetReached:false,settled:false,attribution:{status:'contact-evidence',evidence:'current-contact-at-failure',blockerCandidates:candidates,contactEvidence}}:undefined,
            live:{coordinate:multiDoorOpen?-1.31:(multiAttemptedOpen?-.42:0),target:multiDoorOpen?-1.35:0,error:multiDoorOpen?.04:(multiAttemptedOpen?.93:0),tolerance:.08,coordinateReference:'rest-zero-pose'}}]
        };
        if (name === 'getCarryStatus') return multiRecoveredBlocker
          ? {status:'held',actorId:'agent_01',targetId:multiRecoveredBlocker,attachment:'kinematic-anchor',graspVerified:false}
          : {status:'empty',actorId:'agent_01'};
        if (name === 'approachAndInteract') {
          if (args.actorId!=='agent_01'||args.targetId!=='cabinet_01'||args.action!=='open') throw Object.assign(new Error('Multi recovery open arguments invalid'),{code:'PROBE_BAD_ARGUMENTS'});
          multiAttemptedOpen=true;
          if (!multiRecoveredBlocker) return {status:'action-failed',reason:'STALL',partName:'door',actorId:'agent_01',targetId:'cabinet_01',action:'open',targetReached:false,settled:false,stateFinalized:true,coordinate:-.42,error:.93,tolerance:.08,coordinateReference:'rest-zero-pose',attribution:{status:'contact-evidence',evidence:'current-contact-at-failure',blockerCandidates:candidates,contactEvidence}};
          if (multiRecoveredBlocker!=='obstacle_02') throw Object.assign(new Error(`Model recovered ${multiRecoveredBlocker}, expected recommended obstacle_02`),{code:'PROBE_RECOVERY_RANKING'});
          multiDoorOpen=true;
          return {status:'action-completed',partName:'door',actorId:'agent_01',targetId:'cabinet_01',action:'open',targetReached:true,settled:true,statePromoted:true,coordinate:-1.31,error:.04,tolerance:.08,coordinateReference:'rest-zero-pose'};
        }
        if (name === 'suggestRecoveryActions') {
          if (!multiAttemptedOpen||multiRecoveredBlocker) throw Object.assign(new Error('Multi recovery suggestion requested outside first failed evidence epoch'),{code:'PROBE_RECOVERY_ORDER'});
          const mk=(blocker,rank,routeCost)=>({
            blocker,candidateType:'object-root',eligible:true,status:'provisional',recovery:'pickup-blocker',evidence:'current-contact-at-failure',rank,
            currentContact:blocker.objectId==='obstacle_01'?{pairCount:1,contactCount:4,activeContactCount:4,minDistance:-.02,totalImpulse:100,colliderIndices:[0]}:{pairCount:1,contactCount:1,activeContactCount:1,minDistance:-.001,totalImpulse:1,colliderIndices:[0]},
            policy:{allow:true,profile:'builder',missing:[]},preflight:{pose:{status:'approach-pose',position:[0,0,1],routeCost},transfer:{clear:true}},rankingEvidence:{causal:false,pickupRouteCost:routeCost},
            tool:'recoverPickupBlocker',args:{actorId:'agent_01',targetId:'cabinet_01',partName:'door',blockerId:blocker.objectId},
            verification:{required:'retry-original-post-condition',tool:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'open',partName:'door'},success:{status:'action-completed',targetReached:true,settled:true}}
          });
          const proposals=[mk(candidates[1],1,2),mk(candidates[0],2,5)];
          return {status:'recovery-proposed',actorId:'agent_01',targetId:'cabinet_01',partName:'door',originalAction:'open',evidence:'current-contact-at-failure',ranking:{strategy:'eligible-recovery-route-cost-v2',causal:false,criteria:['eligible','recoveryRouteCostAsc','stableBlockerKeyAsc']},recommended:{rank:1,blocker:candidates[1],tool:'recoverPickupBlocker',args:proposals[0].args},proposals};
        }
        if (name === 'recoverPickupBlocker') {
          if (multiRecoveredBlocker) throw Object.assign(new Error('Multi recovery attempted more than one recovery before original retry'),{code:'PROBE_RECOVERY_ORDER'});
          if (args.blockerId!=='obstacle_02') throw Object.assign(new Error(`Model ignored recommended blocker: ${args.blockerId}`),{code:'PROBE_RECOVERY_RANKING'});
          multiRecoveredBlocker=args.blockerId;
          return {status:'held',actorId:'agent_01',targetId:args.blockerId,attachment:'kinematic-anchor',graspVerified:false,transfer:{clear:true},recovery:{kind:'pickup-blocker',blockerId:args.blockerId,evidence:'current-contact-at-failure'},retryOriginal:true,verification:{required:'retry-original-post-condition',tool:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'open',partName:'door'},success:{status:'action-completed',targetReached:true,settled:true}}};
        }
        if (['open','pickup','place','moveObject','navigateTo','approachAndPickup','approachAndPlace'].includes(name)) throw Object.assign(new Error(`Multi recovery probe rejects bypass ${name}`),{code:'PROBE_RECOVERY_LOW_LEVEL_REJECTED'});
        throw Object.assign(new Error(`Probe does not allow ${name} in recovery-multi mode`),{code:'PROBE_TOOL_NOT_ALLOWED'});
      }
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
  const agent = new ToolCallingAgent({ tools, gateway, fallbackGateway:null, maxSteps:(mode.startsWith('sequence')||mode==='recovery'||mode==='recovery-multi'||mode==='recovery-cleanup'||mode==='recovery-articulated')?16:8, log:trace ? (message,type)=>console.error(`[${type}] ${message}`) : ()=>{} });
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
  if (mode === 'recovery-articulated') {
    const mutations=toolCalls.filter((call)=>['approachAndInteract','recoverArticulatedBlocker','recoverPickupBlocker','moveObject','navigateTo','open','close','pickup','place'].includes(call.name));
    const names=mutations.map((call)=>call.name);
    if (JSON.stringify(names)!==JSON.stringify(['approachAndInteract','recoverArticulatedBlocker','approachAndInteract'])) throw new Error(`Unexpected articulated recovery mutation order: ${names.join(' -> ')}`);
    if (mutations[1]?.args?.blockerId!=='cabinet_B'||mutations[1]?.args?.blockerPartName!=='door'||mutations[1]?.args?.blockerAction!=='close') throw new Error('Articulated recovery did not follow the unique alternate action proposal');
    const suggestIndex=toolCalls.findIndex((call)=>call.name==='suggestRecoveryActions');
    const recoveryIndex=toolCalls.findIndex((call)=>call.name==='recoverArticulatedBlocker');
    if (suggestIndex<0||suggestIndex>recoveryIndex) throw new Error('Articulated recovery mutation was not preceded by suggestRecoveryActions');
    if (!articulatedBlockerClosed||!articulatedDoorOpen) throw new Error(`Articulated recovery world state incomplete: blockerClosed=${articulatedBlockerClosed} originalOpen=${articulatedDoorOpen}`);
    if (result.taskStatus!=='completed'||result.unresolvedMutations.length) throw new Error(`Articulated recovery task did not resolve original open: status=${result.taskStatus} unresolved=${result.unresolvedMutations.length}`);
    if (toolCalls.some((call)=>['open','close','pickup','place','moveObject','navigateTo','approachAndPickup','approachAndPlace','recoverPickupBlocker'].includes(call.name))) throw new Error('Articulated recovery used a forbidden bypass');
    const recoveryEntry=result.execution.find((entry)=>entry.tool==='recoverArticulatedBlocker'&&entry.executed);
    if (!recoveryEntry||recoveryEntry.auxiliary!==true||recoveryEntry.outcome.state!=='verified') throw new Error('Articulated recovery was not recorded as a verified auxiliary mutation');
  }
  if (mode === 'recovery-cleanup') {
    const mutations=toolCalls.filter((call)=>['approachAndInteract','recoverPickupBlocker','cleanupRecoveryBlocker','approachAndPickup','approachAndPlace','moveObject','dropHeld','open','pickup','place'].includes(call.name));
    const names=mutations.map((call)=>call.name);
    const expected=['approachAndInteract','recoverPickupBlocker','approachAndInteract','cleanupRecoveryBlocker','recoverPickupBlocker','approachAndInteract'];
    if (JSON.stringify(names)!==JSON.stringify(expected)) throw new Error(`Unexpected cleanup recovery mutation order: ${names.join(' -> ')}`);
    if (mutations[1]?.args?.blockerId!=='obstacle_02'||mutations[3]?.args?.blockerId!=='obstacle_02'||mutations[4]?.args?.blockerId!=='obstacle_01') throw new Error('Cleanup recovery used wrong blocker order');
    if (!cleanupFirstDone||!cleanupFirstCleaned||!cleanupSecondDone||!cleanupDoorOpen) throw new Error(`Cleanup recovery world state incomplete: first=${cleanupFirstDone} cleaned=${cleanupFirstCleaned} second=${cleanupSecondDone} open=${cleanupDoorOpen}`);
    if (result.taskStatus!=='completed'||result.unresolvedMutations.length) throw new Error(`Cleanup recovery task did not complete: status=${result.taskStatus} unresolved=${result.unresolvedMutations.length}`);
    if (toolCalls.some((call)=>['open','pickup','place','moveObject','navigateTo','approachAndPickup','approachAndPlace','dropHeld'].includes(call.name))) throw new Error('Cleanup recovery used a forbidden bypass');
    const executed=result.execution.filter((entry)=>entry.executed&&entry.mutates);
    const cleanupEntry=executed.find((entry)=>entry.tool==='cleanupRecoveryBlocker');
    if (!cleanupEntry||cleanupEntry.auxiliary!==true||cleanupEntry.outcome.state!=='verified') throw new Error('Cleanup mutation was not a verified auxiliary execution');
  }
  if (mode === 'recovery-multi') {
    const mutations=toolCalls.filter((call)=>['approachAndInteract','recoverPickupBlocker','approachAndPickup','moveObject','open','pickup','place'].includes(call.name));
    if (JSON.stringify(mutations.map((call)=>call.name))!==JSON.stringify(['approachAndInteract','recoverPickupBlocker','approachAndInteract'])) throw new Error(`Unexpected multi recovery mutation order: ${mutations.map((call)=>call.name).join(' -> ')}`);
    if (mutations[1]?.args?.blockerId!=='obstacle_02') throw new Error(`Multi recovery ignored recommended blocker: ${mutations[1]?.args?.blockerId}`);
    const suggest=toolCalls.find((call)=>call.name==='suggestRecoveryActions');
    if (!suggest) throw new Error('Multi recovery never requested ranked proposals');
    if (!multiDoorOpen||multiRecoveredBlocker!=='obstacle_02') throw new Error(`Multi recovery world state incomplete: recovered=${multiRecoveredBlocker} open=${multiDoorOpen}`);
    if (result.taskStatus!=='completed'||result.unresolvedMutations.length) throw new Error(`Multi recovery task did not complete: status=${result.taskStatus} unresolved=${result.unresolvedMutations.length}`);
    if (toolCalls.some((call)=>['open','pickup','place','moveObject','navigateTo','approachAndPickup','approachAndPlace'].includes(call.name))) throw new Error('Multi recovery used a forbidden bypass');
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
