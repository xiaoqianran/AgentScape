import { describe, expect, it } from 'vitest';
import { AuthoringWorldStore } from '../../apps/studio/persistence/AuthoringWorldStore.js';

describe('AuthoringWorldStore', () => {
  it('persists save/load/list/remove through the injected fallback store', async () => {
    const memory = new Map();
    let tick = 0;
    const now = () => `2026-09-18T00:00:0${tick++}.000Z`;
    const first = new AuthoringWorldStore({ indexedDBImpl:null, memory, now });

    const document = {
      format:'agentscape-world-authoring',
      version:1,
      root:{
        id:'root',
        components:{
          transform:{
            type:'Transform',
            properties:{
              position:[0,0,0],
              quaternion:[0,0,0,1],
              scale:[1,1,1]
            }
          }
        }
      }
    };

    const saved = await first.save({
      id:'garden',
      name:'Garden',
      document
    });

    expect(saved).toMatchObject({
      id:'garden',
      name:'Garden',
      createdAt:'2026-09-18T00:00:00.000Z',
      updatedAt:'2026-09-18T00:00:00.000Z'
    });

    document.root.name = 'mutated-after-save';

    const second = new AuthoringWorldStore({ indexedDBImpl:null, memory, now });
    const loaded = await second.load('garden');
    expect(loaded.document.root.name).toBeUndefined();

    await second.save({
      id:'garden',
      name:'Garden v2',
      document:loaded.document
    });

    const list = await second.list();
    expect(list).toEqual([{
      id:'garden',
      name:'Garden v2',
      createdAt:'2026-09-18T00:00:00.000Z',
      updatedAt:'2026-09-18T00:00:01.000Z'
    }]);
    expect(list[0]).not.toHaveProperty('document');

    expect(await second.remove('garden')).toBe(true);
    expect(await second.load('garden')).toBeNull();
    expect(await second.remove('garden')).toBe(false);
  });
});
