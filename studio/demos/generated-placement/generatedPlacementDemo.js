export const GENERATED_PLACEMENT_DEMO = Object.freeze({
  id: 'generated-placement',
  title: '文生 3D 放置',
  detail: '生成一个新物体，并让 Runtime 按语义关系放到正确位置',
  prompt: '生成一个红色陶瓷花瓶，并把它放到 table_01 的桌面上。不要猜测世界坐标；优先复用已有资产，缺失时允许生成，并由 Runtime 验证最终 ON 关系。',
  assetId: 'generated_red_ceramic_vase',
  instanceId: 'vase_01',
  assetPrompt: 'a red ceramic vase, simple elegant shape, glossy surface, standing upright',
  assetLabel: 'Red Ceramic Vase',
  supportId: 'table_01',
  surfaceId: 'top'
});

export function generatedPlacementDemoTask() {
  return { ...GENERATED_PLACEMENT_DEMO };
}
