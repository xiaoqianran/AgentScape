import { describe, expect, it, vi } from 'vitest';
import { AutosaveController } from '../studio/persistence/AutosaveController.js';

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
