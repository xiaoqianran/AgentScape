import { it, expect } from 'vitest';
import { createSession } from '../../application/createSession.js';
import { createBlankWorld } from '../../modules/world/content/blankWorld.js';

it('keeps SceneFacade editable past 256 unique request IDs while replaying recent edits', async () => {
  const session = createSession(null, { environmentFactory: () => createBlankWorld({ id: 'request-window-world' }) });
  await session.world.init();
  try {
    const created = await session.scene.apply({
      requestId: 'add-cup',
      operations: [{ type: 'add', model: { id: 'cup', asset: 'builtin://cup', position: [0, 1, 0] } }]
    });
    expect(created.status).toBe('succeeded');
    let latest;
    for (let i = 0; i < 270; i++) {
      latest = await session.scene.apply({
        requestId: 'move-' + i,
        operations: [{ type: 'setTransform', id: 'cup', transform: { position: [i / 10, 1, 0] } }]
      });
      expect(latest.status).toBe('succeeded');
    }
    const revision = latest.revision;
    expect(session.scene.snapshot().objects).toHaveLength(1);
    const replay = await session.scene.apply({
      requestId: 'move-269',
      operations: [{ type: 'setTransform', id: 'cup', transform: { position: [26.9, 1, 0] } }]
    });
    expect(replay).toEqual(latest);
    expect(session.scene.observe({ limit: 1 }).revision).toBe(revision);
    await expect(session.scene.apply({
      requestId: 'move-269',
      operations: [{ type: 'setTransform', id: 'cup', transform: { position: [1, 1, 0] } }]
    })).rejects.toMatchObject({ code: 'REQUEST_CONFLICT' });
  } finally {
    session.scene.close();
    session.world.dispose();
  }
}, 60000);
