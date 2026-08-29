import { inspect } from '@gltf-transform/functions';

import { RESOURCE_BUDGET } from '../resourceBudget.js';

const textureDimension = (resolution = '') => Math.max(...resolution.split('x').map(Number).filter(Number.isFinite), 0);
const countDrawCalls = (scene) => {
  let count = 0;
  const visit = (node) => {
    count += node.getMesh()?.listPrimitives().length || 0;
    node.listChildren().forEach(visit);
  };
  scene?.listChildren().forEach(visit);
  return count;
};

export class ResourceBudgetPass {
  async run(context) {
    const report = inspect(context.document);
    const scenes = context.document.getRoot().listScenes();
    const sceneIndex = context.structure.defaultSceneIndex >= 0 ? context.structure.defaultSceneIndex : 0;
    const scene = scenes[sceneIndex];
    const sceneReport = report.scenes.properties[sceneIndex];
    const metrics = {
      optimizedBytes: context.optimizedBytes.byteLength,
      renderVertices: sceneReport?.renderVertexCount || 0,
      uploadVertices: sceneReport?.uploadVertexCount || 0,
      drawCalls: countDrawCalls(scene),
      textureVRAM: report.textures.properties.reduce((sum, texture) => sum + (texture.gpuSize || 0), 0),
      maxTextureDimension: report.textures.properties.reduce((max, texture) => Math.max(max, textureDimension(texture.resolution)), 0),
      animationKeyframes: report.animations.properties.reduce((sum, animation) => sum + animation.keyframes, 0)
    };

    const hard = [];
    const advisory = [];
    const checks = [
      ['renderVertices', 'RENDER_VERTICES', '渲染顶点数'],
      ['drawCalls', 'DRAW_CALLS', 'Draw Call'],
      ['textureVRAM', 'TEXTURE_VRAM', '纹理显存估算'],
      ['maxTextureDimension', 'TEXTURE_DIMENSION', '最大纹理边长'],
      ['animationKeyframes', 'ANIMATION_KEYFRAMES', '动画关键帧数']
    ];
    for (const [key, code, label] of checks) {
      const value = metrics[key];
      const limit = RESOURCE_BUDGET[key];
      if (value > limit.hard) hard.push({ code: `BUDGET_${code}_HARD`, message: `${label} ${value} 超过硬上限 ${limit.hard}。` });
      else if (value > limit.advisory) advisory.push({ code: `BUDGET_${code}`, message: `${label} ${value} 超过建议上限 ${limit.advisory}。` });
    }

    return {
      ...context,
      inspection: { ...context.inspection, report, stats: { ...context.inspection.stats, ...metrics } },
      resources: { metrics, hard, advisory }
    };
  }
}
