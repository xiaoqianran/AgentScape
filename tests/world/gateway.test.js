import { describe, expect, it, vi } from 'vitest';
import { HttpLLMGateway, normalizeGatewayResponse } from '../../modules/agent/gateway/HttpLLMGateway.js';

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

  it('defaults to a 90 second timeout while still allowing an explicit override', () => {
    expect(new HttpLLMGateway({ endpoint: 'https://gateway.test/agent' }).timeoutMs).toBe(90000);
    expect(new HttpLLMGateway({ endpoint: 'https://gateway.test/agent', timeoutMs: 1234 }).timeoutMs).toBe(1234);
  });

  it('generates stable fallback call ids and treats a message-only response as final', () => {
    expect(normalizeGatewayResponse({ toolCalls: [{ name: 'open' }, { id: 'kept', name: 'close' }, { name: 'check' }] })
      .toolCalls.map((call) => call.id)).toEqual(['call_0', 'kept', 'call_2']);
    expect(normalizeGatewayResponse({ message: 'done' })).toMatchObject({ final: true, toolCalls: [] });
    expect(normalizeGatewayResponse({ message: '', toolCalls: [{ name: 'open' }] })).toMatchObject({ final: false });
    expect(normalizeGatewayResponse({ message: '', toolCalls: [{ name: 'open' }] }).toolCalls[0].args).toEqual({});
  });
});
