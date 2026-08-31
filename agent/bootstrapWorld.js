const DEFAULT = { agent:[0,0,9], table:[5.2,0,4.2], cabinet:[-5.2,0,3.9], cup:[5.55,1.4,4.2] };

export async function bootstrapWorld(tools, placement = DEFAULT) {
  if (placement.agent) await tools.call('spawnAsset', { assetId:'agent', position:placement.agent, instanceId:'agent_01' });
  if (placement.table) await tools.call('spawnAsset', { assetId:'table', position:placement.table, instanceId:'table_01' });
  if (placement.cabinet) await tools.call('spawnAsset', { assetId:'cabinet', position:placement.cabinet, instanceId:'cabinet_01' });
  if (placement.cup) await tools.call('spawnAsset', { assetId:'cup', position:placement.cup, instanceId:'cup_01' });
}
