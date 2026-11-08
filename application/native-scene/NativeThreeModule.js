// Startup-only module shim. All geometry/material exports are the host's originals.
export * from 'three';
import { WebGLRenderer as OriginalRenderer } from 'three';
import { observeNativeRenderer } from './NativeRenderDiscovery.js';

export class WebGLRenderer extends OriginalRenderer {
  constructor(...args) {
    super(...args);
    const release = observeNativeRenderer(this);
    const dispose = this.dispose;
    this.dispose = (...values) => {
      release();
      return dispose.apply(this, values);
    };
  }
}
