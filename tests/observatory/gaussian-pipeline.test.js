import { describe, expect, it, vi } from 'vitest';
import { detectGaussianFormat, prepareGaussianRuntimeVisual } from '../../observatory/workbench/gaussianPipeline.js';

describe('Observatory Gaussian upload pipeline', () => {
  it('detects PLY and SPZ by extension or signature', () => {
    expect(detectGaussianFormat({ name:'scene.PLY', bytes:new Uint8Array([0]) })).toBe('ply');
    expect(detectGaussianFormat({ name:'scene.spz', bytes:new Uint8Array([0]) })).toBe('spz');
    expect(detectGaussianFormat({ bytes:new TextEncoder().encode('ply\n') })).toBe('ply');
    expect(detectGaussianFormat({ bytes:new Uint8Array([0x1f,0x8b,0x08,0]) })).toBe('spz');
  });

  it('rejects unrelated uploads before conversion', async () => {
    await expect(prepareGaussianRuntimeVisual({ name:'mesh.obj', bytes:new Uint8Array([1,2,3]) })).rejects.toThrow(/PLY or SPZ/);
  });

  it('routes a Gaussian PLY through SPZ transcoding', async () => {
    const header = new TextEncoder().encode('ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nproperty float scale_0\nproperty float scale_1\nproperty float scale_2\nproperty float rot_0\nproperty float rot_1\nproperty float rot_2\nproperty float rot_3\nproperty float opacity\nproperty float f_dc_0\nproperty float f_dc_1\nproperty float f_dc_2\nend_header\n');
    const bytes = new Uint8Array(header.byteLength + 14 * 4);
    bytes.set(header);
    const data = new DataView(bytes.buffer, header.byteLength);
    [0,0,0,0,0,0,1,0,0,0,1,0,0,0].forEach((value, index) => data.setFloat32(index * 4, value, true));
    const transcode = vi.fn(async () => ({ fileBytes:new Uint8Array([0x1f,0x8b,0x08,0]) }));
    const result = await prepareGaussianRuntimeVisual({ name:'world.ply', bytes, transcode });
    expect(result).toMatchObject({ inputFormat:'ply', runtimeFormat:'spz', converted:true, splatCount:1 });
    expect(transcode).toHaveBeenCalledOnce();
  });
});
