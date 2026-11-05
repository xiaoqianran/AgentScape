import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorldRuntime } from '../../modules/world/runtime/WorldRuntime.js';
import { createAssetModule } from '../../modules/asset/AssetModule.js';
import { SkillRegistry } from '../../application/skills/SkillRegistry.js';
import { registerCoreSkills } from '../../application/skills/registerCoreSkills.js';
import { commitWorldAuthority } from '../../modules/world/runtime/WorldAuthority.js';

const worlds = [];
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

async function createWorld() {
  const world = new WorldRuntime({
    assetModule: createAssetModule({ manifestStore: null, libraryStore: null }),
    environmentFactory: () => ({
      id: 'state-consistency-test',
      root: new THREE.Group(),
      colliders: [],
      dispose() {}
    })
  });
  worlds.push(world);
  await world.init();
  return world;
}

function installRevision(world, id, { event = 'test.fire', value = true } = {}) {
  commitWorldAuthority(world, {
    worldIR: { revision: { id }, provenance: { source: 'test' } },
    behaviorBundle: {
      ruleGraph: [{
        id: `rule-${id}`, event,
        effect: { kind: 'set-state', targetId: 'chair', stateKey: 'enabled', value }
      }]
    },
    physicsRequirements: { worldRevisionId: id, requirements: [] }
  });
}

async function flushRules(world) {
  // A rule may append a follow-up rule while the previous queue is settling.
  for (let attempts = 0; attempts < 40; attempts += 1) {
    const queue = world.ruleRuntime.queue;
    await queue;
    if (queue === world.ruleRuntime.queue) return;
  }
  throw new Error('Rule queue did not converge');
}

afterEach(() => {
  for (const world of worlds.splice(0)) world.dispose();
});

