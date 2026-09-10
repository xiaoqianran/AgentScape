export type CropInsets = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type AlphaBrushMode = 'erase' | 'restore';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function normalizeCropInsets(value: Partial<CropInsets> = {}): CropInsets {
  const next: CropInsets = {
    left:clamp(Number(value.left) || 0, 0, 45),
    top:clamp(Number(value.top) || 0, 0, 45),
    right:clamp(Number(value.right) || 0, 0, 45),
    bottom:clamp(Number(value.bottom) || 0, 0, 45)
  };
  const horizontal = next.left + next.right;
  const vertical = next.top + next.bottom;
  if (horizontal > 90) {
    const scale = 90 / horizontal;
    next.left *= scale;
    next.right *= scale;
  }
  if (vertical > 90) {
    const scale = 90 / vertical;
    next.top *= scale;
    next.bottom *= scale;
  }
  return next;
}

export function cropRect(width: number, height: number, insets: Partial<CropInsets> = {}) {
  const sourceWidth = Math.max(1, Math.floor(Number(width) || 1));
  const sourceHeight = Math.max(1, Math.floor(Number(height) || 1));
  const crop = normalizeCropInsets(insets);
  const x = Math.floor(sourceWidth * crop.left / 100);
  const y = Math.floor(sourceHeight * crop.top / 100);
  const right = Math.ceil(sourceWidth * (1 - crop.right / 100));
  const bottom = Math.ceil(sourceHeight * (1 - crop.bottom / 100));
  return {
    x,
    y,
    width:Math.max(1, right - x),
    height:Math.max(1, bottom - y)
  };
}

export function paintAlphaBrush(
  rgba: Uint8ClampedArray,
  baseRgba: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
  mode: AlphaBrushMode
) {
  if (rgba.length !== baseRgba.length || rgba.length !== width * height * 4) {
    throw new TypeError('Alpha brush requires matching RGBA buffers');
  }
  const r = Math.max(1, Number(radius) || 1);
  const minX = clamp(Math.floor(x - r), 0, width - 1);
  const maxX = clamp(Math.ceil(x + r), 0, width - 1);
  const minY = clamp(Math.floor(y - r), 0, height - 1);
  const maxY = clamp(Math.ceil(y + r), 0, height - 1);
  const r2 = r * r;
  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const dx = px - x;
      const dy = py - y;
      if (dx * dx + dy * dy > r2) continue;
      const alpha = (py * width + px) * 4 + 3;
      rgba[alpha] = mode === 'erase' ? 0 : baseRgba[alpha];
    }
  }
  return rgba;
}

export function resetAlpha(rgba: Uint8ClampedArray, baseRgba: Uint8ClampedArray) {
  if (rgba.length !== baseRgba.length || rgba.length % 4 !== 0) {
    throw new TypeError('Alpha reset requires matching RGBA buffers');
  }
  for (let index = 3; index < rgba.length; index += 4) rgba[index] = baseRgba[index];
  return rgba;
}
