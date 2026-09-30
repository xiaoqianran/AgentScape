import { afterEach, describe, expect, it } from 'vitest';
import {
  encodePngRgba,
  installHeadlessImageSupport
} from '../../application/world-authoring/HeadlessImageExport.js';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readChunks(bytes) {
  const chunks = [];
  let offset = 8;
  while (offset < bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
    const length = view.getUint32(0);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    chunks.push({ type, data: bytes.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
  }
  return chunks;
}

function inflateStored(zlib) {
  let offset = 2; // zlib header
  const parts = [];
  for (;;) {
    const header = zlib[offset++];
    if ((header >> 1) & 3) throw new Error('encoder must emit stored deflate blocks');
    const length = zlib[offset] | (zlib[offset + 1] << 8);
    const nlength = zlib[offset + 2] | (zlib[offset + 3] << 8);
    if ((length ^ 0xffff) !== nlength) throw new Error('stored block LEN/NLEN mismatch');
    offset += 4;
    parts.push(zlib.subarray(offset, offset + length));
    offset += length;
    if (header & 1) break;
  }
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const raw = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) { raw.set(part, cursor); cursor += part.length; }
  return raw;
}

describe('Headless image export', () => {
  it('encodes RGBA pixels into a well-formed PNG whose scanlines round-trip exactly', () => {
    const width = 3;
    const height = 2;
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 37 + 11) & 0xff;

    const png = encodePngRgba(rgba, width, height);

    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    const chunks = readChunks(png);
    expect(chunks.map((chunk) => chunk.type)).toEqual(['IHDR', 'IDAT', 'IEND']);

    const ihdr = chunks[0].data;
    const ihdrView = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength);
    expect(ihdrView.getUint32(0)).toBe(width);
    expect(ihdrView.getUint32(4)).toBe(height);
    expect(ihdr[8]).toBe(8); // bit depth
    expect(ihdr[9]).toBe(6); // RGBA
    expect(ihdr[12]).toBe(0); // no interlace

    // Stored deflate lets us recover the exact filtered scanlines the decoder would read back.
    const scanlines = inflateStored(chunks[1].data);
    const stride = width * 4;
    const pixels = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      expect(scanlines[y * (stride + 1)]).toBe(0); // filter type: none
      pixels.set(scanlines.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride);
    }
    expect([...pixels]).toEqual([...rgba]);
  });

  it('rejects mismatched pixel buffers and invalid dimensions', () => {
    expect(() => encodePngRgba(new Uint8Array(4), 2, 2)).toThrow('RGBA buffer must contain');
    expect(() => encodePngRgba(new Uint8Array(0), 0, 1)).toThrow('positive integers');
  });

  it('installs OffscreenCanvas/ImageData only when missing and restores the prior globals', async () => {
    const scope = {};
    const restore = installHeadlessImageSupport(scope);
    expect(typeof restore).toBe('function');
    expect(typeof scope.OffscreenCanvas).toBe('function');
    expect(typeof scope.ImageData).toBe('function');

    const canvas = new scope.OffscreenCanvas(1, 1);
    canvas.width = 2;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    context.putImageData(new scope.ImageData(new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]), 2, 1), 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    expect(blob.type).toBe('image/png');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([...bytes.subarray(0, 8)]).toEqual(PNG_SIGNATURE);

    restore();
    expect(scope.OffscreenCanvas).toBeUndefined();
    expect(scope.ImageData).toBeUndefined();
  });

  it('leaves an existing canvas implementation untouched', () => {
    const scope = { OffscreenCanvas: class {}, ImageData: class {} };
    const priorCanvas = scope.OffscreenCanvas;
    const priorImage = scope.ImageData;
    expect(installHeadlessImageSupport(scope)).toBeNull();
    expect(scope.OffscreenCanvas).toBe(priorCanvas);
    expect(scope.ImageData).toBe(priorImage);
  });
});
