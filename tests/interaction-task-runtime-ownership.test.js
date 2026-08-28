import { describe, expect, it, vi } from 'vitest';
import { InteractionSystem } from '../src/runtime/systems/InteractionSystem.js';

const createSystem = ({ store, physics, spatial } = {}) => new InteractionSystem({
  store:store || { has:vi.fn(() => false), get:vi.fn() },
  physics:physics || {},
  spatial:spatial || {},
  events:{ emit:vi.fn() }
});

describe('interaction task runtime ownership', () => {
  it('keeps articulation and settle maps owned by their runtimes while preserving compatibility views', () => {
    const system=createSystem();

    expect(system.articulationTasks).toBe(system.articulationRuntime.tasks);
    expect(system.articulationResults).toBe(system.articulationRuntime.results);
    expect(system.settleTasks).toBe(system.settleRuntime.tasks);
  });

  it('reads the current physics dependency when articulation observation starts after construction', async() => {
    const system=createSystem({ physics:{ articulationState:vi.fn(() => null) } });
    const replacement={
      articulationState:vi.fn((_id,_part,{target}={}) => ({
        coordinate:target,
        target,
        error:0,
        tolerance:.08,
        jointType:'revolute',
        limits:[-1,0],
        coordinateReference:'rest-zero-pose'
      }))
    };
    system.physics=replacement;

    const pending=system.waitForArticulationCompletion('cab','door','open',-1,{stableDuration:.1,timeout:1});
    system.updateArticulationTasks(.1);

    await expect(pending).resolves.toMatchObject({status:'action-completed',targetReached:true,settled:true});
    expect(replacement.articulationState).toHaveBeenCalled();
  });

  it('reads the current spatial dependency when a settle task verifies support', async() => {
    const physics={ bodyMotionState:vi.fn(() => ({sleeping:true,linearSpeed:0,angularSpeed:0})) };
    const system=createSystem({ physics, spatial:{ supportStatus:vi.fn(() => ({on:false})) } });
    const replacement={ supportStatus:vi.fn(() => ({on:true,surfaceId:'top',gap:0})) };
    system.spatial=replacement;

    const pending=system.waitForPlacementSettle('cup','table','top',{stableDuration:.1,timeout:1});
    system.updatePlacementSettles(.1);

    await expect(pending).resolves.toMatchObject({status:'placed',supportVerified:true,settled:true});
    expect(replacement.supportStatus).toHaveBeenCalledWith('cup','table',{surfaceId:'top'});
  });
});
