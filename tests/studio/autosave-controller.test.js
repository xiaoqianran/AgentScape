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

it('retries transient failures with bounded backoff and eventually saves', () => {
  vi.useFakeTimers();
  try {
    const events={on:vi.fn(()=>()=>{}),emit:vi.fn()};
    const scene={schema:'agentscape.scene',objects:[]};
    const error=new Error('temporary storage failure');
    const store={save:vi.fn().mockImplementationOnce(()=>{throw error;}).mockImplementationOnce(()=>{throw error;})};
    const autosave=new AutosaveController({runtime:{events,serialize:()=>scene},store,delayMs:10,retryDelayMs:20,maxRetries:2}).start();
    autosave.schedule();
    vi.advanceTimersByTime(10);
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(autosave.retryCount).toBe(1);
    vi.advanceTimersByTime(20);
    expect(store.save).toHaveBeenCalledTimes(2);
    expect(autosave.retryCount).toBe(2);
    vi.advanceTimersByTime(40);
    expect(store.save).toHaveBeenCalledTimes(3);
    expect(autosave.lastError).toBeNull();
    expect(autosave.retryCount).toBe(0);
    expect(events.emit).not.toHaveBeenCalledWith('scene.autosave.retry-exhausted',expect.anything());
    autosave.dispose();
  } finally {vi.useRealTimers();}
});

it('stops retrying at its budget but allows a new edit to try again', () => {
  vi.useFakeTimers();
  try {
    const events={on:vi.fn(()=>()=>{}),emit:vi.fn()};
    const store={save:vi.fn(()=>{throw Object.assign(new Error('quota'),{name:'QuotaExceededError'});})};
    const autosave=new AutosaveController({runtime:{events,serialize:()=>({objects:[]})},store,delayMs:5,retryDelayMs:10,maxRetries:1}).start();
    autosave.schedule();
    vi.advanceTimersByTime(15);
    expect(store.save).toHaveBeenCalledTimes(2);
    expect(events.emit).toHaveBeenCalledWith('scene.autosave.retry-exhausted',expect.objectContaining({attempts:2}));
    vi.advanceTimersByTime(100);
    expect(store.save).toHaveBeenCalledTimes(2);
    autosave.schedule();
    vi.advanceTimersByTime(5);
    expect(store.save).toHaveBeenCalledTimes(3);
    autosave.dispose();
  } finally {vi.useRealTimers();}
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