describe('World state consistency with real Runtime and Rapier', () => {
  it('rejects undo, redo and external restore during an unfinished mutation', async () => {
    const world = await createWorld();
    await world.spawn('chair', { id: 'chair' });
    const original = world.snapshot();
    await world.mutate('first', () => world.commands.transform('chair', { position: [1, 0, 0] }));
    const gate = deferred();
    const operation = world.mutate('slow', async () => {
      world.commands.transform('chair', { position: [2, 0, 0] });
      await gate.promise;
      return { status: 'finished' };
    });
    try {
      await expect(world.history.undo()).rejects.toMatchObject({ code: 'WORLD_MUTATION_BUSY' });
      await expect(world.history.redo()).rejects.toMatchObject({ code: 'WORLD_MUTATION_BUSY' });
      await expect(world.restore(original)).rejects.toMatchObject({ code: 'WORLD_MUTATION_BUSY' });
      expect(world.store.get('chair').object.position.x).toBe(2);
    } finally {
      gate.resolve();
      await operation;
    }
    expect(world.history.status()).toMatchObject({ undo: 2, redo: 0 });
  });

  it('also protects history and restore from non-history mutations and editor drags', async () => {
    const world = await createWorld();
    await world.spawn('chair', { id: 'chair' });
    await world.mutate('move', () => world.commands.transform('chair', { position: [1, 0, 0] }));
    const saved = world.snapshot();
    const gate = deferred();
    const operation = world.exclusiveMutation('exclusive', () => gate.promise);
    try {
      await expect(world.history.undo()).rejects.toMatchObject({ code: 'WORLD_MUTATION_BUSY' });
      await expect(world.restore(saved)).rejects.toMatchObject({ code: 'WORLD_MUTATION_BUSY' });
    } finally {
      gate.resolve();
      await operation;
    }
    expect(world.beginMutation('editor')).toBe(true);
    try {
      await expect(world.history.undo()).rejects.toMatchObject({ code: 'WORLD_MUTATION_BUSY' });
      await expect(world.restore(saved)).rejects.toMatchObject({ code: 'WORLD_MUTATION_BUSY' });
    } finally {
      world.commitMutation({ id: 'chair' });
    }
  });

  it('holds the write boundary and blocks simulation only during destructive restore', async () => {
    const world = await createWorld();
    await world.spawn('chair', { id: 'chair' });
    const saved = world.snapshot();
    const gate = deferred();
    const started = deferred();
    const instantiate = world.assetModule.instantiate;
    vi.spyOn(world.assetModule, 'instantiate').mockImplementationOnce(async (...args) => {
      started.resolve();
      await gate.promise;
      return instantiate(...args);
    });
    world.simulation.play();
    const restoring = world.restore(saved);
    await started.promise;
    const step = vi.spyOn(world.physics, 'step');
    const tick = world.simulation.tick;
    try {
      await expect(world.mutate('other', () => true)).rejects.toMatchObject({ code: 'WORLD_MUTATION_BUSY' });
      await expect(world.exclusiveMutation('other', () => true)).rejects.toMatchObject({ code: 'WORLD_MUTATION_BUSY' });
      await expect(world.restore(saved)).rejects.toMatchObject({ code: 'WORLD_MUTATION_BUSY' });
      expect(world.beginMutation('editor')).toBe(false);
      world.simulation.step();
      expect(step).not.toHaveBeenCalled();
      expect(world.simulation.tick).toBe(tick);
    } finally {
      gate.resolve();
      await restoring;
    }
    expect(world.simulation.running).toBe(true);
    world.simulation.step();
    expect(step).toHaveBeenCalledOnce();
  });

  it('restores matching revision, behavior and physics requirements on undo and redo', async () => {
    const world = await createWorld();
    await world.spawn('chair', { id: 'chair' });
    installRevision(world, 'A');
    await world.mutate('revision', () => {
      world.commands.transform('chair', { position: [2, 0, 0] });
      installRevision(world, 'B');
    });
    for (const [direction, revision, x] of [['undo', 'A', 0], ['redo', 'B', 2]]) {
      await world.history[direction]();
      expect(world.currentWorldRevision.revision.id).toBe(revision);
      expect(world.currentPhysicsRequirements.worldRevisionId).toBe(revision);
      expect(world.currentBehaviorBundle.ruleGraph[0].id).toBe(`rule-${revision}`);
      expect(world.ruleRuntime.graph.rules[0].id).toBe(`rule-${revision}`);
      expect(world.store.get('chair').object.position.x).toBe(x);
      expect(world.lastAcceptanceBundle).toBeNull();
    }
  });

  it('records behavior-only edits and clears stale authority when importing a legacy scene', async () => {
    const world = await createWorld();
    await world.spawn('chair', { id: 'chair' });
    installRevision(world, 'A');
    await world.mutate('rules-only', () => {
      const bundle = structuredClone(world.currentBehaviorBundle);
      bundle.ruleGraph[0].effect.value = false;
      world.currentBehaviorBundle = bundle;
      world.loadRuleGraph(bundle.ruleGraph);
    });
    expect(world.history.canUndo()).toBe(true);
    await world.history.undo();
    expect(world.ruleRuntime.graph.rules[0].effect.value).toBe(true);
    const legacy = world.serialize();
    delete legacy.configuration;
    delete legacy.metadata.worldRevision;
    delete legacy.verification;
    await world.restore(legacy);
    expect(world.currentBehaviorBundle).toBeNull();
    expect(world.currentPhysicsRequirements).toBeNull();
    expect(world.ruleRuntime.graph.rules).toEqual([]);
  });

  it('invalidates semantic relations during a transform, before transaction or drag commit', async () => {
    const world = await createWorld();
    await world.spawn('chair', { id: 'a' });
    await world.spawn('chair', { id: 'b', position: [1, 0, 0] });
    expect(world.queries.listRelations({ subject: 'a', predicate: 'NEAR' })).toHaveLength(1);
    expect(world.beginMutation('drag')).toBe(true);
    try {
      world.commands.transform('b', { position: [10, 0, 0] });
      expect(world.queries.listRelations({ subject: 'a', predicate: 'NEAR' })).toEqual([]);
    } finally {
      world.commitMutation({ id: 'b' });
    }
    await world.mutate('two-edits', () => {
      world.commands.transform('b', { position: [1, 0, 0] });
      expect(world.queries.listRelations({ subject: 'a', predicate: 'NEAR' })).toHaveLength(1);
    });
  });

  it('runs transaction events after commit, never while the owning mutation holds the lock', async () => {
    const world = await createWorld();
    await world.spawn('chair', { id: 'chair' });
    installRevision(world, 'A');
    const errors = [];
    world.events.on('rule.error', (event) => errors.push(event.error));
    const gate = deferred();
    const operation = world.mutate('trigger', async () => {
      world.events.emit('test.fire');
      await gate.promise;
    });
    await flushRules(world);
    expect(world.store.get('chair').state.enabled).toBeUndefined();
    gate.resolve();
    await operation;
    await flushRules(world);
    expect(world.store.get('chair').state.enabled).toBe(true);
    expect(errors).toEqual([]);
  });

  it('discards events from failed and explicitly uncommitted mutations', async () => {
    const world = await createWorld();
    await world.spawn('chair', { id: 'chair' });
    installRevision(world, 'A');
    const applied = vi.fn();
    world.events.on('rule.effects-applied', applied);
    await expect(world.mutate('failed', async () => {
      world.events.emit('test.fire');
      await Promise.resolve();
      throw new Error('abort');
    })).rejects.toThrow('abort');
    await world.mutate('rejected', async () => {
      world.events.emit('test.fire');
      return { committed: false };
    });
    await flushRules(world);
    expect(world.store.get('chair').state.enabled).toBeUndefined();
    expect(applied).not.toHaveBeenCalled();
  });

  it('defers already queued events across a concurrent write and discards obsolete rule generations', async () => {
    const world = await createWorld();
    await world.spawn('chair', { id: 'chair' });
    installRevision(world, 'A');
    world.events.emit('test.fire');
    const gate = deferred();
    const operation = world.exclusiveMutation('busy', () => gate.promise);
    await Promise.resolve();
    gate.resolve();
    await operation;
    await flushRules(world);
    expect(world.store.get('chair').state.enabled).toBe(true);
    world.events.emit('test.fire');
    installRevision(world, 'B', { value: false });
    await flushRules(world);
    expect(world.store.get('chair').state.enabled).toBe(true);
  });

  it('does not rebuild the physics world when a mutation fails before changing state', async () => {
    const world = await createWorld();
    await world.spawn('cup', { id: 'cup', position: [0, 5, 0] });
    world.physics.setMotion('cup', { linearVelocity: [1, 0, 0], angularVelocity: [0, 2, 0] });
    const body = world.physics.entries.get('cup').body;
    const reset = vi.spyOn(world.physics, 'resetWorld');
    await expect(world.mutate('invalid', () => { throw new Error('invalid'); })).rejects.toThrow('invalid');
    expect(reset).not.toHaveBeenCalled();
    expect(world.physics.entries.get('cup').body).toBe(body);
    expect(world.physics.getMotion('cup').linearVelocity).toEqual([1, 0, 0]);
    expect(world.physics.getMotion('cup').angularVelocity).toEqual([0, 2, 0]);
  });

  it('preserves body motion when rolling back a partial scene edit', async () => {
    const world = await createWorld();
    await world.spawn('chair', { id: 'chair' });
    await world.spawn('cup', { id: 'cup', position: [0, 5, 0] });
    world.physics.setMotion('cup', { linearVelocity: [1, 0, 0], angularVelocity: [0, 2, 0] });
    await expect(world.mutate('partial', () => {
      world.commands.transform('chair', { position: [5, 0, 0] });
      throw new Error('abort');
    })).rejects.toThrow('abort');
    expect(world.store.get('chair').object.position.x).toBe(0);
    expect(world.physics.getMotion('cup').linearVelocity).toEqual([1, 0, 0]);
    expect(world.physics.getMotion('cup').angularVelocity).toEqual([0, 2, 0]);
    expect(world.mutationOwner).toBeNull();
    expect(world.history.status().undo).toBe(0);
  });

  it('keeps derived relations out of history snapshots without removing them from exports', async () => {
    const world = await createWorld();
    await world.spawn('chair', { id: 'a' });
    await world.spawn('chair', { id: 'b', position: [1, 0, 0] });
    world.sceneGraph.invalidate();
    const rebuild = vi.spyOn(world.sceneGraph, 'rebuild');
    const snapshot = world.snapshot();
    expect(snapshot).not.toHaveProperty('relations');
    expect(rebuild).not.toHaveBeenCalled();
    const exported = world.serialize();
    expect(exported.relations.some((edge) => edge.predicate === 'NEAR')).toBe(true);
  });

  it('continues stepping physics during ordinary asynchronous actions', async () => {
    const world = await createWorld();
    await world.spawn('cup', { id: 'cup', position: [0, 5, 0] });
    const gate = deferred();
    const operation = world.mutate('action', () => gate.promise);
    try {
      const tick = world.simulation.tick;
      world.simulation.step();
      expect(world.simulation.tick).toBe(tick + 1);
      expect(world.physics.getMotion('cup').linearVelocity[1]).toBeLessThan(0);
    } finally {
      gate.resolve();
      await operation;
    }
  });
});


