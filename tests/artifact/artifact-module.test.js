import { describe, expect, it, vi } from 'vitest';
import { ArtifactRegistry } from '../../modules/artifact/ArtifactRegistry.js';
import { MemoryArtifactByteStore } from '../../modules/artifact/MemoryArtifactByteStore.js';
import { createArtifactModule } from '../../modules/artifact/ArtifactModule.js';

const HASH='sha256:9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a';
const descriptor={
  id:'artifact_persisted',role:'primary-glb',type:'asset-bundle',
  schema:{id:'agentscape.artifact',version:'1'},displayName:'Persisted GLB',
  mime:'model/gltf-binary',format:'glb',bytes:4,hash:HASH,
  producer:{jobId:'job_01',provider:'modal-3d',operation:'modal-3d.asset.text_to_3d.v1',stage:'generation',attempt:1,revision:'r1'},
  lineage:{parents:[]},createdAt:'2026-09-06T12:00:00.000Z',retention:{class:'project'},
  locations:[{id:'loc_cache',kind:'local-cache',scope:'application',state:'available',verifiedAt:'2026-09-06T12:00:01.000Z',access:{kind:'cache-key',key:'cache_artifact_persisted'}}],
  integrity:{state:'verified',verifiedAt:'2026-09-06T12:00:01.000Z',method:'sha256-v1',rejection:null}
};
const entry={key:'cache_artifact_persisted',artifactId:'artifact_persisted',hash:HASH,mime:'model/gltf-binary',bytes:4,data:new Uint8Array([1,2,3,4])};

describe('createArtifactModule',()=>{
  it('owns Artifact registry, hot byte storage, and optional persistence boundary',()=>{
    const module=createArtifactModule({persistentStore:null});
    expect(module.registry).toBeInstanceOf(ArtifactRegistry);
    expect(module.byteStore).toBeInstanceOf(MemoryArtifactByteStore);
    expect(Object.keys(module).sort()).toEqual(['byteStore','hydrate','persistArtifact','persistentStore','registry']);
  });

  it('accepts externally supplied Artifact infrastructure',()=>{
    const registry=new ArtifactRegistry();
    const byteStore=new MemoryArtifactByteStore();
    const module=createArtifactModule({registry,byteStore,persistentStore:null});
    expect(module.registry).toBe(registry);
    expect(module.byteStore).toBe(byteStore);
  });

  it('hydrates verified descriptors and bytes into a fresh hot cache',async()=>{
    const persistentStore={load:vi.fn(async()=>({descriptors:[descriptor],entries:[entry]}))};
    const module=createArtifactModule({persistentStore});
    await expect(module.hydrate()).resolves.toMatchObject({artifacts:1,entries:1,restored:true});
    expect(module.registry.get('artifact_persisted')).toMatchObject({integrity:{state:'verified'}});
    expect([...module.byteStore.get('cache_artifact_persisted').data]).toEqual([1,2,3,4]);
    await module.hydrate();
    expect(persistentStore.load).toHaveBeenCalledOnce();
  });

  it('persists one verified hot-cache artifact through the module boundary',async()=>{
    const persistentStore={putArtifact:vi.fn(async()=>true)};
    const module=createArtifactModule({persistentStore});
    module.registry.register({ ...descriptor, integrity:{state:'declared'} });
    module.registry.verifyIntegrity('artifact_persisted',{
      hash:HASH,bytes:4,mime:'model/gltf-binary',verifiedAt:'2026-09-06T12:00:01.000Z',method:'sha256-v1'
    });
    module.byteStore.restore(entry);
    await expect(module.persistArtifact('artifact_persisted','cache_artifact_persisted')).resolves.toBe(true);
    expect(persistentStore.putArtifact).toHaveBeenCalledWith(
      expect.objectContaining({id:'artifact_persisted',integrity:expect.objectContaining({state:'verified'})}),
      expect.objectContaining({key:'cache_artifact_persisted',artifactId:'artifact_persisted'})
    );
  });

  it('fails closed when persisted bytes no longer match the verified descriptor',async()=>{
    const tampered={...entry,data:new Uint8Array([1,2,3,5])};
    const persistentStore={load:vi.fn(async()=>({descriptors:[descriptor],entries:[tampered]}))};
    const module=createArtifactModule({persistentStore});
    await expect(module.hydrate()).rejects.toMatchObject({
      code:'ARTIFACT_PERSISTENCE_INTEGRITY_MISMATCH',
      details:expect.objectContaining({artifactId:'artifact_persisted'})
    });
    expect(module.registry.has('artifact_persisted')).toBe(false);
  });
});
