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
    const providerLevels=context.providerEvidence?.levels || null;
    if (providerLevels?.partSegmentation === 'provider' && providerLevels?.partSemantics !== 'provider-verified') {
      advisory.push({ code:'PART_SEMANTICS_UNVERIFIED', message:'Provider 已提供 Part segmentation，但 semantic Part 仍未验证。' });
    }
    if (providerLevels?.grasps === 'raw-provider-unverified' || providerLevels?.grasps === 'sapien-provider-unverified') {
      advisory.push({ code:'PROVIDER_GRASP_UNVERIFIED', message:'Provider 声明了 grasp artifact，但 AgentScape 尚未验证其 bytes/hash/schema。' });
    } else if (providerLevels?.grasps === 'raw-provider-only') {
      advisory.push({ code:'PROVIDER_GRASP_RAW_ONLY', message:'Provider 只有已验证 bytes/schema 的 raw grasp candidates；不得视为 AgentScape pickup 已验证。' });
    } else if (providerLevels?.grasps === 'sapien-validated-provider-only') {
      advisory.push({ code:'PROVIDER_GRASP_SAPIEN_ONLY', message:'Grasp bytes/schema 已验证且仅通过 Provider/SAPIEN 验证，尚未通过 AgentScape/Rapier runtime verification。' });
    }
    if (context.partSegmentation?.issues?.length) {
      advisory.push({ code:'PART_SEGMENTATION_INVALID', message:`Part segmentation evidence 存在 ${context.partSegmentation.issues.length} 个格式或覆盖错误。` });
    } else if (context.partSegmentation?.materialization?.status === 'rejected') {
      advisory.push({ code:'PART_SEGMENTATION_MATERIALIZATION_FAILED', message:'face-level Part 分割未能安全转换为 GLB Part Nodes。' });
    } else if (context.partSegmentation && context.partSegmentation?.materialization?.status !== 'materialized' && Object.keys(context.articulation.parts || {}).length === 0) {
      advisory.push({ code:'PART_SEGMENTATION_UNMATERIALIZED', message:'已有 face-level Part 分割证据，但尚未转换成与 GLB Node 对齐的 Part。' });
    }
    if (context.partProposal?.issues?.length) {
      advisory.push({ code:'PART_PROPOSAL_INVALID', message:`Part Proposal 存在 ${context.partProposal.issues.length} 个结构错误，未提升为可执行 Part。` });
    } else if (context.partProposal?.unpromoted?.length) {
      advisory.push({ code:'PART_PROPOSAL_PARTIAL', message:`Part Proposal 中有 ${context.partProposal.unpromoted.length} 个 Part 缺少可执行条件。` });
    }
    if (context.collision.quality === 'coarse') {
      advisory.push({ code: 'COLLIDER_COARSE', message: '当前仅有 AABB 碰撞代理。' });
    }
    if (context.partCollision?.final?.generated?.length) {
      advisory.push({ code:'PART_COLLIDER_COARSE', message:`${context.partCollision.final.generated.length} 个可执行 Part 当前使用 owned-mesh AABB 碰撞体。` });
    }
    if (context.partCollision?.final?.mass?.status === 'unpartitioned') {
      advisory.push({ code:'ARTICULATED_MASS_UNPARTITIONED', message:'Provider 的 whole-asset mass 尚未可靠分配到 Root/Parts，因此未作为 Root mass 使用。' });
    }
    if (context.partGeometry?.error) {
      advisory.push({ code:'PART_GEOMETRY_ENRICHMENT_FAILED', message:'可选 per-part 重型几何 Provider 失败，继续使用浏览器 fallback collider。' });
    }
    if (context.partGeometry?.issues?.length) {
      advisory.push({ code:'PART_GEOMETRY_PROVIDER_INVALID', message:`per-part Provider 返回 ${context.partGeometry.issues.length} 个无效结果，已忽略并保留 fallback。` });
    }
    if ((context.semantics.confidence ?? 0) < 0.5) {
      advisory.push({ code: 'SEMANTIC_LOW_CONFIDENCE', message: '语义分类置信度较低。' });
    }
    const executableArticulation = Object.values(context.articulation.parts || {}).some((part) => part.joint && Object.keys(part.targets || {}).length);
    if (context.articulation.candidates.length && !context.articulation.parts) {
      advisory.push({ code: 'ARTICULATION_CANDIDATE_ONLY', message: '发现关节候选，但尚未生成可执行 Part/Joint。' });
    } else if (executableArticulation && !context.verification?.articulation?.ok) {
      advisory.push({ code: 'ARTICULATION_UNVERIFIED', message: '已生成可执行 Part/Joint，但尚未通过运行时运动验证。' });
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
