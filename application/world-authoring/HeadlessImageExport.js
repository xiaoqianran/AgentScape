// Deterministic image export for hosts without a DOM canvas.
//
// GLTFExporter encodes every texture through a canvas. Browsers always have one,
// but headless hosts (Node tools, CI) do not, so exporting an Agent-authored
// DataTexture - the only texture an authoring sandbox can create - would fail with
// "document is not defined". This module encodes RGBA pixel data straight to PNG
// bytes and exposes a minimal OffscreenCanvas/ImageData surface that GLTFExporter
// picks up automatically when the real canvas APIs are unavailable.

import { encodePngRgba } from '../../foundation/PngRgba.js';
export { encodePngRgba };

class HeadlessImageData {
  constructor(dataOrWidth, widthOrHeight, height) {
    if (typeof dataOrWidth === 'number') {
      this.width = dataOrWidth;
      this.height = widthOrHeight;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
      return;
    }
    this.data = dataOrWidth instanceof Uint8ClampedArray ? dataOrWidth : new Uint8ClampedArray(dataOrWidth);
    this.width = widthOrHeight;
    this.height = height;
  }
}

class HeadlessOffscreenCanvas {
  constructor(width = 1, height = 1) {
    this.width = width;
    this.height = height;
    this.pixels = null;
  }

  getContext(type) {
    if (type !== '2d') return null;
    const canvas = this;
    return {
      canvas,
      putImageData(image) {
        canvas.pixels = { data: new Uint8ClampedArray(image.data), width: image.width, height: image.height };
      },
      drawImage(source) {
        if (source?.pixels) canvas.pixels = {
          data: new Uint8ClampedArray(source.pixels.data),
          width: source.pixels.width,
          height: source.pixels.height
        };
      },
      scale() {},
      translate() {},
      clearRect() {},
      fillRect() {}
    };
  }

  convertToBlob({ type = 'image/png' } = {}) {
    const image = this.pixels || {
      data: new Uint8ClampedArray(this.width * this.height * 4),
      width: this.width,
      height: this.height
    };
    return Promise.resolve(new Blob([encodePngRgba(image.data, image.width, image.height)], { type }));
  }
}

// Installs the canvas shim only when the host has no real canvas/image APIs,
// and returns a restore function (null when nothing was changed).
const installations = new WeakMap();
export function installHeadlessImageSupport(scope = globalThis) {
  let installation = installations.get(scope);
  if (!installation) {
    if (typeof scope.OffscreenCanvas !== 'undefined' && typeof scope.ImageData !== 'undefined') return null;
    const previous = { OffscreenCanvas:scope.OffscreenCanvas, ImageData:scope.ImageData };
    if (typeof scope.OffscreenCanvas === 'undefined') scope.OffscreenCanvas = HeadlessOffscreenCanvas;
    if (typeof scope.ImageData === 'undefined') scope.ImageData = HeadlessImageData;
    installation = { previous, count:0 };
    installations.set(scope, installation);
  }
  installation.count++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--installation.count !== 0) return;
    const { previous } = installation;
    if (previous.OffscreenCanvas === undefined) delete scope.OffscreenCanvas;
    else scope.OffscreenCanvas = previous.OffscreenCanvas;
    if (previous.ImageData === undefined) delete scope.ImageData;
    else scope.ImageData = previous.ImageData;
    installations.delete(scope);
  };
}