describe('World recovery edge cases', () => {
  it('restores the previous authority and motion after an import fails midway', async () => {
    const world = await createWorld();
    await world.spawn('chair', { id:'chair' });
    await world.spawn('cup', { id:'cup', position:[0,5,0] });
    installRevision(world, 'A', { event:'object.spawned' });
    world.physics.setMotion('cup', { linearVelocity:[2,0,0], angularVelocity:[0,3,0] });
    const saved = world.snapshot();
    const imported = structuredClone(saved);
    imported.objects[0].transform.position = [8,0,0];
    vi.spyOn(world.assetModule, 'instantiate').mockRejectedValueOnce(new Error('import interrupted'));
    world.simulation.play();
    await expect(world.restore(imported)).rejects.toThrow('import interrupted');
    await flushRules(world);
    expect(world.snapshot()).toEqual(saved);
    expect(world.physics.getMotion('cup').linearVelocity).toEqual([2,0,0]);
    expect(world.physics.getMotion('cup').angularVelocity).toEqual([0,3,0]);
    expect(world.ruleRuntime.graph.rules[0].id).toBe('rule-A');
    expect(world.store.get('chair').state.enabled).toBeUndefined();
    expect(world.restoring).toBe(false);
    expect(world.mutationOwner).toBeNull();
    expect(world.simulation.running).toBe(true);
  });

  it('preflights malformed rules and mismatched configuration revisions without replacing bodies', async () => {
    const world = await createWorld();
    await world.spawn('chair', { id:'chair' });
    installRevision(world, 'A');
    const saved = world.snapshot();
    const reset = vi.spyOn(world.physics, 'resetWorld');
    const invalidRules = structuredClone(saved);
    invalidRules.configuration.behaviorBundle.ruleGraph[0].effect.kind = 'unknown';
    await expect(world.restore(invalidRules)).rejects.toThrow('unsupported effect');
    const wrongRevision = structuredClone(saved);
    wrongRevision.configuration.physicsRequirements.worldRevisionId = 'B';
    await expect(world.restore(wrongRevision)).rejects.toThrow('revision mismatch');
    expect(reset).not.toHaveBeenCalled();
    expect(world.snapshot()).toEqual(saved);
    expect(world.mutationOwner).toBeNull();
  });

  it('does not promote saved acceptance evidence or replay restoration events as new rules', async () => {
    const world = await createWorld();
    await world.spawn('chair', { id:'chair' });
    installRevision(world, 'A', { event:'object.spawned' });
    world.lastAcceptanceBundle = {
      schema:'agentscape.acceptance-evidence', schemaVersion:1, worldRevisionId:'A',
      criteria:[], result:{ status:'world-accepted' }
    };
    world.interactionEvidence = new Map([['old', { verified:true }]]);
    const saved = world.snapshot();
    await world.restore(saved);
    await flushRules(world);
    expect(world.lastAcceptanceBundle).toBeNull();
    expect(world.restoredAcceptanceEvidence).toEqual(saved.verification.acceptanceEvidence);
    expect(world.interactionEvidence.size).toBe(0);
    expect(world.store.get('chair').state.enabled).toBeUndefined();
  });

  it('rolls back a real nested Skill batch and preserves the pre-batch body motion', async () => {
    const world = await createWorld();
    await world.spawn('chair', { id:'chair' });
    await world.spawn('cup', { id:'cup', position:[0,5,0] });
    world.physics.setMotion('cup', { linearVelocity:[1,0,0] });
    const skills = registerCoreSkills(new SkillRegistry({ policy:world.policy, trace:world.trace, runtime:world }), world);
    const response = await skills.invoke('executeBatch', { calls:[
      { name:'moveObject', args:{ id:'chair', position:[6,0,0] } },
      { name:'moveObject', args:{ id:'missing', position:[1,0,0] } }
    ] });
    expect(response).toMatchObject({ success:true, result:{ committed:false, rolledBack:true } });
    expect(world.store.get('chair').object.position.x).toBe(0);
    expect(world.physics.getMotion('cup').linearVelocity).toEqual([1,0,0]);
    expect(world.history.status().undo).toBe(0);
  });

  it('restores physics-only motion changes without rebuilding the scene', async () => {
    const world = await createWorld();
    await world.spawn('cup', { id:'cup', position:[0,5,0] });
    world.physics.setMotion('cup', { linearVelocity:[1,0,0] });
    const reset = vi.spyOn(world.physics, 'resetWorld');
    await expect(world.mutate('physics-only', () => {
      world.physics.setMotion('cup', { linearVelocity:[9,0,0] });
      throw new Error('abort');
    })).rejects.toThrow('abort');
    expect(reset).not.toHaveBeenCalled();
    expect(world.physics.getMotion('cup').linearVelocity).toEqual([1,0,0]);
  });

  it('preserves sleeping bodies through a partial scene rollback', async () => {
    const world = await createWorld();
    await world.spawn('chair', { id:'chair' });
    await world.spawn('cup', { id:'cup', position:[0,5,0] });
    world.physics.sleep('cup');
    await expect(world.mutate('partial', () => {
      world.commands.transform('chair', { position:[5,0,0] });
      throw new Error('abort');
    })).rejects.toThrow('abort');
    expect(world.physics.getMotion('cup').sleeping).toBe(true);
  });

  it('buffers exclusive and editor events, and discards failed exclusive events', async () => {
    const world = await createWorld();
    await world.spawn('chair', { id:'chair' });
    installRevision(world, 'A');
    await expect(world.exclusiveMutation('failed', async () => {
      world.events.emit('test.fire');
      await flushRules(world);
      throw new Error('abort');
    })).rejects.toThrow('abort');
    await flushRules(world);
    expect(world.store.get('chair').state.enabled).toBeUndefined();
    expect(world.beginMutation('editor')).toBe(true);
    world.events.emit('test.fire');
    await flushRules(world);
    expect(world.store.get('chair').state.enabled).toBeUndefined();
    world.commitMutation({ id:'chair' });
    await flushRules(world);
    expect(world.store.get('chair').state.enabled).toBe(true);
  });

  it('bounds a real rule cascade and never turns diagnostic errors into an error loop', async () => {
    const world = await createWorld();
    await world.spawn('chair', { id:'chair' });
    world.ruleRuntime.maxCascadeDepth = 3;
    const effect = (value) => ({ kind:'set-state', targetId:'chair', stateKey:'enabled', value });
    world.loadRuleGraph([
      { id:'start', event:'test.fire', effect:effect(true) },
      { id:'off', event:'world.state-transition', condition:{ kind:'equals', targetId:'chair', stateKey:'enabled', value:true }, effect:effect(false) },
      { id:'on', event:'world.state-transition', condition:{ kind:'equals', targetId:'chair', stateKey:'enabled', value:false }, effect:effect(true) },
      { id:'diagnostic', event:'rule.error', effect:effect(false) }
    ]);
    const errors = [];
    world.events.on('rule.error', (event) => errors.push(event.error));
    world.events.emit('test.fire');
    await flushRules(world);
    expect(errors).toEqual([expect.objectContaining({ code:'RULE_CASCADE_DEPTH_EXCEEDED' })]);
    expect(world.history.status().undo).toBe(3);
    expect(world.store.get('chair').state.enabled).toBe(true);
    expect(world.mutationOwner).toBeNull();
  });

  it('does not emit another transition when the requested state is unchanged', async () => {
    const world = await createWorld();
    await world.spawn('chair', { id:'chair' });
    const transitions = vi.fn();
    world.events.on('world.state-transition', transitions);
    world.applyStateTransition('chair', 'enabled', true);
    world.applyStateTransition('chair', 'enabled', true);
    expect(transitions).toHaveBeenCalledOnce();
  });
});


