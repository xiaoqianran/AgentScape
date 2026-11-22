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

  it('updates the active world ID without disconnecting an in-flight MCP call',async()=>{
    const broker=new StudioLiveBridge();
    try{
      const instance=randomUUID(),tab=broker.registerAuto(instance,'original');
      const task=broker.call('alice',tab.worldSessionId,'project',{operation:'run'});
      const pending=await broker.poll(tab.worldSessionId,tab.studioToken);
      expect(pending.request.method).toBe('project');
      expect(broker.updateWorld(tab.worldSessionId,tab.studioToken,'code-project:castle'))
        .toMatchObject({worldSessionId:tab.worldSessionId,worldId:'code-project:castle'});
      expect(broker.status('alice',tab.worldSessionId).worldId).toBe('code-project:castle');
      expect(()=>broker.updateWorld(tab.worldSessionId,'incorrect','wrong'))
        .toThrow('STUDIO_AUTH_FAILED');
      expect(()=>broker.updateWorld(tab.worldSessionId,tab.studioToken,''))
        .toThrow('STUDIO_WORLD_INVALID');
      broker.reply(tab.worldSessionId,tab.studioToken,{requestId:pending.request.requestId,result:{status:'project-running'}});
      expect(await task).toEqual({status:'project-running'});
    }finally{broker.dispose();}
  });

  it('lists live paired and automatic sessions without claiming unowned tabs and removes stale sessions', () => {
    let now=1000;
    const broker=new StudioLiveBridge({now:()=>now,heartbeatMs:100});
    try {
      const first=broker.registerAuto(randomUUID(),'first');
      const second=broker.registerAuto(randomUUID(),'second');
      const pair=broker.pair('bob');
      broker.connect(pair.pairCode);
      const found=broker.listSessions('alice');
      expect(found.map(item=>item.worldSessionId).sort()).toEqual([first.worldSessionId,second.worldSessionId].sort());
      expect(broker.sessions.get(first.worldSessionId).owner).toBeNull();
      expect(broker.listSessions('bob')).toHaveLength(3);
      expect(broker.status('bob',pair.worldSessionId).mode).toBe('paired');
      expect(() => broker.currentSession('alice')).toThrow('STUDIO_MULTIPLE_WORLDS');
      broker.ownerSession('alice',first.worldSessionId);
      expect(broker.listSessions('bob').map(item=>item.worldSessionId)).not.toContain(first.worldSessionId);
      now+=101;
      expect(broker.listSessions('alice')).toHaveLength(0);
      expect(broker.autoByInstance.size).toBe(0);
    } finally {broker.dispose();}
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
