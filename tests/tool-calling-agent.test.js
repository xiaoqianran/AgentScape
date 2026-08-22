import { describe, expect, it, vi } from 'vitest';
import { ToolCallingAgent } from '../src/agent/ToolCallingAgent.js';

it('executes tool calls and feeds results back to the planner', async () => {
  const gateway = {
    isConfigured: () => true,
    complete: vi.fn()
      .mockResolvedValueOnce({ message: '', toolCalls: [{ id: 'c1', name: 'open', args: { id: 'cabinet_01' } }] })
      .mockResolvedValueOnce({ message: 'done', final: true, toolCalls: [] })
  };
  const tools = { definitions: vi.fn(() => []), call: vi.fn(async (name) => name === 'listObjects' ? [] : { ok: true }) };
  const agent = new ToolCallingAgent({ tools, gateway, maxSteps: 4 });
  const result = await agent.run('open it');
  expect(result.message).toBe('done');
  expect(tools.call).toHaveBeenCalledWith('open', { id: 'cabinet_01' });
  const secondRequest = gateway.complete.mock.calls[1][0];
  expect(secondRequest.messages.some((m) => m.role === 'tool' && m.name === 'open')).toBe(true);
});
