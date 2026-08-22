export class CompileQualityPass {
  async run(context) {
    const hard = [
      ...context.geometry.warnings.filter((item) => item.severity === 'hard'),
      ...(context.resources?.hard || [])
    ];
    const advisory = [
      ...context.geometry.warnings.filter((item) => item.severity !== 'hard'),
      ...(context.resources?.advisory || [])
    ];

    if (context.enrichment?.error) {
      advisory.push({ code: 'ENRICHMENT_FAILED', message: `重型 Provider 失败，已保留本地 fallback：${context.enrichment.error}` });
    }
    if (context.collision.quality === 'coarse') {
      advisory.push({ code: 'COLLIDER_COARSE', message: '当前仅有 AABB 碰撞代理。' });
    }
    if ((context.semantics.confidence ?? 0) < 0.5) {
      advisory.push({ code: 'SEMANTIC_LOW_CONFIDENCE', message: '语义分类置信度较低。' });
    }
    if (context.articulation.candidates.length && !context.articulation.parts) {
      advisory.push({ code: 'ARTICULATION_UNVERIFIED', message: '发现关节候选，但尚未生成并验证可执行关节。' });
    }
    if (context.meshQuality?.watertight === false) {
      advisory.push({ code: 'MESH_NOT_WATERTIGHT', message: '服务端几何检查发现 Mesh 非封闭；质量、体积和凸分解结果需要谨慎使用。' });
    }
    if (context.meshQuality?.windingConsistent === false) {
      advisory.push({ code: 'MESH_WINDING_INCONSISTENT', message: '服务端几何检查发现三角形绕序不一致。' });
    }
    if ((context.meshQuality?.components ?? 1) > 1) {
      advisory.push({ code: 'MESH_MULTIPLE_COMPONENTS', message: `Mesh 包含 ${context.meshQuality.components} 个不连通组件。` });
    }

    const status = hard.length ? 'rejected' : advisory.length ? 'provisional' : 'ready';
    return { ...context, quality: { status, hard, advisory } };
  }
}
