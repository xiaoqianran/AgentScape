import { describe, expect, it, vi } from 'vitest';
import { SimulationSession } from '../../modules/world/runtime/simulation/SimulationSession.js';

describe('SimulationSession', () => {
  it('advances explicit steps with one fixed dt', () => {
    const executeStep = vi.fn();
    const session = new SimulationSession({ fixedDt:1/60, executeStep });

    expect(session.step()).toEqual({ tick:1, time:1/60, dt:1/60 });
    expect(session.step()).toEqual({ tick:2, time:2/60, dt:1/60 });
    expect(executeStep).toHaveBeenNthCalledWith(1, 1/60, { tick:1, time:1/60 });
    expect(executeStep).toHaveBeenNthCalledWith(2, 1/60, { tick:2, time:2/60 });
  });

  it('converts wall-clock frames into bounded fixed steps', () => {
    const executeStep = vi.fn();
    const session = new SimulationSession({ fixedDt:1/60, maxSubSteps:4, executeStep });
    session.play();

    expect(session.pump(1000)).toBe(0);
    expect(session.pump(1010)).toBe(0);
    expect(session.pump(1034)).toBe(2);
    expect(session.tick).toBe(2);
    expect(executeStep).toHaveBeenCalledTimes(2);
  });

  it('snapshots canonical world + clock without claiming exact solver state', async () => {
    const restoreWorld = vi.fn(async () => {});
    const session = new SimulationSession({
      executeStep:() => {},
      snapshotWorld:() => ({ schema:'agentscape.scene', objects:[] }),
      restoreWorld
    });
    session.step();
    session.step();
    const snapshot = session.snapshot();

    expect(snapshot).toMatchObject({
      schema:'agentscape.simulation-session',
      schemaVersion:1,
      exact:false,
      scope:'canonical-world+clock',
      clock:{ fixedDt:1/60, tick:2 },
      world:{ schema:'agentscape.scene' }
    });

    session.step();
    await session.restore(snapshot);
    expect(restoreWorld).toHaveBeenCalledWith(snapshot.world);
    expect(session.tick).toBe(2);
    expect(session.time).toBeCloseTo(2/60, 10);
  });
});
