import { describe, expect, it, vi } from 'vitest';
import { StudioResources } from '../../apps/studio/resources/StudioResources.js';

const makeWorld=()=>{
  const listeners=new Map();
  const events={
    on:(type,listener)=>{
      const list=listeners.get(type)||[]; list.push(listener); listeners.set(type,list);
      return ()=>listeners.set(type,(listeners.get(type)||[]).filter((item)=>item!==listener));
    },
    emit:(type,payload)=>{ for(const listener of listeners.get(type)||[]) listener(payload); }
  };
  const artifact={
    id:'image_01', mime:'image/png', role:'primary-image', displayName:'Image 01', bytes:3,
    locations:[{kind:'local-cache',state:'available',access:{kind:'cache-key',key:'cache_image_01'}}],
    producer:{provider:'fixture',jobId:'job_01'}, integrity:{state:'verified'}
  };
  const approveAsset=vi.fn(async(assetId)=>({assetId,status:'approved'}));
  return {
    events,
    environment:{id:'world_01',title:'World 01'},
    assetModule:{
      catalog:{list:()=>[{id:'chair',label:'Chair',source:'builtin'},{id:'generated',label:'Generated',source:'compiled'}]},
      library:{listSync:()=>[{assetId:'generated',status:'approved'}]},
      approveAsset
    },
    generation:{artifacts:{
      registry:{get:(id)=>id===artifact.id?artifact:null,list:()=>[artifact]},
      byteStore:{get:(key)=>key==='cache_image_01'?{data:new Uint8Array([1,2,3])}:null}
    }}
  };
};

const makeResources=(world,options={})=>new StudioResources({
  assetModule:world.assetModule,
  artifactModule:world.generation.artifacts,
  events:world.events,
  getEnvironment:()=>world.environment,
  ...options
});

describe('StudioResources',()=>{
  it('projects product resources without exposing storage details to presentation',()=>{
    const world=makeWorld();
    const resources=makeResources(world,{environments:[{id:'world_01',title:'World 01'}]});
    expect(resources.currentEnvironment()).toEqual({id:'world_01',title:'World 01',label:'World 01'});
    expect(resources.localArtifact('image_01').data).toEqual(new Uint8Array([1,2,3]));
    expect(resources.snapshot().assets.map((item)=>item.id)).toEqual(['chair','generated']);
    expect(resources.snapshot().images[0].id).toBe('image_01');
  });

  it('owns library approval and emits the product resource change event',async()=>{
    const world=makeWorld();
    const resources=makeResources(world);
    const changed=vi.fn();
    const off=resources.onChange(changed);
    await resources.approveAsset('generated',{label:'Generated'});
    expect(world.assetModule.approveAsset).toHaveBeenCalledWith('generated',{label:'Generated'});
    expect(changed).toHaveBeenCalledWith('asset.library.changed');
    off();
  });
});
