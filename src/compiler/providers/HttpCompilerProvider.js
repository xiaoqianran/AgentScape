import { JsonGateway } from '../../core/JsonGateway.js';

export class HttpCompilerProvider extends JsonGateway {
  constructor(options = {}) { super({ timeoutMs: 120000, label: 'Compiler provider', ...options }); }
  async run(stage, payload) { return this.post({ stage, ...payload }); }
}
