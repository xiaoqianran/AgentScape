import { describe, expect, it, vi } from 'vitest';
import { createSceneJobController } from '../../application/scene/SceneJobController.js';
import { createScenePersistence } from '../../application/scene/ScenePersistence.js';
import { sceneInteractionSchema as publicInteractionSchema, sceneError as publicSceneError } from '../../application/scene/SceneFacade.js';
import { sceneInteractionSchema, sceneError } from '../../application/scene/SceneContracts.js';

function createJobsFixture() {
  let active = false;
  let resolveOperation;
  const operation = new Promise(resolve => { resolveOperation = resolve; });
  const world = {
    interactions: { cancelPending: vi.fn() },
    locomotion: { cancelAll: vi.fn() },
    affordances: { get: vi.fn(() => null), cancel: vi.fn() }
  };
  const tools = {
    call: vi.fn(() => operation),
    executionPolicy: vi.fn(() => ({ outcome: { state:'verified', verified:true } }))
  };
  const jobs = createSceneJobController(world, {
    tools,
    assertOpen: () => {},
    assertIdle: () => {
      if (active) throw sceneError('SCENE_BUSY');
    },
    setBusy: value => { active = value; },
    actors: () => ({ agents:[] }),
    result: (operationName, value, extra = {}) => ({ operation:operationName, value, ...extra })
  });
  return { world, tools, jobs, resolveOperation, isBusy: () => active };
}

describe('Scene service boundaries', () => {
  it('retains identical public Scene schemas and domain errors', () => {
    expect(publicInteractionSchema).toBe(sceneInteractionSchema);
    expect(publicSceneError).toBe(sceneError);
  });

  it('serializes asynchronous interactions through the shared facade lock', async () => {
    const { tools, jobs, resolveOperation, isBusy } = createJobsFixture();
    const job = jobs.interact({action:'navigate', actor:'agent', position:[1,0,1]});
    expect(isBusy()).toBe(true);
    expect(tools.call).toHaveBeenCalledWith('navigateTo', {id:'agent', end:[1,0,1]});
    expect(() => jobs.interact({action:'navigate', actor:'agent', position:[2,0,2]})).toThrow('SCENE_BUSY');
    resolveOperation({status:'arrived'});
    const finished = await jobs.waitJob(job.id);
    expect(finished).toMatchObject({status:'succeeded',result:{verification:{status:'verified'}}});
    expect(isBusy()).toBe(false);
    finished.status = 'tampered';
    expect(jobs.getJob(job.id).status).toBe('succeeded');
  });

  it('cancels active work without reporting verification or leaving the facade locked', async () => {
    const { world, jobs, resolveOperation, isBusy } = createJobsFixture();
    const job = jobs.interact({action:'navigate', actor:'agent', position:[1,0,1]});
    expect(jobs.cancelJob(job.id)).toMatchObject({status:'running',cancellationRequested:true});
    expect(world.interactions.cancelPending).toHaveBeenCalledWith('SCENE_CANCELLED');
    expect(world.locomotion.cancelAll).toHaveBeenCalledWith('SCENE_CANCELLED');
    expect(world.affordances.cancel).toHaveBeenCalledWith('SCENE_CANCELLED');
    resolveOperation({status:'arrived'});
    const finished = await jobs.waitJob(job.id);
    expect(finished).toMatchObject({status:'cancelled',result:{verification:{status:'unverified'}}});
    expect(isBusy()).toBe(false);
    expect(() => jobs.getJob('job_missing')).toThrow('JOB_NOT_FOUND');
  });

  it('releases the shared lock when a legacy command throws synchronously', async () => {
    const { tools, jobs, isBusy } = createJobsFixture();
    tools.call.mockImplementationOnce(() => { throw new Error('executor failed'); });
    const job = jobs.interact({ action:'navigate', actor:'agent', position:[1,0,1] });
    const completed = await jobs.waitJob(job.id);
    expect(completed.status).toBe('failed');
    expect(completed.result.diagnostics[0].stage).toBe('scene');
    expect(isBusy()).toBe(false);
  });

  it('validates snapshot restore before replacing the authoritative world', async () => {
    const world = {
      serialize: vi.fn(() => ({objects:[],name:'Persisted'})),
      serializer: { validate:vi.fn() },
      assetModule: { hasAsset:vi.fn(asset => asset === 'cup') },
      restore: vi.fn(async () => {})
    };
    const persistence = createScenePersistence(world, {
      name:'Persisted',
      styles: { export:vi.fn(() => null) },
      assertIdle: () => {},
      exclusive: async operation => operation(),
      result: (op,value) => ({operation:op,value})
    });
    expect(persistence.snapshot()).toEqual({objects:[],name:'Persisted'});
    expect(world.serialize).toHaveBeenCalledWith({name:'Persisted'});
    await expect(persistence.restoreSnapshot({assets:[{}],objects:[]})).rejects.toMatchObject({code:'UNSUPPORTED_SAVE'});
    await expect(persistence.restoreSnapshot({assets:[],objects:[{id:'object_01',assetId:'unavailable'}]}))
      .rejects.toMatchObject({code:'ASSET_UNAVAILABLE'});
    expect(world.restore).not.toHaveBeenCalled();
    const valid = {assets:[],objects:[{id:'object_01',assetId:'cup'}]};
    expect(await persistence.restoreSnapshot(valid)).toEqual({operation:'restore',value:{objects:1}});
    expect(world.restore).toHaveBeenCalledWith(valid);
  });
});
