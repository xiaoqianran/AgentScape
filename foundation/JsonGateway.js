export class JsonGateway {
  constructor({ endpoint = '', fetchImpl = fetch, timeoutMs = 30000, label = 'Gateway' } = {}) {
    this.endpoint = String(endpoint || '').trim();
    this.fetchImpl = (...args) => fetchImpl(...args);
    this.timeoutMs = timeoutMs;
    this.label = label;
  }

  setEndpoint(endpoint) { this.endpoint = String(endpoint || '').trim(); }
  isConfigured() { return Boolean(this.endpoint); }


  async postForm(form) {
    if (!this.endpoint) throw new Error(`${this.label} endpoint is not configured`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, { method:'POST', body:form, signal:controller.signal });
      if (!response.ok) throw new Error(`${this.label} HTTP ${response.status}`);
      return response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async post(payload) {
    if (!this.endpoint) throw new Error(`${this.label} endpoint is not configured`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`${this.label} HTTP ${response.status}`);
      return response.json();
    } finally {
      clearTimeout(timer);
    }
  }
}
