import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { StudioLiveBridge } from '../../apps/mcp-server/StudioLiveBridge.js';
import { createRequestWindow } from '../../application/scene/RequestWindow.js';

describe('bounded MCP idempotency', () => {
  it('replays settled requests, protects pending requests, rejects conflicting IDs and expires history', async () => {
    let clock = 100;
    const window = createRequestWindow({ now: () => clock, limit: 2, retentionMs: 500 });
    const pending = new Promise(() => {});
    window.ensureCapacity();
    window.track('one', 'first', pending);
    expect(window.replay('one', 'first')).toBe(pending);
    expect(() => window.replay('one', 'different')).toThrow('IDEMPOTENCY_CONFLICT');

    window.ensureCapacity();
    window.track('two', 'second', Promise.resolve('done'));
    await Promise.resolve();
    // The resolved record can be evicted, the pending one cannot.
    window.ensureCapacity();
    window.track('three', 'third', Promise.resolve('ok'));
    expect(window.replay('one', 'first')).toBe(pending);
    expect(window.replay('two', 'second')).toBeNull();
    await Promise.resolve();
    clock += 501;
    expect(window.replay('three', 'third')).toBeNull();
    expect(window.size).toBe(1);
    expect(() => window.ensureCapacity()).not.toThrow();
  });

  it('binds an automatic Studio to the first authenticated MCP identity and preserves it on tab re-register', () => {
    const broker = new StudioLiveBridge();
    const instance = randomUUID();
    try {
      const first = broker.registerAuto(instance, 'native-world');
      expect(broker.currentSession('alice').worldSessionId).toBe(first.worldSessionId);
      expect(broker.status('alice', first.worldSessionId).connected).toBe(true);
      expect(() => broker.status('bob', first.worldSessionId)).toThrow('SESSION_NOT_FOUND');
      expect(() => broker.currentSession('bob')).toThrow('STUDIO_NOT_CONNECTED');
      expect(() => broker.ownerSession('bob', first.worldSessionId)).toThrow('SESSION_NOT_FOUND');
      const second = broker.registerAuto(instance, 'new-world');
      expect(second.worldSessionId).not.toBe(first.worldSessionId);
      expect(() => broker.currentSession('bob')).toThrow('STUDIO_NOT_CONNECTED');
      expect(broker.currentSession('alice').worldId).toBe('new-world');
      broker.disconnect(second.worldSessionId);
      const third = broker.registerAuto(instance, 'after-disconnect');
      expect(() => broker.currentSession('bob')).toThrow('STUDIO_NOT_CONNECTED');
      expect(broker.currentSession('alice').worldSessionId).toBe(third.worldSessionId);
    } finally { broker.dispose(); }
  });

  it('handles more than 256 authenticated studio edits without exhausting the request budget', async () => {
    const broker = new StudioLiveBridge();
    try {
      const pair = broker.pair('alice');
      const connected = broker.connect(pair.pairCode);
      let firstId;
      for (let i = 0; i < 270; i++) {
        const id = 'edit-' + i;
        if (!i) firstId = id;
        const task = broker.call('alice', pair.worldSessionId, 'observe', { index: i }, { requestId: id });
        const { request } = await broker.poll(pair.worldSessionId, connected.studioToken);
        broker.reply(pair.worldSessionId, connected.studioToken, { requestId: request.requestId, result: { index: i } });
        expect(await task).toEqual({ index: i });
      }
      const session = broker.ownerSession('alice', pair.worldSessionId);
      expect(session.requests.size).toBeLessThanOrEqual(256);
      const latest = broker.call('alice', pair.worldSessionId, 'observe', { index: 269 }, { requestId: 'edit-269' });
      expect(await latest).toEqual({ index: 269 });
      await expect(broker.call('alice', pair.worldSessionId, 'observe', { index: 111 }, { requestId: 'edit-269' }))
        .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
      expect(session.pending.size).toBe(0);
      expect(session.queue).toHaveLength(0);
      expect(firstId).toBe('edit-0');
    } finally { broker.dispose(); }
  });
});
