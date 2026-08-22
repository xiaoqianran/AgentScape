import { JsonGateway } from '../../core/JsonGateway.js';

export class HttpCompilerProvider extends JsonGateway {
  constructor(options = {}) { super({ timeoutMs: 120000, label: 'Compiler provider', ...options }); }
  async run(stage, payload) { return this.post({ stage, ...payload }); }

  async runPartGeometry(bytes, parts) {
    const form = new FormData();
    form.set('stage', 'part-geometry');
    form.set('metadata', JSON.stringify({ parts }));
    form.set('asset', new Blob([bytes], { type:'model/gltf-binary' }), 'asset.glb');
    return this.postForm(form);
  }
}
