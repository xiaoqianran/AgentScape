const safeName = (name = '') => name.trim().toLowerCase();

export class GeometryPass {
  async run(context) {
    const scene = context.inspection.scene;
    if (!scene) throw new Error('GLB contains no scene');
    const min = scene.bboxMin.map(Number);
    const max = scene.bboxMax.map(Number);
    const size = max.map((v, i) => v - min[i]);
    const center = min.map((v, i) => (v + max[i]) / 2);
    const maxSide = Math.max(...size);
    const names = context.inspection.nodes.map((n) => safeName(n.name));
    const warnings = [];
    if (!Number.isFinite(maxSide) || maxSide <= 0) warnings.push({ code: 'GEOMETRY_EMPTY', severity: 'hard', message: 'Asset has invalid or empty scene bounds.' });
    if (maxSide > 100 || (maxSide > 0 && maxSide < 0.001)) warnings.push({ code: 'SCALE_SUSPICIOUS', severity: 'advisory', message: `Longest side is ${maxSide}; physical scale may need normalization.` });
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
