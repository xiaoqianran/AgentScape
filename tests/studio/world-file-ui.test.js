import { it, expect, vi } from 'vitest';
import { createSession } from '../../application/createSession.js';
import { createMonumentHall } from '../../modules/world/content/monumentHall.js';
import { exportWorldFile, importWorldFile } from '../../apps/studio/ui/WorldFileUI.js';

it('streams a Studio world file through browser storage and restores entities without JSON', async () => {
  const files = new Map();
  const directory = {
    async getFileHandle(key, options = {}) {
      if (!options.create && !files.has(key)) throw Object.assign(new Error('Not found'),{name:'NotFoundError'});
      return {
        async getFile() {
          const bytes = files.get(key);
          if (!bytes) throw new Error('Not found');
          return {size:bytes.byteLength,arrayBuffer:async()=>bytes.slice().buffer};
        },
        async createWritable() {
          let bytes;
          return {
            async write(chunk) {bytes = new Uint8Array(chunk);},
            async close() {files.set(key,bytes);},
            async abort() {}
          };
        }
      };
    }
  };
  vi.stubGlobal('navigator',{storage:{getDirectory:async()=>({getDirectoryHandle:async()=>directory})}});
  let chunks = [];
  vi.stubGlobal('showSaveFilePicker',async()=>({createWritable:async()=>({
    async write(bytes) {chunks.push(new Uint8Array(bytes));},
    async close() {},
    async abort() {chunks = [];}
  })}));
  const make = async () => {const session=createSession(null,{environmentFactory:()=>createMonumentHall({loadAssets:false})});await session.world.init();return session;};
  const source = await make(), target=await make();
  try {
    await source.scene.addModel({id:'scene_table',asset:'builtin://table',position:[2,0,3]});
    source.world.store.get('scene_table').state.foo='bar';
    const root = await exportWorldFile(source.world,'monument-hall');
    expect(root.hash).toMatch(/^[a-f0-9]{64}$/);
    const summary = await importWorldFile(target.world,new Blob(chunks),{maxActiveEntities:5});
    expect(summary).toMatchObject({entities:1,environment:'monument-hall'});
    expect(target.world.store.get('scene_table').state.foo).toBe('bar');
    expect(target.world.store.get('scene_table').object.position.toArray()).toEqual([2,0,3]);
  } finally {
    source.scene.close(); target.scene.close(); source.world.dispose(); target.world.dispose(); vi.unstubAllGlobals();
  }
});
