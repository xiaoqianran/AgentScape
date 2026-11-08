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

it('reports quota errors without uncaught timer exceptions and recovers on a later save', () => {
  vi.useFakeTimers();
  try {
    const events={on:vi.fn(()=>()=>{}),emit:vi.fn()};
    const scene={schema:'agentscape.scene',objects:[{id:'cup'}]};
    const runtime={events,serialize:vi.fn(()=>scene)};
    const quota=Object.assign(new Error('Storage full'),{name:'QuotaExceededError'});
    const store={key:'world-a',save:vi.fn().mockImplementationOnce(()=>{throw quota;})};
    const autosave=new AutosaveController({runtime,store,delayMs:50}).start();
    autosave.schedule();
    expect(()=>vi.advanceTimersByTime(50)).not.toThrow();
    expect(autosave.lastError).toMatchObject({code:'AUTOSAVE_QUOTA_EXCEEDED',stage:'storage'});
    expect(events.emit).toHaveBeenCalledWith('scene.autosave.failed',expect.objectContaining({code:'AUTOSAVE_QUOTA_EXCEEDED',key:'world-a'}));
    expect(events.emit).not.toHaveBeenCalledWith('scene.autosaved',expect.anything());
    expect(autosave.flush()).toBe(scene);
    expect(autosave.lastError).toBeNull();
    autosave.dispose();
  } finally {vi.useRealTimers();}
});

it('propagates explicit flush failure so a world switch does not silently discard changes', () => {
  const events={on:vi.fn(()=>()=>{}),emit:vi.fn()};
  const error=new Error('serialization failed');
  const autosave=new AutosaveController({runtime:{events,serialize:()=>{throw error;}},store:{key:'a',save:vi.fn()}}).start();
  expect(()=>autosave.flush()).toThrow(error);
  expect(autosave.lastError).toMatchObject({stage:'serialize',code:'AUTOSAVE_FAILED'});
  expect(events.emit).toHaveBeenCalledWith('scene.autosave.failed',expect.anything());
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
