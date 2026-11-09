import { describe, expect, it, vi } from 'vitest';
import { SceneAgentTools } from '../../application/scene/SceneAgentTools.js';

const createRuntime = () => ({
  events: { emit: vi.fn() },
  trace: { emit: vi.fn() },
  skills: {
    invoke: vi.fn(async (name, args, context) => ({ success:true, result:{ name, args, context } })),
    definitions: vi.fn(() => [{ name:'inspectObject' }]),
    executionPolicy: vi.fn(() => ({ mutates:false }))
  }
});

describe('SceneAgentTools explicit Studio tool routing', () => {
  it.each(['studio-ui', 'agent', 'runtime-test'])('routes Scene skills to the facade for %s', async source => {
    const runtime = createRuntime();
    const scene = { executeSkill: vi.fn(async () => ({ status:'scene-success' })) };
    const tools = new SceneAgentTools(runtime, scene, { profile:'builder', actor:'agent_01', source });
    await expect(tools.call('moveObject', { id:'box', position:[1, 0, 0] })).resolves.toEqual({ status:'scene-success' });
    expect(scene.executeSkill).toHaveBeenCalledWith('moveObject', { id:'box', position:[1, 0, 0] });
    expect(runtime.skills.invoke).not.toHaveBeenCalled();
    expect(runtime.events.emit).not.toHaveBeenCalledWith('tool.called', expect.anything());
  });

  it('delegates other tools to the registry, retaining trusted actor, source and planner lineage', async () => {
    const runtime = createRuntime();
    const scene = { executeSkill: vi.fn() };
    const tools = new SceneAgentTools(runtime, scene, { profile:'builder', actor:'agent_01', source:'studio-ui' });
    const args = { id:'box' };
    await tools.call('inspectObject', args, { actor:'forged', profile:'viewer', worldProposalLineage:{ parentRevisionId:'r1' } });
    expect(runtime.skills.invoke).toHaveBeenCalledWith('inspectObject', args, {
      actor:'agent_01', profile:'builder', worldProposalLineage:{parentRevisionId:'r1'}
    });
    expect(runtime.events.emit).toHaveBeenCalledWith('tool.called', {name:'inspectObject', args, source:'studio-ui'});
    expect(scene.executeSkill).not.toHaveBeenCalled();
    expect(tools.definitions()).toEqual([{name:'inspectObject'}]);
    expect(tools.executionPolicy('inspectObject', {})).toEqual({mutates:false});
  });

  it('keeps registry failures and Scene failures separate', async () => {
    const runtime = createRuntime();
    runtime.skills.invoke.mockResolvedValue({success:false,error:{code:'forbidden',message:'Denied'}});
    const scene = { executeSkill: vi.fn(async () => {throw Object.assign(new Error('Busy'),{code:'SCENE_BUSY'});}) };
    const tools = new SceneAgentTools(runtime, scene);
    await expect(tools.call('inspectObject', {})).rejects.toMatchObject({code:'forbidden'});
    await expect(tools.call('open', {})).rejects.toMatchObject({code:'SCENE_BUSY'});
  });

  it('fails early when the Scene facade is missing', () => {
    expect(() => new SceneAgentTools(createRuntime(), null)).toThrow(TypeError);
  });
});
