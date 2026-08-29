import { describe, expect, it, vi } from 'vitest';
import { HttpLLMGateway, normalizeGatewayResponse } from '../agent/gateway/HttpLLMGateway.js';

describe('LLM gateway', () => {
  it('normalizes provider-neutral tool calls', () => {
    expect(normalizeGatewayResponse({ toolCalls: [{ name: 'open', arguments: { id: 'cabinet_01' } }] }).toolCalls[0]).toMatchObject({ name: 'open', args: { id: 'cabinet_01' } });
  });

  it('posts the agent request to a configured gateway', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ final: true, message: 'done' }) }));
    const gateway = new HttpLLMGateway({ endpoint: 'https://gateway.test/agent', fetchImpl });
    const result = await gateway.complete({ messages: [], tools: [] });
    expect(result.message).toBe('done');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
