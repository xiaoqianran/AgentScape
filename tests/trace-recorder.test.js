import { describe, expect, it } from 'vitest';
import { TraceRecorder } from '../core/TraceRecorder.js';

describe('TraceRecorder', () => {
  it('creates and verifies a chained audit trace', () => {
    const trace = new TraceRecorder();
    trace.emit('a', { x: 1 }, { actor: 'agent' });
    trace.emit('b', { y: 2 }, { actor: 'world' });
    expect(trace.verify()).toMatchObject({ ok: true, entries: 2 });
    expect(trace.list()[1].integrity.previousHash).toBe(trace.list()[0].integrity.hash);
  });

  it('keeps verification valid after the retention window trims old entries', () => { const trace = new TraceRecorder({ limit: 2 }); trace.emit('a'); trace.emit('b'); trace.emit('c'); expect(trace.list()).toHaveLength(2); expect(trace.verify()).toMatchObject({ ok:true, entries:2 }); });

  it('summarizes binary payloads instead of retaining large buffers', () => { const trace = new TraceRecorder(); trace.emit('binary', { bytes: new Uint8Array(1024) }); expect(trace.list()[0].payload.bytes).toEqual({ type:'Uint8Array', bytes:1024 }); });

  it('detects tampering', () => {
    const trace = new TraceRecorder();
    trace.emit('a', { x: 1 });
    trace.entries[0].payload.x = 99;
    expect(trace.verify().ok).toBe(false);
  });
});
