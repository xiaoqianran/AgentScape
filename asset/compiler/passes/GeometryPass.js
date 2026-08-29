import { getBounds } from '@gltf-transform/core';

const safeName = (name = '') => name.trim().toLowerCase();

export class GeometryPass {
  async run(context) {
    const root = context.document.getRoot();
    const scene = root.getDefaultScene() || root.listScenes()[0];
    if (!scene) throw new Error('GLB contains no scene');
    const bounds = getBounds(scene);
    const min = bounds.min.map(Number);
    const max = bounds.max.map(Number);
    const size = max.map((value, index) => value - min[index]);
    const center = min.map((value, index) => (value + max[index]) / 2);
    const maxSide = Math.max(...size);
    const names = context.inspection.nodes.map((node) => safeName(node.name));
    const warnings = [...context.structure.warnings];
    if (!Number.isFinite(maxSide) || maxSide <= 0) warnings.push({ code: 'GEOMETRY_EMPTY', severity: 'hard', message: '资产几何为空或 Bounds 无效。' });
    if (maxSide > 100 || (maxSide > 0 && maxSide < 0.001)) warnings.push({ code: 'SCALE_SUSPICIOUS', severity: 'advisory', message: `最长边为 ${maxSide}m，物理尺度可能异常。` });
    if (Math.abs(min[1]) > 1e-5) warnings.push({ code: 'GROUND_NORMALIZATION_FAILED', severity: 'hard', message: `规范化后最低点仍为 y=${min[1]}。` });
    return {
      ...context,
      geometry: {
        bounds: { min, max, center, size },
        maxSide,
        originToGround: -min[1],
        namedNodes: names.filter(Boolean),
        warnings
      }
    };
  }
}
