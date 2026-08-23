const DEFAULT = { table:[5.2,0,4.2], cabinet:[-5.2,0,3.9], cup:[5.55,1.4,4.2] };

export async function bootstrapWorld(tools, placement = DEFAULT) {
  await tools.call('spawnAsset', { assetId:'table', position:placement.table, instanceId:'table_01' });
  await tools.call('spawnAsset', { assetId:'cabinet', position:placement.cabinet, instanceId:'cabinet_01' });
  await tools.call('spawnAsset', { assetId:'cup', position:placement.cup, instanceId:'cup_01' });
}
