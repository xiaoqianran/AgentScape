import { describe, expect, it, vi } from 'vitest';
import { HttpLLMGateway, normalizeGatewayResponse } from '../src/agent/gateway/HttpLLMGateway.js';
import { LocalPlannerGateway } from '../src/agent/gateway/LocalPlannerGateway.js';

describe('LLM gateways', () => {
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

  it('local fallback emits multiple tool calls for a compound request', async () => {
    const gateway = new LocalPlannerGateway();
    const result = await gateway.complete({ messages: [{ role: 'user', content: '把杯子放到桌上，然后打开柜子' }] });
    expect(result.toolCalls.map((call) => call.name)).toEqual(expect.arrayContaining(['place', 'open']));
  });
});

it('uses environment-specific coffee-corner positions without hardcoding Runtime coordinates', async () => {
  const gateway = new LocalPlannerGateway({ coffeeCorner:{ table:[10,1,3], cabinet:[8,1,3] } });
  const result = await gateway.complete({ messages:[{ role:'user', content:'建立一个咖啡角' }] });
  expect(result.toolCalls[0]).toMatchObject({ name:'moveObject', args:{ id:'table_01', position:[10,1,3] } });
  expect(result.toolCalls[1]).toMatchObject({ name:'moveObject', args:{ id:'cabinet_01', position:[8,1,3] } });
});
