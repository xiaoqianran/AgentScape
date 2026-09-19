import { ToolCallingAgent } from '../../../modules/agent/ToolCallingAgent.js';
import { HttpLLMGateway } from '../../../modules/agent/gateway/HttpLLMGateway.js';
import { AgentRuntimeTestRunner } from '../agent/AgentRuntimeTestRunner.js';
import { GeneratedPlacementDemoRunner } from '../demos/generated-placement/GeneratedPlacementDemoRunner.js';
import { RunsPanel } from '../ui/runs/RunsPanel.js';
import { TaskPanel } from '../ui/task/TaskPanel.js';
import { CAPABILITY_API } from '../config/capabilityEntry.js';

export function createStudioAgent({
  ui,
  world,
  agentTools,
  runtimeTestTools,
  capabilityStatus
}) {
  const runsPanel = new RunsPanel();
  let taskPanel = null;

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
    runtimeTestRunner
  });

  const gateway = new HttpLLMGateway({
    endpoint:capabilityStatus.agent.available ? CAPABILITY_API.agent : ''
  });
  const agent = new ToolCallingAgent({
    tools:agentTools,
    gateway,
    log:(text,kind)=>taskPanel.log(text,kind)
  });

  taskPanel.attachAgent({ agent, gateway });
  taskPanel.setAvailability(capabilityStatus.agent.available);
  ui.attachAgent?.({ taskPanel, runsPanel });

  return {
    taskPanel,
    runsPanel,
    gateway,
    dispose() {
      ui.attachAgent?.(null);
      taskPanel.dispose?.();
      runsPanel.dispose?.();
    }
  };
}
