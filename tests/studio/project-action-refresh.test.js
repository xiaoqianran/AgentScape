import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../foundation/EventBus.js';
import { subscribeSceneRefresh } from '../../apps/studio/scene/SceneRefreshScheduler.js';

describe('Studio code project action refresh', () => {
  it('refreshes on completed actions and state-machine changes, not unrelated events', async () => {
    const events = new EventBus();
    const refresh = vi.fn();
    const dispose = subscribeSceneRefresh(events, ['project.action.completed', 'project.machine.changed'], refresh);

    events.emit('object.spawned');
    expect(refresh).not.toHaveBeenCalled();
    events.emit('project.action.completed');
    events.emit('project.machine.changed');
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledOnce();

    dispose();
    events.emit('project.action.completed');
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledOnce();
  });
});
