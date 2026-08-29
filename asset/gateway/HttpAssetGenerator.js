import { JsonGateway } from '../../core/JsonGateway.js';

export class HttpAssetGenerator extends JsonGateway {
  constructor(options = {}) { super({ timeoutMs: 120000, label: 'Asset Generator', ...options }); }

  async generate(request) {
    const payload = await this.post(request);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Asset Generator response requires a JSON object');
    return payload;
  }
}
