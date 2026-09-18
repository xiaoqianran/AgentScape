import { describe, expect, it, vi } from 'vitest';
import { AutosaveController } from '../../apps/studio/persistence/AutosaveController.js';

it('writes a serialized scene when flushed', () => {
  const events = { on: vi.fn(() => () => {}), emit: vi.fn() };
  const runtime = { events, serialize: vi.fn(() => ({ schema: 'agentscape.scene', objects: [] })) };
  const store = { save: vi.fn() };
  const autosave = new AutosaveController({ runtime, store }).start();
  const scene = autosave.flush();
  expect(store.save).toHaveBeenCalledWith(scene);
  expect(events.emit).toHaveBeenCalledWith('scene.autosaved', expect.any(Object));
  autosave.dispose();
});

it('can cancel a pending save before a world identity switch', () => {
  vi.useFakeTimers();
  try {
    const events = { on: vi.fn(() => () => {}), emit: vi.fn() };
    const runtime = { events, serialize: vi.fn(() => ({ schema:'agentscape.scene', objects:[] })) };
    const store = { save: vi.fn() };
    const autosave = new AutosaveController({ runtime, store, delayMs:50 }).start();
    autosave.schedule();
    autosave.cancelPending();
    vi.advanceTimersByTime(100);
    expect(store.save).not.toHaveBeenCalled();
    autosave.dispose();
  } finally {
    vi.useRealTimers();
  }
});
