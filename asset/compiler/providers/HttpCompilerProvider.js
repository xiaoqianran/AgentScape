import { JsonGateway } from '../../../core/JsonGateway.js';

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

  async runUrdfProposal(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : null;
    if (!data?.byteLength) throw new Error('URDF proposal requires non-empty bytes');
    const form = new FormData();
    form.set('stage', 'urdf-proposal');
    form.set('asset', new Blob([data], { type:'application/xml' }), 'asset.urdf');
    return this.postForm(form);
  }
}
