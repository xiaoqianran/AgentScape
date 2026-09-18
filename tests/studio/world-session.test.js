import { describe, expect, it, vi } from 'vitest';
import { WorldSession } from '../../apps/studio/runtime/WorldSession.js';
import { AutosaveController } from '../../apps/studio/persistence/AutosaveController.js';
import { LocalSceneStore } from '../../apps/studio/persistence/LocalSceneStore.js';
import { resolveStudioWorldIdentity, studioSceneStoreKey } from '../../apps/studio/runtime/StudioWorldIdentity.js';

class MemoryStorage {
  constructor(){ this.map=new Map(); }
  setItem(key,value){ this.map.set(key,String(value)); }
  getItem(key){ return this.map.has(key) ? this.map.get(key) : null; }
  removeItem(key){ this.map.delete(key); }
}

function eventBus() {
  const listeners=new Map();
  return {
    on(type,listener){
      const set=listeners.get(type) || new Set();
      set.add(listener); listeners.set(type,set);
      return ()=>set.delete(listener);
    },
    emit(type,payload){ for(const listener of [...(listeners.get(type) || [])]) listener(payload); }
  };
}

const builtin={
  id:'monument-hall',
  title:'纪念大厅',
  number:'WORLD 01',
  bootstrap:{agent:[0,0,0],cup:[1,0,1]}
};

function harness({restore=null,toolCall=null}={}) {
  const events=eventBus();
  const previous={id:'monument-hall',dispose:vi.fn()};
  let objects=[{id:'chair_01',type:'prop'}];
  const world={
    environment:previous,
    events,
    queries:{listObjects:()=>objects.map((item)=>({...item}))},
    history:{clear:vi.fn()},
    snapshot:vi.fn(()=>({schema:'agentscape.scene',objects:objects.map((item)=>({...item}))})),
    serialize:vi.fn(()=>({schema:'agentscape.scene',metadata:{savedAt:'2026-09-19T00:00:00.000Z'},objects:objects.map((item)=>({...item}))})),
    clearObjects:vi.fn(async()=>{objects=[];}),
    replaceEnvironment:vi.fn(async(environment,{reason}={})=>{
      const previousId=world.environment?.id || null;
      world.environment=environment;
      events.emit('environment.replaced',{id:environment?.id || null,previousId,reason});
      return {status:'environment-ready'};
    }),
    restore:vi.fn(async(scene)=>{
      if(restore) return restore({scene,world,setObjects:(next)=>{objects=next;}});
      objects=(scene?.objects || []).map((item)=>({...item}));
      events.emit('scene.restored',{objects:objects.length});
    })
  };
  const tools={
    call:vi.fn(async(name,args)=>{
      if(toolCall) return toolCall({name,args,world,setObjects:(next)=>{objects=next;},getObjects:()=>objects});
      if(name==='spawnAsset') objects.push({
        id:args.instanceId,
        type:args.assetId==='agent' ? 'agent' : 'asset',
        assetId:args.assetId
      });
      return args.instanceId;
    })
  };
  const storage=new MemoryStorage();
  const store=new LocalSceneStore({storage});
  const autosave=new AutosaveController({runtime:world,store,delayMs:1000}).start();
  return {world,tools,storage,store,autosave,previous,getObjects:()=>objects,setObjects:(next)=>{objects=next;}};
}

function seed(store,key,scene) {
  const previousKey=store.key;
  store.setKey(key).save(scene);
  store.setKey(previousKey);
}

