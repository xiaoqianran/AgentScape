export async function bootstrapWorld(tools) {
  await tools.call('spawnAsset', { assetId: 'table', position: [5.2, 0, 4.2], instanceId: 'table_01' });
  await tools.call('spawnAsset', { assetId: 'cabinet', position: [-5.2, 0, 3.9], instanceId: 'cabinet_01' });
  await tools.call('spawnAsset', { assetId: 'cup', position: [5.55, 1.4, 4.2], instanceId: 'cup_01' });
}
