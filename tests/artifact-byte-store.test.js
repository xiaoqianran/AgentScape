import { describe, expect, it } from 'vitest';
import { MemoryArtifactByteStore } from '../generation/artifacts/MemoryArtifactByteStore.js';

const H1=`sha256:${'a'.repeat(64)}`;

describe('MemoryArtifactByteStore transaction',()=>{
  it('keeps chunks temporary until commit and returns defensive byte copies',async()=>{
    const store=new MemoryArtifactByteStore();
    const writer=store.begin({artifactId:'artifact_01',maxBytes:8});
    await writer.write(new Uint8Array([1,2,3]));
    expect(store.get('cache_01')).toBeNull();
    const committed=await writer.commit({key:'cache_01',hash:H1,mime:'application/octet-stream',bytes:3});
    expect(committed).toEqual({key:'cache_01',hash:H1,mime:'application/octet-stream',bytes:3});
    const first=store.get('cache_01');
    expect([...first.data]).toEqual([1,2,3]);
    first.data[0]=99;
    expect([...store.get('cache_01').data]).toEqual([1,2,3]);
    expect(store.findByHash(H1)).toEqual(['cache_01']);
  });

  it('aborts temporary chunks without publishing an entry',async()=>{
    const store=new MemoryArtifactByteStore();
    const writer=store.begin({artifactId:'artifact_01',maxBytes:8});
    await writer.write(new Uint8Array([1,2,3]));
    await writer.abort();
    expect(writer.state).toBe('aborted');
    expect(writer.bytesWritten).toBe(0);
    expect(store.findByHash(H1)).toEqual([]);
  });

  it('enforces maxBytes and commit length consistency',async()=>{
    const store=new MemoryArtifactByteStore();
    const writer=store.begin({artifactId:'artifact_01',maxBytes:3});
    await writer.write(new Uint8Array([1,2]));
    await expect(writer.write(new Uint8Array([3,4]))).rejects.toMatchObject({code:'ARTIFACT_BYTES_LIMIT'});
    await expect(writer.commit({key:'cache_01',hash:H1,mime:'application/octet-stream',bytes:3}))
      .rejects.toMatchObject({code:'ARTIFACT_BYTE_STORE_INVALID'});
    await writer.abort();
  });

  it('does not allow callers to bypass the writer-managed commit transaction',()=>{
    const store=new MemoryArtifactByteStore();
    expect(()=>store._commit(null,{
      key:'cache_unsafe',artifactId:'artifact_01',hash:H1,mime:'application/octet-stream',bytes:0,data:new Uint8Array()
    })).toThrow(expect.objectContaining({code:'ARTIFACT_BYTE_STORE_STATE'}));
    expect(store.get('cache_unsafe')).toBeNull();
  });

  it('rejects cache-key collisions with different identity/content',async()=>{
    const store=new MemoryArtifactByteStore();
    const first=store.begin({artifactId:'artifact_01',maxBytes:2});
    await first.write(new Uint8Array([1]));
    await first.commit({key:'cache_shared',hash:H1,mime:'application/octet-stream',bytes:1});
    const second=store.begin({artifactId:'artifact_02',maxBytes:2});
    await second.write(new Uint8Array([1]));
    await expect(second.commit({key:'cache_shared',hash:H1,mime:'application/octet-stream',bytes:1}))
      .rejects.toMatchObject({code:'ARTIFACT_CACHE_KEY_CONFLICT'});
    await second.abort();
    expect(store.remove('cache_shared')).toBe(true);
    expect(store.get('cache_shared')).toBeNull();
  });
});