describe('WorldSession',()=>{
  it('restores the current world through one session boundary',async()=>{
    const h=harness();
    const saved={schema:'agentscape.scene',objects:[{id:'agent_01',type:'agent'},{id:'saved_cup',type:'prop'}]};
    seed(h.store,'agentscape.scene.autosave.monument-hall',saved);
    const session=new WorldSession({
      world:h.world,tools:h.tools,store:h.store,autosave:h.autosave,builtins:[builtin],fallback:builtin
    });

    const result=await session.open();
    expect(result).toMatchObject({status:'world-ready',restoration:{mode:'restored'}});
    expect(h.getObjects().map((item)=>item.id)).toEqual(['agent_01','saved_cup']);
    expect(session.current).toMatchObject({id:'monument-hall',generated:false});
    session.dispose();
  });

  it('opens a materialized generated world, restores its own scene, and commits only after rebinding',async()=>{
    const h=harness();
    const next={
      id:'generated-garden',
      generated:{artifacts:{'world-manifest':'manifest_01'}},
      dispose:vi.fn()
    };
    const identity=resolveStudioWorldIdentity(next);
    seed(h.store,studioSceneStoreKey(identity),{
      schema:'agentscape.scene',
      objects:[{id:'agent_01',type:'agent'},{id:'bench_01',type:'prop'}]
    });
    const phases=[];
    const session=new WorldSession({
      world:h.world,tools:h.tools,store:h.store,autosave:h.autosave,builtins:[builtin],fallback:builtin,
      onEnvironmentChange:vi.fn(async(event)=>phases.push(event.phase))
    });

    const result=await session.open(async()=>next,{reason:'test-generated'});
    expect(result).toMatchObject({
      status:'world-opened',
      environmentId:'generated-garden',
      identity:{id:'generated-garden',generated:true},
      restoration:{mode:'restored'}
    });
    expect(phases).toEqual(['commit']);
    expect(h.world.environment).toBe(next);
    expect(h.previous.dispose).toHaveBeenCalledOnce();
    expect(next.dispose).not.toHaveBeenCalled();
    expect(h.store.key).toBe(studioSceneStoreKey(identity));
    expect(h.getObjects().map((item)=>item.id)).toEqual(['agent_01','bench_01']);
    session.dispose();
  });

  it('rolls the Runtime, persistence identity, and surface binding back when the new world cannot restore or bootstrap',async()=>{
    let next=null;
    const h=harness({
      restore:async({scene,world,setObjects})=>{
        if(world.environment===next) throw new Error('generated scene restore failed');
        setObjects((scene?.objects || []).map((item)=>({...item})));
      },
      toolCall:async({world})=>{
        if(world.environment===next) throw new Error('generated bootstrap failed');
      }
    });
    next={
      id:'generated-broken',
      generated:{artifacts:{'world-manifest':'manifest_broken'}},
      dispose:vi.fn()
    };
    const nextKey=studioSceneStoreKey(resolveStudioWorldIdentity(next));
    seed(h.store,nextKey,{schema:'agentscape.scene',objects:[{id:'bad',type:'prop'}]});
    const phases=[];
    const session=new WorldSession({
      world:h.world,tools:h.tools,store:h.store,autosave:h.autosave,builtins:[builtin],fallback:builtin,
      onEnvironmentChange:vi.fn(async(event)=>phases.push(event.phase))
    });
    const previousKey=h.store.key;
    const previousObjects=h.getObjects().map((item)=>({...item}));

    await expect(session.replace(next,{reason:'test-broken'})).rejects.toMatchObject({code:'WORLD_SESSION_RESTORE_FAILED'});
    expect(h.world.environment).toBe(h.previous);
    expect(session.current).toMatchObject({id:'monument-hall',generated:false});
    expect(h.store.key).toBe(previousKey);
    expect(h.getObjects()).toEqual(previousObjects);
    expect(next.dispose).toHaveBeenCalledOnce();
    expect(h.previous.dispose).not.toHaveBeenCalled();
    expect(phases).toEqual(['rollback']);
    session.dispose();
  });

  it('resets the active world transactionally and persists the new baseline',async()=>{
    const h=harness();
    const session=new WorldSession({
      world:h.world,tools:h.tools,store:h.store,autosave:h.autosave,builtins:[builtin],fallback:builtin
    });
    h.store.save({schema:'agentscape.scene',objects:[{id:'old',type:'prop'}]});

    const result=await session.reset();
    expect(result).toMatchObject({status:'world-reset',identity:{id:'monument-hall'}});
    expect(h.tools.call).toHaveBeenCalledWith('spawnAsset',{assetId:'agent',position:[0,0,0],instanceId:'agent_01'});
    expect(h.tools.call).toHaveBeenCalledWith('spawnAsset',{assetId:'cup',position:[1,0,1],instanceId:'cup_01'});
    expect(h.store.load().objects.map((item)=>item.id)).toEqual(['agent_01','cup_01']);
    session.dispose();
  });

  it('adopts external Runtime replacements and stops observing after disposal',async()=>{
    const h=harness();
    const changes=[];
    const session=new WorldSession({
      world:h.world,tools:h.tools,store:h.store,autosave:h.autosave,builtins:[builtin],fallback:builtin,
      onEnvironmentChange:vi.fn(async(event)=>changes.push(event.phase))
    });
    const external={id:'external-world',generated:{manifest:{url:'https://example.com/world.json'}}};
    h.world.environment=external;
    h.world.events.emit('environment.replaced',{id:'external-world',previousId:'monument-hall'});
    await Promise.resolve();

    expect(session.current).toMatchObject({id:'external-world',generated:true});
    expect(changes).toEqual(['external']);
    session.dispose();

    h.world.environment={id:'ignored-world',generated:{manifest:{url:'https://example.com/ignored.json'}}};
    h.world.events.emit('environment.replaced',{id:'ignored-world',previousId:'external-world'});
    expect(session.current.id).toBe('external-world');
  });
});
