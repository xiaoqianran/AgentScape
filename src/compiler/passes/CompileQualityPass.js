export class CompileQualityPass {
  async run(context) {
    const hard = [...context.geometry.warnings.filter((item) => item.severity === 'hard')];
    const advisory = [...context.geometry.warnings.filter((item) => item.severity !== 'hard')];

    if (context.collision.quality === 'coarse') {
      advisory.push({ code: 'COLLIDER_COARSE', message: '当前仅有 AABB 碰撞代理。' });
    }
    if ((context.semantics.confidence ?? 0) < 0.5) {
      advisory.push({ code: 'SEMANTIC_LOW_CONFIDENCE', message: '语义分类置信度较低。' });
    }
    if (context.articulation.candidates.length && !context.articulation.parts) {
      advisory.push({ code: 'ARTICULATION_UNVERIFIED', message: '发现关节候选，但尚未生成并验证可执行关节。' });
    }

    const status = hard.length ? 'rejected' : advisory.length ? 'provisional' : 'ready';
    return { ...context, quality: { status, hard, advisory } };
  }
}
