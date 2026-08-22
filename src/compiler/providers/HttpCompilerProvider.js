export class HttpCompilerProvider {
  constructor({ endpoint = '', fetchImpl = fetch, timeoutMs = 120000 } = {}) {
    this.endpoint = String(endpoint || '').trim();
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }
  setEndpoint(endpoint) { this.endpoint = String(endpoint || '').trim(); }
  isConfigured() { return Boolean(this.endpoint); }
  async run(stage, payload) {
    if (!this.endpoint) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stage, ...payload }), signal: controller.signal
      });
      if (!response.ok) throw new Error(`Compiler provider HTTP ${response.status}`);
      return response.json();
    } finally { clearTimeout(timer); }
  }
}
