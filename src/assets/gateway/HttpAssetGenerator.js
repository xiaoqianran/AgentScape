export class HttpAssetGenerator {
  constructor({ endpoint = '', fetchImpl = fetch, timeoutMs = 120000 } = {}) {
    this.endpoint = String(endpoint || '').trim();
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  setEndpoint(endpoint) { this.endpoint = String(endpoint || '').trim(); }
  isConfigured() { return Boolean(this.endpoint); }

  async generate(request) {
    if (!this.endpoint) throw new Error('Asset Generator endpoint is not configured');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Asset Generator HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload?.manifest) throw new Error('Asset Generator response requires manifest');
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }
}
