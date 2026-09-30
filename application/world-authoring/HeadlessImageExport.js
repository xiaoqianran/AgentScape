// Deterministic image export for hosts without a DOM canvas.
//
// GLTFExporter encodes every texture through a canvas. Browsers always have one,
// but headless hosts (Node tools, CI) do not, so exporting an Agent-authored
// DataTexture - the only texture an authoring sandbox can create - would fail with
// "document is not defined". This module encodes RGBA pixel data straight to PNG
// bytes and exposes a minimal OffscreenCanvas/ImageData surface that GLTFExporter
// picks up automatically when the real canvas APIs are unavailable.

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ZLIB_HEADER = new Uint8Array([0x78, 0x01]);
const STORED_BLOCK_MAX = 0xffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes, start, end) {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function concat(parts) {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

// zlib stream using stored (uncompressed) deflate blocks - no compression library needed.
function zlibStored(raw) {
  const parts = [ZLIB_HEADER];
  const blocks = Math.max(1, Math.ceil(raw.length / STORED_BLOCK_MAX));
  for (let i = 0; i < blocks; i++) {
    const start = i * STORED_BLOCK_MAX;
    const length = Math.min(STORED_BLOCK_MAX, raw.length - start);
    const header = new Uint8Array(5);
    header[0] = i === blocks - 1 ? 0x01 : 0x00; // BFINAL | BTYPE=stored
    header[1] = length & 0xff;
    header[2] = (length >>> 8) & 0xff;
    header[3] = ~length & 0xff;
    header[4] = (~length >>> 8) & 0xff;
    parts.push(header, raw.subarray(start, start + length));
  }
  const checksum = new Uint8Array(4);
  new DataView(checksum.buffer).setUint32(0, adler32(raw));
  parts.push(checksum);
  return concat(parts);
}

// Encodes RGBA8 pixels (top-to-bottom, no premultiply) into a PNG image.
export function encodePngRgba(rgba, width, height) {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new TypeError('PNG dimensions must be positive integers');
  }
  if (rgba.length !== width * height * 4) {
    throw new TypeError(`RGBA buffer must contain ${width * height * 4} bytes`);
  }
  const stride = width * 4;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type: none
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlibStored(raw)),
    pngChunk('IEND', new Uint8Array(0))
  ]);
}

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
export function installHeadlessImageSupport(scope = globalThis) {
  if (typeof scope.OffscreenCanvas !== 'undefined' && typeof scope.ImageData !== 'undefined') return null;
  const previous = { OffscreenCanvas:scope.OffscreenCanvas, ImageData:scope.ImageData };
  if (typeof scope.OffscreenCanvas === 'undefined') scope.OffscreenCanvas = HeadlessOffscreenCanvas;
  if (typeof scope.ImageData === 'undefined') scope.ImageData = HeadlessImageData;
  return () => {
    if (previous.OffscreenCanvas === undefined) delete scope.OffscreenCanvas;
    else scope.OffscreenCanvas = previous.OffscreenCanvas;
    if (previous.ImageData === undefined) delete scope.ImageData;
    else scope.ImageData = previous.ImageData;
  };
}
