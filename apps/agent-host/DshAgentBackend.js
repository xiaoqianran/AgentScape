import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';
import { normalizeExecution } from './AgentExecution.js';

// The DSH SDK spawns a separate process. Require an explicit reviewed profile
// patch: the stock SDK profile may expose Shell/filesystem tools.
export async function runDshAgent({prompt,configuration,signal,projectScope,emit=()=>{},harnessFactory=null}={}) {
  if(!configuration.dshPatch || !configuration.dshProvider || !configuration.dshModel)
    throw Object.assign(new Error('DSH_RESTRICTED_PROFILE_REQUIRED'),{code:'DSH_RESTRICTED_PROFILE_REQUIRED'});
  if(signal?.aborted)return {backend:'dsh',taskStatus:'cancelled',message:'Cancelled'};
  const harness=harnessFactory?.() || new DeepSeekHarness({
    profile:'sdk-minimal',patches:configuration.dshPatches||[configuration.dshPatch],dshHome:configuration.dshHome,
    provider:configuration.dshProvider,model:configuration.dshModel,
    ...(projectScope ? {env:{...process.env,AGENTSCAPE_PROJECT_SCOPE:projectScope}} : {}),
    approvalRequests:true,initializeTimeoutMs:45000
  });
  let running=true;
  const abort=()=>{if(running)void harness.close();};
  signal?.addEventListener('abort',abort,{once:true});
  try{
    // Fail closed: approval requests never implicitly grant host access.
    harness.client.start();
    harness.client.onRequest(async(method)=>{
      if(method==='approval/request')return {outcome:'rejected'};
      throw new Error('DSH_UNSUPPORTED_REQUEST');
    });
    emit({type:'run.started',backend:'dsh'});
    const result=await harness.run(prompt,{onNotification:notification=>{
      emit({type:'dsh.notification',notificationType:notification.method||notification.type||'event'});
    }});
    // SDK emits the original tool/call and tool/result events; the Host alone verifies success.
    const execution=normalizeExecution('dsh',result.events||[]);
    for(const entry of execution)
      emit({type:'tool.end',tool:entry.tool,toolCallId:entry.toolCallId,
        failed:entry.outcome.state==='failed',reason:entry.outcome.reason});
    return {backend:'dsh',taskStatus:signal?.aborted?'cancelled':'incomplete',
      message:result.finalResponse||'',sessionId:result.sessionId,finishReason:result.finishReason,
      steps:execution.length,execution};
  } finally {
    running=false;
    signal?.removeEventListener('abort',abort);
    await harness.close();
  }
}
