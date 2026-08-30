import { describe, expect, it, vi } from 'vitest';
import { WorldRuntime } from '../../world/runtime/WorldRuntime.js';

describe('WorldRuntime timing', () => {
  it('updates Three Timer from the RAF timestamp and preserves the dt clamp', () => {
    const timer = { update: vi.fn(), getDelta: vi.fn(() => 0.2) };
    const runtime = {
      timer,
      locomotion: { update: vi.fn() },
      physics: { step: vi.fn(() => true) },
      store: {},
      sceneGraph: { invalidate: vi.fn() },
      interactions: { update: vi.fn() },
      rendering: { viewPose:vi.fn(() => ({position:[1,2,3],rotation:[0,0,0,1]})), update:vi.fn() }
    };

    WorldRuntime.prototype.update.call(runtime, 1234.5);

    expect(timer.update).toHaveBeenCalledWith(1234.5);
    expect(timer.getDelta).toHaveBeenCalledOnce();
    expect(runtime.locomotion.update).toHaveBeenCalledWith(1 / 30);
    expect(runtime.physics.step).toHaveBeenCalledWith(1 / 30, runtime.store);
    expect(runtime.sceneGraph.invalidate).toHaveBeenCalledOnce();
    expect(runtime.interactions.update).toHaveBeenCalledWith(1 / 30, {position:[1,2,3],rotation:[0,0,0,1]});
    expect(runtime.rendering.update).toHaveBeenCalledOnce();
  });

  it('keeps sub-clamp frame deltas unchanged', () => {
    const timer = { update: vi.fn(), getDelta: vi.fn(() => 1 / 120) };
    const runtime = {
      timer,
      locomotion: { update: vi.fn() },
      physics: { step: vi.fn(() => false) },
      store: {},
      sceneGraph: { invalidate: vi.fn() },
      interactions: { update: vi.fn() },
      rendering: { viewPose:vi.fn(() => ({position:[1,2,3],rotation:[0,0,0,1]})), update:vi.fn() }
    };

    WorldRuntime.prototype.update.call(runtime, 2000);

    expect(runtime.physics.step).toHaveBeenCalledWith(1 / 120, runtime.store);
    expect(runtime.sceneGraph.invalidate).not.toHaveBeenCalled();
  });
});