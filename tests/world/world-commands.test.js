import { describe, expect, it, vi } from 'vitest';
import { WorldCommands } from '../../modules/world/runtime/WorldCommands.js';

const manifest = (id, status = 'ready') => ({
  id,
  type:'prop',
  actions:[],
  compiler:{ quality:{
    status,
    hard:status === 'rejected' ? [{ code:'POLICY_REJECT' }] : [],
    advisory:[]
  }}
});

function runtimeFixture({ admission = 'ready', ready = true } = {}) {
  return {
    ready,
    assetRegistry:{ getManifest:vi.fn((id) => manifest(id, admission)) },
    store:{ get:vi.fn((id) => ({ id, assetId:'cup' })) },
    spawn: vi.fn(async () => 'cup_01'),
    applyObjectTransform: vi.fn(() => ({ status:'object-transformed' })),
    duplicate: vi.fn(async () => 'cup_02'),
    remove: vi.fn(() => true),
    navigateAgent: vi.fn(() => ({ status:'arrived' })),
    approachAndInteract: vi.fn(() => ({ status:'action-completed' })),
    approachAndPickup: vi.fn(() => ({ status:'held' })),
    approachAndPlace: vi.fn(() => ({ status:'placed' })),
    dropHeld: vi.fn(() => ({ status:'dropped' })),
    markRecoveryHeld: vi.fn(() => true),
    cleanupRecoveryBlocker: vi.fn(() => ({ status:'recovery-cleaned' })),
    applyStateTransition: vi.fn(() => ({ status:'state-transition-applied' })),
    interactions: {
      pickup: vi.fn(() => true),
      drop: vi.fn(() => true),
      place: vi.fn(() => true),
      setArticulationAction: vi.fn(() => true)
    },
    affordances: { execute: vi.fn(() => ({ verified:true })) },
    repair: { repair: vi.fn(() => ({ status:'repaired' })) }
  };
}

describe('WorldCommands', () => {
  it('routes public mutations through the WorldRuntime boundary', async () => {
    const runtime = runtimeFixture();
    const commands = new WorldCommands(runtime);

    await commands.spawn('cup', { id:'cup_01' });
    commands.transform('cup_01', { position:[1, 0, 0] }, { source:'agent' });
    await commands.duplicate('cup_01');
    commands.remove('cup_01');
    commands.navigate('agent_01', [1, 0, 1]);
    commands.pickup('cup_01');
    commands.drop('cup_01');
    commands.place('cup_01', 'table_01');
    commands.setArticulationAction('cabinet_01', 'open');
    commands.approachAndInteract('agent_01', 'cabinet_01', 'open');
    commands.approachAndPickup('agent_01', 'cup_01');
    commands.approachAndPlace('agent_01', 'table_01');
    commands.dropHeld('agent_01');
    commands.markRecoveryHeld('agent_01', { blockerId:'box_01' });
    commands.cleanupRecoveryBlocker('agent_01', 'cabinet_01');
    commands.applyStateTransition('lamp_01', 'on', true);
    commands.executeAffordance({ targetId:'lamp_01', action:'turn_on' });
    commands.repair({ ok:false });

    expect(runtime.spawn).toHaveBeenCalledWith('cup', { id:'cup_01' });
    expect(runtime.applyObjectTransform).toHaveBeenCalledWith('cup_01', { position:[1, 0, 0] }, { source:'agent' });
    expect(runtime.interactions.setArticulationAction).toHaveBeenCalledWith('cabinet_01', 'open', {});
    expect(runtime.approachAndPickup).toHaveBeenCalledWith('agent_01', 'cup_01', {});
    expect(runtime.affordances.execute).toHaveBeenCalledWith({ targetId:'lamp_01', action:'turn_on' }, {});
    expect(runtime.repair.repair).toHaveBeenCalledWith({ ok:false }, {});
  });

  it('enforces Asset admission at the public spawn boundary', async () => {
    const rejectedRuntime = runtimeFixture({ admission:'rejected' });
    const rejected = await new WorldCommands(rejectedRuntime).spawn('bad', { id:'bad_01' });
    expect(rejected).toMatchObject({
      status:'asset-rejected',
      assetId:'bad',
      admission:{ status:'rejected' }
    });
    expect(rejectedRuntime.spawn).not.toHaveBeenCalled();

    const rejectedDuplicate = await new WorldCommands(rejectedRuntime).duplicate('cup_01');
    expect(rejectedDuplicate).toMatchObject({
      status:'asset-rejected',
      assetId:'cup',
      sourceId:'cup_01',
      admission:{ status:'rejected' }
    });
    expect(rejectedRuntime.duplicate).not.toHaveBeenCalled();

    const provisionalRuntime = runtimeFixture({ admission:'provisional' });
    const provisional = await new WorldCommands(provisionalRuntime).spawn('draft', { id:'draft_01' });
    expect(provisional).toMatchObject({
      status:'asset-provisional',
      id:'cup_01',
      assetId:'draft',
      admission:{ status:'provisional' }
    });
    expect(provisionalRuntime.spawn).toHaveBeenCalledWith('draft', { id:'draft_01' });

    const provisionalDuplicate = await new WorldCommands(provisionalRuntime).duplicate('cup_01');
    expect(provisionalDuplicate).toMatchObject({
      status:'asset-provisional',
      id:'cup_02',
      assetId:'cup',
      sourceId:'cup_01',
      admission:{ status:'provisional' }
    });
    expect(provisionalRuntime.duplicate).toHaveBeenCalledWith('cup_01');
  });

  it('fails with a stable error before mutating an uninitialized WorldRuntime', async () => {
    const runtime = runtimeFixture({ ready:false });
    const commands = new WorldCommands(runtime);

    await expect(commands.spawn('cup')).rejects.toMatchObject({
      code:'WORLD_COMMAND_NOT_READY',
      command:'spawn'
    });
    expect(runtime.spawn).not.toHaveBeenCalled();

    expect(() => commands.transform('cup_01', { position:[0, 0, 0] })).toThrow(
      expect.objectContaining({ code:'WORLD_COMMAND_NOT_READY', command:'transform' })
    );
    expect(runtime.applyObjectTransform).not.toHaveBeenCalled();
  });
});
