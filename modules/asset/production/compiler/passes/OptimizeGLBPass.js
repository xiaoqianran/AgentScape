import { dedup, prune, weld } from '@gltf-transform/functions';

export class OptimizeGLBPass {
  constructor({ io, enabled = true } = {}) { this.io = io; this.enabled = enabled; }

  async run(context) {
    if (!this.enabled) return { ...context, optimizedBytes: context.bytes, optimization: { skipped: true } };
    const document = context.document;
    await document.transform(dedup(), prune(), weld());
    const optimizedBytes = await this.io.writeBinary(document);
    return {
      ...context,
      optimizedBytes,
      optimization: {
        skipped: false,
        beforeBytes: context.bytes.byteLength,
        afterBytes: optimizedBytes.byteLength,
        ratio: context.bytes.byteLength ? Number((optimizedBytes.byteLength / context.bytes.byteLength).toFixed(4)) : 1,
        transforms: ['dedup', 'prune', 'weld']
      }
    };
  }
}
