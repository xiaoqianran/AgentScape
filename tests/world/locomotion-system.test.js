import { describe, expect, it, vi } from 'vitest';
import { LocomotionSystem } from '../../modules/world/runtime/systems/LocomotionSystem.js';

const createHarness = ({ route } = {}) => {
  const record = {
    manifest:{ type:'agent', actions:['navigate'], physics:{ body:'kinematic' } },
    state:{}
  };
  const records = new Map([['agent', record]]);
  const store = {
    has:(id)=>records.has(id),
    get:(id)=>records.get(id),
    list:()=>[...records.entries()]
  };
  const physics = {
    getPosition:vi.fn(()=>[0,0,0]),
    getRotation:vi.fn(()=>[0,0,0,1]),
    faceCharacter:vi.fn(()=>true),
    cancelCharacterMovement:vi.fn(()=>true),
    moveCharacter:vi.fn(()=>({ success:true, grounded:true, movement:[0.1,0,0], collisions:[{ id:'wall' }] }))
  };
  const navigation = {
    findPath:vi.fn(async(start,target)=>route || ({ reachable:true, path:[start,target], cost:1 }))
  };
  return { system:new LocomotionSystem({ store, physics, navigation }), store, physics, navigation, record };
};

const settle = async() => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('LocomotionSystem', () => {
  it('replaces an active task for the same actor', async() => {
    const { system } = createHarness();
    const first = system.navigate('agent',[2,0,0]);
    await settle();

    const second = system.navigate('agent',[3,0,0]);
    await settle();

    await expect(first).resolves.toMatchObject({ status:'cancelled', reason:'REPLACED', target:[2,0,0] });
    expect(system.status('agent')).toMatchObject({ status:'moving', target:[3,0,0], step:1 });

    system.cancel('agent');
    await expect(second).resolves.toMatchObject({ status:'cancelled', reason:'CANCELLED' });
  });

  it('rejects unsafe movement parameters before creating a task', async() => {
    const { system, navigation } = createHarness();

    await expect(system.navigate('agent',[1,0,0],{ speed:0 })).rejects.toThrow('speed');
    await expect(system.navigate('agent',[1,0,0],{ accel:0 })).rejects.toThrow('accel');
    await expect(system.navigate('agent',[1,0,0],{ turn:0 })).rejects.toThrow('turn');
    await expect(system.navigate('agent',[1,0,0],{ replans:-1 })).rejects.toThrow('replans');
    await expect(system.navigate('agent',[1,0,0],{ stop:0 })).rejects.toThrow('stop');
    await expect(system.navigate('agent',[1,0,0],{ waypointTolerance:0 })).rejects.toThrow('waypointTolerance');
    await expect(system.navigate('agent',[1,0,0],{ timeout:0 })).rejects.toThrow('timeout');
    expect(navigation.findPath).not.toHaveBeenCalled();
  });

  it('accelerates toward the requested speed instead of jumping to it', async() => {
    const { system, physics } = createHarness();
    const pending = system.navigate('agent',[10,0,0],{ speed:4, accel:2 });
    await settle();

    system.update(0.1);

    expect(system.status('agent')).toMatchObject({ speed:4, v:0.2 });
    const desired = physics.moveCharacter.mock.calls[0][1];
    expect(desired[0]).toBeCloseTo(0.02,6);
    expect(desired[2]).toBe(0);
    system.cancel('agent');
    await pending;
  });

  it('brakes as the remaining route approaches stop distance', async() => {
    const { system } = createHarness();
    const pending = system.navigate('agent',[2,0,0],{ speed:4, accel:10, stop:0.2 });
    await settle();

    system.update(0.2);
    expect(system.status('agent').v).toBe(2);

    const task = system.tasks.get('agent');
    task.path = [[0,0,0],[0.25,0,0]];
    task.step = 1;
    system.update(0.1);

    expect(system.status('agent').v).toBeLessThan(2);
    system.cancel('agent');
    await pending;
  });

  it('limits turning by turn rate', async() => {
    const { system, physics } = createHarness();
    const pending = system.navigate('agent',[10,0,0],{ turn:1 });
    await settle();

    system.update(0.1);

    expect(physics.faceCharacter).toHaveBeenCalledTimes(1);
    const direction = physics.faceCharacter.mock.calls[0][1];
    expect(Math.atan2(-direction[0],-direction[2])).toBeCloseTo(-0.1,6);
    system.cancel('agent');
    await pending;
  });

  it('replans once from the current position and resets path execution state', async() => {
    const { system, physics, navigation } = createHarness();
    const pending = system.navigate('agent',[10,0,0],{ replans:1 });
    await settle();
    const task = system.tasks.get('agent');
    task.stuck = 2;
    task.v = 2;
    navigation.findPath.mockResolvedValueOnce({ reachable:true, path:[[2,0,0],[2,0,2],[10,0,0]], cost:12 });

    await system.replan(task,[2,0,0]);

    expect(navigation.findPath).toHaveBeenLastCalledWith([2,0,0],[10,0,0]);
    expect(physics.cancelCharacterMovement).toHaveBeenCalledWith('agent');
    expect(system.status('agent')).toMatchObject({ step:1, v:0, stuck:0, replanCount:1, waypointCount:3 });
    system.cancel('agent');
    await pending;
  });

  it('finishes blocked when the bounded replan cannot find a route', async() => {
    const { system, navigation } = createHarness();
    const pending = system.navigate('agent',[10,0,0],{ replans:1 });
    await settle();
    const task = system.tasks.get('agent');
    navigation.findPath.mockResolvedValueOnce({ reachable:false, reason:'NO_PATH', path:[], cost:null });

    await system.replan(task,[2,0,0]);

    await expect(pending).resolves.toMatchObject({ status:'blocked', reason:'NO_PATH' });
    expect(system.tasks.has('agent')).toBe(false);
  });

  it('preserves the navigation failure reason', async() => {
    const { system } = createHarness({ route:{ reachable:false, reason:'START_OFF_NAVMESH', path:[], cost:null } });
    await expect(system.navigate('agent',[1,0,0])).resolves.toMatchObject({
      status:'unreachable', reason:'START_OFF_NAVMESH'
    });
  });

  it('clears pending character movement on cancel', async() => {
    const { system, physics } = createHarness();
    const pending = system.navigate('agent',[2,0,0]);
    await settle();

    system.cancel('agent');

    expect(physics.cancelCharacterMovement).toHaveBeenCalledWith('agent');
    await expect(pending).resolves.toMatchObject({ status:'cancelled', reason:'CANCELLED' });
  });

  it('prefers locomotion timeout while a replan is pending', async() => {
    const { system } = createHarness();
    const pending = system.navigate('agent',[10,0,0],{ timeout:0.1, replans:1 });
    await settle();
    const task = system.tasks.get('agent');
    task.replanning = true;

    system.update(0.11);

    await expect(pending).resolves.toMatchObject({ status:'blocked', reason:'LOCOMOTION_TIMEOUT' });
  });

  it('does not advance when dt is zero', async() => {
    const { system, physics } = createHarness();
    const pending = system.navigate('agent',[2,0,0]);
    await settle();

    system.update(0);

    expect(physics.moveCharacter).not.toHaveBeenCalled();
    expect(system.status('agent')).toMatchObject({ time:0, step:1, stuck:0 });
    system.cancel('agent');
    await pending;
  });

  it('reports the latest physics evidence while moving', async() => {
    const { system } = createHarness();
    const pending = system.navigate('agent',[2,0,0]);
    await settle();

    system.update(0.1);

    expect(system.status('agent')).toMatchObject({
      status:'moving', grounded:true, hits:[{ id:'wall' }]
    });
    system.cancel('agent');
    await pending;
  });
});
