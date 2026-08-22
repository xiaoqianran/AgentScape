export class HttpLLMGateway {
  constructor({ endpoint, fetchImpl = fetch, timeoutMs = 30000 } = {}) {
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  setEndpoint(endpoint) { this.endpoint = String(endpoint || '').trim(); }

  isConfigured() { return Boolean(this.endpoint); }

  async complete(request) {
    if (!this.endpoint) throw new Error('LLM gateway endpoint is not configured');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`LLM gateway HTTP ${response.status}`);
      const payload = await response.json();
      return normalizeGatewayResponse(payload);
    } finally {
      clearTimeout(timer);
    }
  }
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
