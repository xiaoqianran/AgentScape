import { describe, expect, it } from 'vitest';
import { TraceRecorder } from '../src/observability/TraceRecorder.js';

describe('TraceRecorder', () => {
  it('creates and verifies a chained audit trace', () => {
    const trace = new TraceRecorder();
    trace.emit('a', { x: 1 }, { actor: 'agent' });
    trace.emit('b', { y: 2 }, { actor: 'world' });
    expect(trace.verify()).toMatchObject({ ok: true, entries: 2 });
    expect(trace.list()[1].integrity.previousHash).toBe(trace.list()[0].integrity.hash);
  });

  it('detects tampering', () => {
    const trace = new TraceRecorder();
    trace.emit('a', { x: 1 });
    trace.entries[0].payload.x = 99;
    expect(trace.verify().ok).toBe(false);
  });
});
