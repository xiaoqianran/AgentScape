import { JsonGateway } from '../../../foundation/JsonGateway.js';

export class HttpLLMGateway extends JsonGateway {
  constructor(options = {}) { super({ timeoutMs: 180000, label: 'agent capability adapter', ...options }); }
  async complete(request, options) { return normalizeGatewayResponse(await this.post(request, options)); }
}

export function normalizeGatewayResponse(payload = {}) {
  const toolCalls = Array.isArray(payload.toolCalls) ? payload.toolCalls.map((call, index) => ({
    id: call.id || `call_${index}`,
    name: call.name,
    args: call.args || call.arguments || {}
  })) : [];
  return {
    message: payload.message || payload.content || '',
    final: Boolean(payload.final || (!toolCalls.length && (payload.message || payload.content))),
    toolCalls
  };
}
