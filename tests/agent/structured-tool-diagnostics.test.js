import { describe, expect, it } from 'vitest';
import { SkillRegistry } from '../../application/skills/SkillRegistry.js';
import { AgentTools } from '../../application/AgentTools.js';
import { invokeAgentTool } from '../../modules/agent/execution/AgentToolInvoker.js';
import { sceneAgentModelSchema } from '../../application/scene/SceneContracts.js';

describe('model-visible structured validation diagnostics', () => {
  it('preserves field paths through SkillRegistry, AgentTools and AgentToolInvoker', async () => {
    const registry=new SkillRegistry();
    registry.register({
      name:'addSceneModel',required:['model'],
      mutates:true,manualMutation:true,
      handler:({model})=>sceneAgentModelSchema.parse(model)
    });
    const runtime={skills:registry,events:{emit(){}},lastAcceptanceBundle:null};
    const tools=new AgentTools(runtime,{actor:'agent_01'});
    const args={model:{id:'tree_01',asset:{
      schema:'agentscape.asset-recipe',schemaVersion:1,id:'test/tree',
      parts:[{id:'branch',geometry:{type:'segment',from:[0,0,0],to:[0,0,0],radiusStart:0.1,radiusEnd:0}}]
    }}};
    const direct=await registry.invoke('addSceneModel',args,{profile:'builder'});
    expect(direct.success).toBe(false);
    expect(direct.error.code).toBe('invalid_input');
    expect(direct.error.details.length).toBeGreaterThan(0);
    expect(direct.error.details[0]).toHaveProperty('path');
    expect(direct.error.details.every(item=>!('input' in item))).toBe(true);
    await expect(tools.call('addSceneModel',args)).rejects.toMatchObject({
      code:'invalid_input',diagnostics:expect.arrayContaining([expect.objectContaining({path:expect.any(String)})])
    });
    const {safeResult,invocationFailed,policy}=await invokeAgentTool(tools,{name:'addSceneModel',args});
    expect(invocationFailed).toBe(true);
    expect(safeResult.code).toBe('invalid_input');
    expect(safeResult.diagnostics).toEqual(direct.error.details);
    expect(policy.outcome.state).toBe('error');
  });
});
