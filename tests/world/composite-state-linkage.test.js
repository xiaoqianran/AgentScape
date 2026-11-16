import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { WorldRuntime } from '../../modules/world/runtime/WorldRuntime.js';
import { createAssetModule } from '../../modules/asset/AssetModule.js';

// BEHAVIOR-011: composite state linkage (door + lock) declared as a rule
// graph — no hardcoded branches. Linkage results are asserted in the single
// source of truth (world.store), recorded in history, and rolled back via
// snapshot restore.
const worlds = [];
afterEach(() => { for (const world of worlds.splice(0)) world.dispose(); });

const LINKAGE_RULES = [
  { id: 'release-lock-state', event: 'lock.released', effect: { kind: 'set-state', targetId: 'lock_01', stateKey: 'locked', value: false } },
  { id: 'release-door', event: 'lock.released', effect: { kind: 'set-state', targetId: 'door_01', stateKey: 'locked', value: false } },
  { id: 'engage-lock-state', event: 'lock.engaged', effect: { kind: 'set-state', targetId: 'lock_01', stateKey: 'locked', value: true } },
  { id: 'engage-door', event: 'lock.engaged', effect: { kind: 'set-state', targetId: 'door_01', stateKey: 'locked', value: true } },
  { id: 'forced-entry', event: 'door.opened', condition: { kind: 'equals', targetId: 'door_01', stateKey: 'locked', value: true }, effect: { kind: 'set-state', targetId: 'door_01', stateKey: 'forcedEntry', value: true } }
];

async function createDoorLockWorld() {
  const world = new WorldRuntime({
    assetModule: createAssetModule({ manifestStore: null, libraryStore: null }),
    environmentFactory: () => ({ id: 'door-lock-linkage-test', root: new THREE.Group(), colliders: [], dispose() {} })
  });
  worlds.push(world);
  await world.init();
  await world.spawn('chair', { id: 'door_01', initialState: { open: false, locked: true } });
  await world.spawn('chair', { id: 'lock_01', initialState: { locked: true } });
  world.loadRuleGraph(LINKAGE_RULES);
  return world;
}

async function flushRules(world) {
  for (let attempts = 0; attempts < 40; attempts += 1) {
    const queue = world.ruleRuntime.queue;
    await queue;
    if (queue === world.ruleRuntime.queue) return;
  }
  throw new Error('Rule queue did not converge');
}

const state = (world, id) => world.store.get(id).state;

describe('composite state linkage (door + lock)', () => {
  it('links lock and door state through declared rules only', async () => {
    const world = await createDoorLockWorld();
    expect(state(world, 'door_01')).toMatchObject({ locked: true });
    expect(state(world, 'lock_01')).toMatchObject({ locked: true });
    world.events.emit('lock.released');
    await flushRules(world);
    expect(state(world, 'lock_01').locked).toBe(false);
    expect(state(world, 'door_01').locked).toBe(false);
    world.events.emit('lock.engaged');
    await flushRules(world);
    expect(state(world, 'lock_01').locked).toBe(true);
    expect(state(world, 'door_01').locked).toBe(true);
  });

  it('fires the cross-entity condition only while the door is locked', async () => {
    const lockedWorld = await createDoorLockWorld();
    lockedWorld.events.emit('door.opened');
    await flushRules(lockedWorld);
    expect(state(lockedWorld, 'door_01').forcedEntry).toBe(true);

    const unlockedWorld = await createDoorLockWorld();
    unlockedWorld.events.emit('lock.released');
    await flushRules(unlockedWorld);
    unlockedWorld.events.emit('door.opened');
    await flushRules(unlockedWorld);
    expect(state(unlockedWorld, 'door_01').forcedEntry).toBeUndefined();
  });

  it('records rule effects in history and rolls them back with snapshot restore', async () => {
    const world = await createDoorLockWorld();
    const snapshot = world.snapshot();
    const undoBefore = world.history.status().undo;
    world.events.emit('door.opened');
    await flushRules(world);
    expect(state(world, 'door_01').forcedEntry).toBe(true);
    expect(world.history.status().undo).toBeGreaterThan(undoBefore);
    await world.restore(snapshot);
    expect(state(world, 'door_01').forcedEntry).toBeUndefined();
    expect(state(world, 'door_01').locked).toBe(true);
  });
});
