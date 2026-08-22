export async function bootstrapWorld(tools) {
  await tools.call('spawnAsset', { assetId: 'table', position: [0, 0, 0], instanceId: 'table_01' });
  await tools.call('spawnAsset', { assetId: 'cabinet', position: [-2.7, 0, -1.1], instanceId: 'cabinet_01' });
  await tools.call('spawnAsset', { assetId: 'cup', position: [0.35, 1.4, 0], instanceId: 'cup_01' });
}
