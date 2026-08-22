import { describe, expect, it, vi } from 'vitest';
import { AgentTools } from '../src/agent/AgentTools.js';

const runtime = () => ({
  events: { emit: vi.fn() },
  skills: { invoke: vi.fn(async (name, args, context) => ({ success: true, result: { name, args, context } })) }
});

describe('AgentTools registry facade', () => {
  it('rejects unknown tools before registry dispatch', async () => {
    const tools = new AgentTools(runtime());
    await expect(tools.call('destroyWorld', {})).rejects.toMatchObject({ code: 'INVALID_TOOL_CALL' });
  });

  it('rejects missing required args', async () => {
    const tools = new AgentTools(runtime());
    await expect(tools.call('moveObject', { id: 'a' })).rejects.toMatchObject({ code: 'INVALID_TOOL_CALL' });
  });

  it('routes world actions through the skill registry with an actor/profile', async () => {
    const r = runtime();
    const tools = new AgentTools(r, { profile: 'builder', actor: 'llm-agent' });
    await tools.call('open', { id: 'cabinet_01' });
    expect(r.skills.invoke).toHaveBeenCalledWith('open', { id: 'cabinet_01' }, { profile: 'builder', actor: 'llm-agent' });
  });

  it('routes semantic, asset and engine tools through the same boundary', async () => {
    const r = runtime(); const tools = new AgentTools(r);
    await tools.call('listRelations', { predicate: 'ON' });
    await tools.call('searchAssets', { query: 'chair' });
    await tools.call('validateWorld', {});
    expect(r.skills.invoke.mock.calls.map((c) => c[0])).toEqual(['listRelations', 'searchAssets', 'validateWorld']);
  });

  it('surfaces structured registry failures as domain errors', async () => {
    const r = runtime();
    r.skills.invoke.mockResolvedValueOnce({ success: false, error: { code: 'forbidden', message: 'Missing permissions' } });
    const tools = new AgentTools(r, { profile: 'viewer' });
    await expect(tools.call('open', { id: 'cabinet_01' })).rejects.toMatchObject({ code: 'forbidden' });
  });
});
