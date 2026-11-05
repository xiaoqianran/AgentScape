import { performance } from 'node:perf_hooks';
import { mkdir,writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createTaskRuntime,driveWorld,settleWorld } from './worldHarness.mjs';
import { ToolCallingAgent } from '../../modules/agent/ToolCallingAgent.js';
import { CABINET_CUP_TASK_WORLDS,CABINET_CUP_TASK_CRITERIA,createCabinetCupTaskWorldIR,inspectCabinetCupTask } from '../../application/tasks/CabinetCupTask.js';

const summary = (result) => ({
  status:result?.status,reason:result?.reason || result?.error?.code || null,
  ...(result?.supportVerified != null ? {supportVerified:result.supportVerified,settled:result.settled} : {}),
  ...(result?.stillHeld != null ? {stillHeld:result.stillHeld} : {}),
  ...(result?.targetReached != null ? {targetReached:result.targetReached,settled:result.settled} : {}),
  ...(result?.verifiedCount != null ? {verifiedCount:result.verifiedCount,failedCount:result.failedCount,checks:result.checks} : {})
});

// Runtime-only acceptance: no model claims or script return values can satisfy a post-condition.
export async function runCabinetCupCase(worldId,{repeats=3,fault=null}={}) {
  const row={worldId,fault,repeats,mode:'scripted-gateway-real-runtime',attempts:[],passed:false};
  const handle=await createTaskRuntime(worldId);
  const {runtime,worldBuilder,tools}=handle;
  try {
    for (let index=0;index<repeats;index++) {
      const attempt={index:index+1,stages:[],passed:false};
      row.attempts.push(attempt);
      const stage=async(name,operation)=>{
        const started=performance.now();
        try {
          const result=await operation();
          attempt.stages.push({name,durationMs:Math.round(performance.now()-started),...summary(result)});
          return result;
        } catch(error) {
          attempt.stages.push({name,durationMs:Math.round(performance.now()-started),status:'error',reason:error.code || 'UNEXPECTED_ERROR',message:error.message});
          throw error;
        }
      };
      const plan=createCabinetCupTaskWorldIR(worldId,{revisionId:`acceptance-${worldId}-${index}`});
      if (fault === 'unreachable') plan.entities.find((entity)=>entity.id === 'agent_01').transform={position:[-.5,0,0]};
      const built=await stage('build',()=>worldBuilder.run(plan));
      attempt.admission={status:built.pipeline.state.reports.worldAdmission.status,reasons:built.pipeline.state.reports.worldAdmission.reasons};
      if (attempt.admission.status === 'rejected' || runtime.currentWorldRevision?.revision?.id !== plan.revision.id) throw new Error('Task build rejected or left an older world revision active');
      if (runtime.store.list().length !== 4) throw new Error('Standard task must instantiate exactly four objects');
      attempt.initialInside=runtime.spatial.containmentGeometry('cup_01','cabinet_01',{receptacleId:'interior'}).inside === true;
      await stage('settle-initial',async()=>{await settleWorld(runtime,90);return {status:'settled'};});
      attempt.settledInside=runtime.spatial.containmentGeometry('cup_01','cabinet_01',{receptacleId:'interior'}).inside === true;
      if (!attempt.initialInside || !attempt.settledInside) throw new Error('Cup must begin and remain inside the cabinet after settling');
      if (fault === 'missing-target') await tools.call('removeObject',{id:'cup_01'});
      const prerequisites=await stage('preflight',async()=>{
        const value=await inspectCabinetCupTask(runtime);
        return {...value,status:value.supported ? 'supported' : 'unsupported'};
      });
      attempt.prerequisites=prerequisites;
      if (fault === 'missing-target' || fault === 'unreachable') {
        attempt.passed=!prerequisites.supported && prerequisites.reasons.length>0;
        attempt.stoppedBeforeMutation=true;
        continue;
      }
      if (!prerequisites.supported) throw new Error(JSON.stringify(prerequisites.reasons));
      if (fault === 'blocked-door') {
        const p=runtime.physics.getPosition('cabinet_01');
        runtime.physics.addEnvironment([{shape:'box',halfExtents:[.18,1,.18],translation:[p[0]-.64,p[1]+1,p[2]+1.08]}],{id:'acceptance-door-blocker'});
      }
      const sequence=[
        ['approachAndInteract',{actorId:'agent_01',targetId:'cabinet_01',action:'open'}],
        ['approachAndPickup',{actorId:'agent_01',targetId:'cup_01'}],
        ['approachAndPlace',{actorId:'agent_01',supportId:'table_01',surfaceId:'top'}],
        ['evaluateWorldAcceptance',{criteria:structuredClone(CABINET_CUP_TASK_CRITERIA)}]
      ];
      const names={approachAndInteract:'open',approachAndPickup:'pickup',approachAndPlace:'place',evaluateWorldAcceptance:'verify'};
      // Instrument real tools; never replace their return values or execution policy.
      const observedTools=Object.create(tools);
      observedTools.call=async(name,args,context)=>{
        if (!names[name]) return tools.call(name,args,context);
        if (name === 'approachAndPlace' && fault === 'occupied-surface') {
          const p=runtime.physics.getPosition('table_01');
          runtime.physics.addEnvironment([{shape:'box',halfExtents:[1.3,.7,.75],translation:[p[0],p[1]+1.8,p[2]]}],{id:'acceptance-surface-blocker'});
        }
        if (name === 'evaluateWorldAcceptance') await settleWorld(runtime,90);
        const result=await stage(names[name],()=>tools.call(name,args,context));
        if (name === 'approachAndPickup') attempt.pickupOwnership=structuredClone(runtime.store.get('cup_01').state.heldBy);
        return result;
      };
      const gateway={isConfigured:()=>true,async complete({messages}) {
        const completed=messages.filter((message)=>message.role === 'tool');
        const latest=completed.at(-1);
        if (latest) {
          const value=JSON.parse(latest.content);
          if (typeof value.error === 'string' || (value._sequence && !['verified','accepted'].includes(value._sequence.outcome?.state))) {
            attempt.stopReason={error:value.error,sequence:value._sequence};
            return {message:'已停止：上一步未验证完成。',toolCalls:[]};
          }
        }
        const next=sequence[completed.length];
        return next ? {message:'',toolCalls:[{id:`acceptance_${completed.length}`,name:next[0],args:next[1]}]} : {message:'已完成固定任务。',toolCalls:[]};
      }};
      const result=await driveWorld(new ToolCallingAgent({tools:observedTools,gateway,maxSteps:8}).run('把柜子里的杯子放到桌子上，并验证结果。'),runtime);
      attempt.taskStatus=result.taskStatus;
      attempt.execution=result.execution;
      if (fault === 'blocked-door') {
        attempt.passed=result.taskStatus !== 'completed' && attempt.stages.some((entry)=>entry.name === 'open' && entry.reason) && !attempt.stages.some((entry)=>entry.name === 'pickup');
        attempt.stoppedBeforePickup=true;
        continue;
      }
      if (fault === 'occupied-surface') {
        attempt.passed=result.taskStatus !== 'completed' && runtime.interactions.carryStatus('agent_01').status === 'held';
        attempt.heldAfterFailure=structuredClone(runtime.store.get('cup_01').state.heldBy);
        continue;
      }
      const accepted=result.acceptanceBundle?.result;
      attempt.support=runtime.spatial.supportGeometry('cup_01','table_01',{surfaceId:'top'});
      attempt.hands=runtime.interactions.carryStatus('agent_01').status;
      attempt.passed=result.taskStatus === 'completed' && accepted?.status === 'world-accepted' && attempt.support.supported === true && attempt.hands === 'empty';
      if (!attempt.passed) throw new Error('Independent world post-conditions failed');
    }
    row.passed=row.attempts.length === repeats && row.attempts.every((attempt)=>attempt.passed);
  } catch(error) { row.error={code:error.code || 'ACCEPTANCE_FAILED',message:error.message}; }
  finally { handle.dispose(); }
  return row;
}

export async function runCabinetCupAcceptance() {
  const cases=[];
  for (const worldId of CABINET_CUP_TASK_WORLDS) cases.push(await runCabinetCupCase(worldId));
  for (const fault of ['missing-target','blocked-door','occupied-surface']) cases.push(await runCabinetCupCase('monument-hall',{repeats:1,fault}));
  cases.push(await runCabinetCupCase('magic-cabin',{repeats:1,fault:'unreachable'}));
  return {schema:'agentscape.cabinet-cup-acceptance',schemaVersion:1,generatedAt:new Date().toISOString(),mode:'scripted-gateway-real-runtime',modelUsed:false,cases,passed:cases.every((row)=>row.passed)};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report=await runCabinetCupAcceptance();
  const output=process.argv[2] || '.tmp/cabinet-cup-acceptance.json';
  await mkdir(resolve(output,'..'),{recursive:true});
  await writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.table(report.cases.map((row)=>({world:row.worldId,fault:row.fault || 'normal',attempts:row.attempts.length,passed:row.passed,error:row.error?.message || ''})));
  console.log(`Full stage report: ${output}`);
  process.exitCode=report.passed ? 0 : 1;
}
