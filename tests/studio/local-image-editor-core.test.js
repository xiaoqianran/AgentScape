import { describe, expect, it } from 'vitest';
import {
  cropRect,
  normalizeCropInsets,
  paintAlphaBrush,
  resetAlpha
} from '../../studio/react/build/LocalImageEditorCore';

describe('LocalImageEditorCore', () => {
  it('normalizes crop insets and preserves a non-empty image area', () => {
    expect(normalizeCropInsets({ left:-5, top:10, right:60, bottom:200 })).toEqual({
      left:0,
      top:10,
      right:45,
      bottom:45
    });
    expect(cropRect(1000, 500, { left:10, top:20, right:30, bottom:10 })).toEqual({
      x:100,
      y:100,
      width:600,
      height:350
    });
  });

  it('erases alpha inside the brush without changing RGB and restores source alpha', () => {
    const width = 3;
    const height = 3;
    const base = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < base.length; index += 4) {
      base[index] = 10;
      base[index + 1] = 20;
      base[index + 2] = 30;
      base[index + 3] = 200;
    }
    const working = new Uint8ClampedArray(base);
    paintAlphaBrush(working, base, width, height, 1, 1, 0.5, 'erase');
    const center = (1 * width + 1) * 4;
    expect([...working.slice(center, center + 4)]).toEqual([10, 20, 30, 0]);
    expect([...working.slice(0, 4)]).toEqual([10, 20, 30, 200]);

    paintAlphaBrush(working, base, width, height, 1, 1, 0.5, 'restore');
    expect(working[center + 3]).toBe(200);

    working[3] = 0;
    resetAlpha(working, base);
    expect(working[3]).toBe(200);
  });

  it('fails closed when brush buffers do not match the declared image', () => {
    expect(() => paintAlphaBrush(
      new Uint8ClampedArray(4),
      new Uint8ClampedArray(8),
      1,
      1,
      0,
      0,
      1,
      'erase'
    )).toThrow(/matching RGBA/);
  });
});
