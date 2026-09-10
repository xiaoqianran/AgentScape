const MiB = 1024 * 1024;

export const RESOURCE_BUDGET = Object.freeze({
  maxInputBytes: 100 * MiB,
  renderVertices: { advisory: 1_000_000, hard: 3_000_000 },
  drawCalls: { advisory: 200, hard: 800 },
  textureVRAM: { advisory: 256 * MiB, hard: 512 * MiB },
  maxTextureDimension: { advisory: 4096, hard: 8192 },
  animationKeyframes: { advisory: 100_000, hard: 500_000 }
});
