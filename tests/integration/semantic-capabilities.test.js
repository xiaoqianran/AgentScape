import { expect, it } from 'vitest';
import { createSession } from '../../application/createSession.js';
import { AgentTools } from '../../application/AgentTools.js';
import { bootstrapWorld } from '../../modules/agent/bootstrapWorld.js';
import { createBlankWorld } from '../../modules/world/content/blankWorld.js';
import { ENVIRONMENTS } from '../../modules/world/content/environments.js';
import { createAssetModule } from '../../modules/asset/AssetModule.js';
import { assetManifests } from '../../modules/asset/registry/manifests/index.js';
import { openCodeProject } from '../../application/native-scene/CodeProject.js';
import { buildCodeProject } from '../../dev/build-code-project.mjs';

async function finish(scene, job, limit = 2500) {
  for (let frame = 0; frame < limit && scene.getJob(job.id).status === 'running'; frame++) {
    scene.step();
    if (frame % 12 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    else await Promise.resolve();
  }
  expect(scene.getJob(job.id).status).not.toBe('running');
  return scene.waitJob(job.id);
}

it('executes arbitrary declared semantic names through a real articulated machine, not an object-type switch', async () => {
  const manifests = structuredClone(assetManifests);
  const machine = manifests.industrial_cabinet;
  machine.type = 'kinematic-device';
  machine.label = 'Generic articulated machine';
  machine.actions = ['deploy', 'stow'];
  for (const part of Object.values(machine.parts)) {
    const target = part.targets.open;
    part.actions = ['deploy', 'stow'];
    part.targets = { deploy:target, stow:0 };
  }
  const session = createSession(null, {
    assetModule:createAssetModule({ manifests }),
    environmentFactory:() => createBlankWorld({ id:'semantic-machine-lab' })
  });
  await session.world.init();
  const { world, scene } = session;
  try {
    const preset = ENVIRONMENTS.find(entry => entry.id === 'industrial-cabinet-lab').bootstrap;
    await bootstrapWorld(new AgentTools(world, { actor:'agent_01', profile:'builder', source:'test' }), preset);
    const target = 'industrial_cabinet_01', actor = 'agent_01';
    const inspection = scene.inspect(target, { actor });
    expect(inspection.kind).toBe('kinematic-device');
    expect(inspection.capabilities.find(item =>
      item.name === 'deploy' && item.partName === 'upper_drawer')).toMatchObject({
      source:'asset', executor:'interaction', action:'invoke', verification:'articulation-state'
    });
    expect(() => scene.interact({ action:'invoke', target, actor, name:'deploy' })).toThrow('ACTION_PART_REQUIRED');
    expect(() => scene.interact({ action:'invoke', target, actor, name:'invented' })).toThrow('ACTION_UNSUPPORTED');

    const opened = await finish(scene, scene.interact({
      action:'invoke', target, actor, name:'deploy', partName:'upper_drawer'
    }));
    expect(opened.status, JSON.stringify(opened)).toBe('succeeded');
    expect(opened.result.verification.status).toBe('verified');
    expect(opened.result.value).toMatchObject({ verified:true, physicsVerified:true, evidenceKind:'joint-motor' });
    expect(world.physics.getArticulationState(target, 'upper_drawer').coordinate).toBeCloseTo(.45, 1);
    expect(scene.verify([{ id:'deployed', kind:'interaction-verified', targetId:target, capability:'DEPLOY' }]).value.status).toBe('world-accepted');

    const stowed = await finish(scene, scene.interact({
      action:'invoke', target, actor, name:'stow', partName:'upper_drawer'
    }));
    expect(stowed.status, JSON.stringify(stowed)).toBe('succeeded');
    expect(world.physics.getArticulationState(target, 'upper_drawer').coordinate).toBeCloseTo(0, 1);
  } finally {
    scene.close();
    world.dispose();
  }
}, 90_000);

it('invokes a new Code Project action and does not carry verification evidence across reopen', async () => {
  const project = await buildCodeProject({ entry:'examples/code-project/project.js', id:'semantic-portal', name:'Semantic Portal' });
  const session = await openCodeProject({ project, authorized:true, autoStart:false });
  let reopened;
  const acceptance = [{ id:'teleported', kind:'interaction-verified', targetId:'portal', capability:'TELEPORT' }];
  try {
    expect(session.scene.inspect('portal').capabilities.find(item => item.name === 'teleport')).toMatchObject({
      action:'invoke', source:'project', executor:'project-action', verification:'project-defined'
    });
    expect(session.scene.verify(acceptance).value.status).toBe('world-incomplete');
    const performed = session.scene.interact({
      action:'invoke', target:'portal', name:'teleport', args:{ destination:'garden' }
    });
    const done = await session.scene.waitJob(performed.id);
    expect(done).toMatchObject({ status:'succeeded', result:{ verification:{ status:'verified' }, value:{ physicsVerified:false } } });
    expect(session.scene.verify(acceptance).value.status).toBe('world-accepted');

    const saved = (await session.scene.save()).value;
    session.close();
    reopened = await openCodeProject({ project:saved, authorized:true, autoStart:false });
    expect(reopened.scene.inspect('portal').state.uses).toBe(1);
    expect(reopened.scene.verify(acceptance).value.status).toBe('world-incomplete');
    expect(reopened.scene.inspect('portal').capabilities.some(item => item.name === 'teleport')).toBe(true);
    const again = reopened.scene.interact({
      action:'invoke', target:'portal', name:'teleport', args:{ destination:'entrance' }
    });
    expect((await reopened.scene.waitJob(again.id)).result.verification.status).toBe('verified');
    expect(reopened.scene.verify(acceptance).value.status).toBe('world-accepted');
  } finally { session.close(); reopened?.close(); }
}, 30_000);

it('executes a new environment capability with state verification but no false physics claim', async () => {
  const session = createSession(null, { environmentFactory:() => createBlankWorld({ id:'semantic-device-test' }) });
  await session.world.init();
  const { world, scene } = session;
  try {
    await scene.addModel({ id:'operator', asset:'builtin://agent', position:[0,0,0] });
    let powered = false;
    world.environment.affordances = [{
      id:'workstation',label:'Workstation',kind:'electrical-device',position:[0,.9,.5],
      actions:['energize'],evidenceKind:'device-state',
      read:() => ({ powered }),request:() => { powered = true; },
      verify:() => powered === true
    }];
    expect(scene.inspect('workstation', { actor:'operator' }).capabilities).toEqual([
      expect.objectContaining({ name:'energize', source:'environment', executor:'world-action' })
    ]);
    const job = scene.interact({ action:'invoke', target:'workstation', name:'energize', actor:'operator' });
    const done = await scene.waitJob(job.id);
    expect(done.status, JSON.stringify(done)).toBe('succeeded');
    expect(done.result.value).toMatchObject({ verified:true, physicsVerified:false, after:{powered:true} });
    expect(done.result.outcome.physicsVerified).toBe(false);
    expect(scene.verify([{id:'on',kind:'state-equals',targetId:'workstation',stateKey:'powered',value:true}]).value.status).toBe('world-accepted');
  } finally { scene.close(); world.dispose(); }
}, 20_000);
