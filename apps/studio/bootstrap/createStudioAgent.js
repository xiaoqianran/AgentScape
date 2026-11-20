import { ToolCallingAgent } from '../../../modules/agent/ToolCallingAgent.js';
import { RemoteAgentClient } from '../agent/RemoteAgentClient.js';
import { createProgressiveAgentTools } from '../../../application/agent/ProgressiveAgentTools.js';
import { HttpLLMGateway } from '../../../modules/agent/gateway/HttpLLMGateway.js';
import { AgentRuntimeTestRunner } from '../agent/AgentRuntimeTestRunner.js';
import { GeneratedPlacementDemoRunner } from '../demos/generated-placement/GeneratedPlacementDemoRunner.js';
import { RunsPanel } from '../ui/runs/RunsPanel.js';
import { TaskPanel } from '../ui/task/TaskPanel.js';
import { CAPABILITY_API } from '../config/capabilityEntry.js';

export function createStudioAgent({
  ui,
  world,
  scene,
  agentTools,
  runtimeTestTools,
  capabilityStatus,
  codeProjects = null
}) {
  const runsPanel = new RunsPanel();
  let taskPanel = null;
  if (!codeProjects) Object.defineProperty(agentTools,'actor',{configurable:true,get:()=>scene.actors().selected});
  const activeScene = () => codeProjects?.scene || scene;

  const generatedPlacementDemo = new GeneratedPlacementDemoRunner({
    world,
    log:(text,kind)=>taskPanel?.log?.(text,kind)
  });
  const runtimeTestRunner = new AgentRuntimeTestRunner({
    tools:runtimeTestTools,
    actorId:'agent_01',
    log:(text,kind)=>taskPanel?.log?.(text,kind)
  });

  taskPanel = new TaskPanel({
    setView:ui.setView,
    onRun:(run)=>runsPanel.addRun(run),
    demoRunners:{ 'generated-placement':generatedPlacementDemo },
    runtimeTestRunner,
    getActors:()=>activeScene().actors(),
    onSelectActor:actor=>activeScene().selectActor(actor)
  });

  const gateway = new HttpLLMGateway({
    endpoint:capabilityStatus.agent.available ? CAPABILITY_API.agent : ''
  });
  const agent = new ToolCallingAgent({
    tools:createProgressiveAgentTools(agentTools),
    gateway,
    maxSteps:32,
    log:(text,kind)=>taskPanel.log(text,kind)
  });

  taskPanel.attachAgent({ agent, gateway });
  taskPanel.attachExternalBackends(new RemoteAgentClient({
    onEvent:event=>{
      if(event.type==='tool.start')taskPanel.log('Pi/DSH tool: '+event.tool,'tool');
      if(event.type==='tool.end' && event.failed)taskPanel.log(event.tool+' · '+(event.reason || '工具执行失败'),'error');
      if(event.type==='run.finished')taskPanel.log('Agent Host: '+event.taskStatus,'result');
    }
  }));
  taskPanel.setAvailability(capabilityStatus.agent.available);
  ui.attachAgent?.({ taskPanel, runsPanel });
  const actorEvents=['object.spawned','object.removed','scene.restored','scene.actor.selected'].map(name=>world.events.on(name,()=>{taskPanel.emit();ui.refreshInspector?.();}));
  const stopProjects = codeProjects?.subscribe(()=>taskPanel.emit());

  return {
    taskPanel,
    runsPanel,
    gateway,
    dispose() {
      stopProjects?.();
      actorEvents.forEach(off=>off());
      ui.attachAgent?.(null);
      taskPanel.dispose?.();
      runsPanel.dispose?.();
    }
  };
}
