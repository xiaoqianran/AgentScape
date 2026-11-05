import { expect, it } from 'vitest';
import { createSession } from '../../application/createSession.js';
import { AgentTools } from '../../application/AgentTools.js';
import { bootstrapWorld } from '../../modules/agent/bootstrapWorld.js';
import { createBlankWorld } from '../../modules/world/content/blankWorld.js';
import { ENVIRONMENTS } from '../../modules/world/content/environments.js';
import { createIndustrialCabinet } from '../../modules/asset/loading/builtins/IndustrialCabinet.js';
import { assetManifests } from '../../modules/asset/registry/manifests/index.js';
import { validateAssetManifest } from '../../modules/asset/model/schema.js';

async function finish(scene, job, limit = 2500) {
  for (let frame = 0; frame < limit && scene.getJob(job.id).status === 'running'; frame++) {
    scene.step();
    if (frame % 12 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    else await Promise.resolve();
  }
  expect(scene.getJob(job.id).status).not.toBe('running');
  return scene.waitJob(job.id);
}

it('industrial cabinet declares four independently articulated meshes', async () => {
  expect(() => validateAssetManifest(assetManifests.industrial_cabinet)).not.toThrow();
  const asset = await createIndustrialCabinet();
  try {
    const names = ['LeftDoorHinge', 'RightDoorHinge', 'UpperDrawerSlide', 'LowerDrawerSlide'];
    for (const name of names) expect(asset.getObjectByName(name)).toBeTruthy();
    expect(Object.keys(assetManifests.industrial_cabinet.parts)).toHaveLength(4);
    expect(asset.getObjectByName('LeftDoorHinge').position.x).toBeLessThan(0);
    expect(asset.getObjectByName('RightDoorHinge').position.x).toBeGreaterThan(0);
  } finally {
    asset.traverse(object => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) object.material.forEach(material => material.dispose());
      else object.material?.dispose?.();
    });
  }
});

const checkParts = [
  ['left_door', -1.3], ['right_door', 1.3],
  ['upper_drawer', 0.45], ['lower_drawer', 0.45]
];

for (const [partName, expected] of checkParts) {
  it(`Agent opens and closes ${partName} with verified physics`, async () => {
    const definition = ENVIRONMENTS.find(value => value.id === 'industrial-cabinet-lab');
    expect(definition).toBeTruthy();
    const session = createSession(null, {
      environmentFactory: () => createBlankWorld({ id:'industrial-cabinet-lab' })
    });
    await session.world.init();
    const { world, scene } = session;
    try {
      await bootstrapWorld(new AgentTools(world, { actor:'agent_01', profile:'builder', source:'test' }), {...definition.bootstrap,agent:partName === 'right_door' ? [2,0,1.5] : definition.bootstrap.agent});
      const target = 'industrial_cabinet_01';
      const parts = world.physics.entries.get(target).parts;
      expect([...parts.keys()].sort()).toEqual(['left_door','lower_drawer','right_door','upper_drawer']);
      const actions = scene.inspect(target, { actor:'agent_01' }).actions;
      expect(actions.find(action => action.action === 'open' && action.partName === partName)).toBeTruthy();

      const opened = await finish(scene, scene.interact({ actor:'agent_01', target, action:'open', partName }));
      expect(opened.status, JSON.stringify({ partName, opened })).toBe('succeeded');
      expect(opened.result?.verification?.status).toBe('verified');
      expect(world.physics.getArticulationState(target, partName).coordinate).toBeCloseTo(expected, 1);
      expect(world.physics.articulationPenetrations(target, partName, { refresh:true })).toEqual([]);

      const closed = await finish(scene, scene.interact({ actor:'agent_01', target, action:'close', partName }));
      expect(closed.status, JSON.stringify({ partName, closed })).toBe('succeeded');
      expect(closed.result?.verification?.status).toBe('verified');
      expect(world.physics.getArticulationState(target, partName).coordinate).toBeCloseTo(0, 1);
    } finally {
      scene.close();
      world.dispose();
    }
  }, 90000);
}