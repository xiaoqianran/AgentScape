const EPS = 1e-6;
const isIdentityRotation = ([x, y, z, w]) => Math.abs(x) < EPS && Math.abs(y) < EPS && Math.abs(z) < EPS && Math.abs(w - 1) < EPS;
const isUnitScale = (scale) => scale.every((value) => Math.abs(value - 1) < EPS);

export class StructurePass {
  async run(context) {
    const root = context.document.getRoot();
    const scenes = root.listScenes();
    const defaultScene = root.getDefaultScene() || scenes[0] || null;
    const rootNodes = defaultScene?.listChildren() || [];
    let maxDepth = 0;
    const visit = (node, depth) => {
      maxDepth = Math.max(maxDepth, depth);
      for (const child of node.listChildren()) visit(child, depth + 1);
    };
    rootNodes.forEach((node) => visit(node, 1));

    const negativeScaleNodes = [];
    const transformedRoots = [];
    const nonUniformScaleNodes = [];
    for (const node of root.listNodes()) {
      const scale = node.getScale();
      if (scale[0] * scale[1] * scale[2] < 0) negativeScaleNodes.push(node.getName() || '(unnamed)');
      if (Math.max(...scale) - Math.min(...scale) > EPS) nonUniformScaleNodes.push(node.getName() || '(unnamed)');
    }
    for (const node of rootNodes) {
      if (node.getTranslation().some((value) => Math.abs(value) > EPS) || !isIdentityRotation(node.getRotation()) || !isUnitScale(node.getScale())) {
        transformedRoots.push(node.getName() || '(unnamed)');
      }
    }

    const warnings = [];
    if (scenes.length > 1) warnings.push({ code: 'MULTIPLE_SCENES', severity: 'advisory', message: `GLB 包含 ${scenes.length} 个 Scene；运行时只实例化默认 Scene。` });
    if (!root.getDefaultScene() && scenes.length > 1) warnings.push({ code: 'DEFAULT_SCENE_MISSING', severity: 'advisory', message: '多 Scene GLB 未声明默认 Scene，将使用第一个 Scene。' });
    if (negativeScaleNodes.length) warnings.push({ code: 'NEGATIVE_SCALE', severity: 'advisory', message: `检测到 ${negativeScaleNodes.length} 个负缩放节点；碰撞和法线需要额外验证。` });
    if (root.listSkins().length) warnings.push({ code: 'SKINNED_ASSET', severity: 'advisory', message: '资产包含 Skin；禁止自动 flatten 节点层级。' });
    if (root.listAnimations().length) warnings.push({ code: 'ANIMATED_ASSET', severity: 'advisory', message: '资产包含动画；禁止自动 bake 层级变换。' });

    return {
      ...context,
      structure: {
        scenes: scenes.length,
        defaultSceneIndex: defaultScene ? scenes.indexOf(defaultScene) : -1,
        rootNodes: rootNodes.length,
        maxDepth,
        skins: root.listSkins().length,
        animations: root.listAnimations().length,
        transformedRoots,
        negativeScaleNodes,
        nonUniformScaleNodes,
        warnings,
        policy: {
          centerBelow: Boolean(defaultScene),
          flatten: false,
          inferAxisRotation: false
        }
      }
    };
  }
}