it('propagates rule depth through transaction-generated history events', async () => {
  const world = await createWorld();
  await world.spawn('chair', { id:'chair' });
  world.ruleRuntime.maxCascadeDepth = 3;
  const effect = (value) => ({ kind:'set-state', targetId:'chair', stateKey:'enabled', value });
  world.loadRuleGraph([
    { id:'start', event:'test.fire', effect:effect(true) },
    { id:'off', event:'history.recorded', condition:{kind:'equals',targetId:'chair',stateKey:'enabled',value:true}, effect:effect(false) },
    { id:'on', event:'history.recorded', condition:{kind:'equals',targetId:'chair',stateKey:'enabled',value:false}, effect:effect(true) }
  ]);
  const errors = [];
  world.events.on('rule.error', (event) => errors.push(event.error));
  world.events.emit('test.fire');
  await flushRules(world);
  expect(errors).toEqual([expect.objectContaining({code:'RULE_CASCADE_DEPTH_EXCEEDED'})]);
  expect(world.history.status().undo).toBe(3);
  expect(world.mutationOwner).toBeNull();
});


it('preserves ordered opposite rule effects instead of filtering against the pre-event state', async () => {
  const world = await createWorld();
  await world.spawn('chair', { id:'chair', initialState:{enabled:false} });
  const effect = (value) => ({ kind:'set-state', targetId:'chair', stateKey:'enabled', value });
  world.loadRuleGraph([
    { id:'first', event:'test.fire', effect:effect(true) },
    { id:'second', event:'test.fire', effect:effect(false) }
  ]);
  const transitions = [];
  world.events.on('world.state-transition', (event) => transitions.push(event.value));
  world.events.emit('test.fire');
  await flushRules(world);
  expect(transitions).toEqual([true,false]);
  expect(world.store.get('chair').state.enabled).toBe(false);
});
