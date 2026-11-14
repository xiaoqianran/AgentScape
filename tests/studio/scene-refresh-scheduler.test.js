import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../foundation/EventBus.js';
import { subscribeSceneRefresh } from '../../apps/studio/scene/SceneRefreshScheduler.js';

describe('Studio scene refresh scheduling', () => {
  it('coalesces synchronous scene changes into one update', async () => {
    const events = new EventBus();
    const refresh = vi.fn();
    const dispose = subscribeSceneRefresh(events, ['object.spawned', 'object.removed'], refresh);
    events.emit('object.spawned');
    events.emit('object.removed');
    events.emit('object.spawned');
    expect(refresh).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledOnce();
    events.emit('object.removed');
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(2);
    dispose();
  });

  it('prevents pending updates and unsubscribes after teardown', async () => {
    const events = new EventBus();
    const refresh = vi.fn();
    const dispose = subscribeSceneRefresh(events, ['scene.restored'], refresh);
    events.emit('scene.restored');
    dispose();
    await Promise.resolve();
    events.emit('scene.restored');
    await Promise.resolve();
    expect(refresh).not.toHaveBeenCalled();
  });
});
