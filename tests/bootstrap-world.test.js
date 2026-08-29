import { expect, it, vi } from 'vitest';
import { bootstrapWorld } from '../agent/bootstrapWorld.js';

it('bootstraps the embodied agent before the interactive demo assets', async () => {
  const tools={call:vi.fn(async()=>({success:true}))};
  await bootstrapWorld(tools);
  expect(tools.call.mock.calls.map(([,args])=>[args.assetId,args.instanceId])).toEqual([
    ['agent','agent_01'],
    ['table','table_01'],
    ['cabinet','cabinet_01'],
    ['cup','cup_01']
  ]);
});
