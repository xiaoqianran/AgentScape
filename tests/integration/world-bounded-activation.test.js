import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createSession} from '../../application/createSession.js';
import {createMonumentHall} from '../../modules/world/content/monumentHall.js';
import {WorldStorage} from '../../application/scene/WorldStorage.js';
import {WorldDiskStorage} from '../../apps/server/WorldDiskStorage.js';
import {exportWorld,prepareWorld} from '../../application/scene/WorldIO.js';
import {EnvironmentPlugins} from '../../application/scene/WorldDocument.js';

it('imports all indexed entities while activating only the configured resource budget',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'agentscape-world-bounded-'));
  const make=async()=>{const s=createSession(null,{environmentFactory:()=>createMonumentHall({loadAssets:false})});await s.world.init();return s;};
  const source=await make(),target=await make();
  try {
    for(let index=0;index<500;index++)await source.world.spawn('cup',{id:`cup_${index}`,position:[index/5,0,0],active:index%2===0});
    const store=new WorldStorage(await new WorldDiskStorage(directory).initialize());
    const root=await exportWorld(source.world,store);
    const plugins=new EnvironmentPlugins().register('monument-hall',{create:()=>createMonumentHall({loadAssets:false})});
    const prepared=await prepareWorld(store,root,{plugins,active:'bounded',maxActiveEntities:16});
    expect(prepared.summary).toMatchObject({entities:500,activeEntities:16,dormantEntities:484});
    await prepared.commit(target.world);
    expect(target.world.store.size).toBe(500);
    expect([...target.world.store.values()].filter(item=>item.active!==false)).toHaveLength(16);
    expect(target.world.store.get('cup_499').active).toBe(false);
  }finally{source.scene.close();target.scene.close();source.world.dispose();target.world.dispose();await rm(directory,{recursive:true,force:true});}
},90000);
