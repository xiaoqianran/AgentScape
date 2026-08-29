import { describe, expect, it } from 'vitest';
import { ArtifactRegistry } from '../../generation/artifacts/ArtifactRegistry.js';

const H1=`sha256:${'a'.repeat(64)}`;
const H2=`sha256:${'c'.repeat(64)}`;
const HP=`sha256:${'b'.repeat(64)}`;
const NOW=Date.parse('2026-08-24T08:00:00.000Z');

const artifact=(overrides={})=>({
  id:'artifact_01',role:'primary-glb',type:'asset-bundle',
  schema:{id:'agentscape.artifact',version:'1'},displayName:'Generated Chair',
  mime:'model/gltf-binary',format:'glb',bytes:4096,hash:H1,
  producer:{
    jobId:'job_01',provider:'modal-3d',operation:'modal-3d.asset.image_to_3d.v1',
    stage:'reconstructing',attempt:1,revision:'r1'
  },
  lineage:{parents:[{artifactId:'artifact_input',hash:HP,relation:'input'}]},
  createdAt:'2026-08-24T07:00:00.000Z',retention:{class:'project'},
  locations:[{
    id:'loc_connector',kind:'connector',scope:'job',state:'available',
    access:{kind:'connector-artifact',artifactId:'artifact_01',connector:{id:'unified-connector',instance:'instance_01'}}
  }],
  ...overrides
});

describe('ArtifactRegistry identity and location semantics',()=>{
  it('registers idempotently by artifact identity but rejects immutable identity conflict',()=>{
    const registry=new ArtifactRegistry({now:()=>NOW});
    const first=registry.register(artifact());
    const second=registry.register(artifact({displayName:'Different safe UI label',warnings:['new-warning']}));
    expect(second).toEqual(first);
    expect(registry.list()).toHaveLength(1);

    expect(()=>registry.register(artifact({hash:H2})))
      .toThrow(expect.objectContaining({code:'ARTIFACT_IDENTITY_CONFLICT'}));
    expect(()=>registry.register(artifact({bytes:4097})))
      .toThrow(expect.objectContaining({code:'ARTIFACT_IDENTITY_CONFLICT'}));
    expect(registry.get('artifact_01').hash).toBe(H1);
  });

  it('indexes content-equivalent artifacts by hash without merging their opaque IDs',()=>{
    const registry=new ArtifactRegistry({now:()=>NOW});
    registry.register(artifact());
    registry.register(artifact({
      id:'artifact_02',
      producer:{...artifact().producer,jobId:'job_02'},
      locations:[{id:'loc_2',kind:'connector',scope:'job',state:'available',access:{kind:'connector-artifact',artifactId:'artifact_02',connector:{id:'unified-connector',instance:'instance_01'}}}]
    }));
    expect(registry.findByHash(H1)).toEqual(['artifact_01','artifact_02']);
    expect(registry.get('artifact_01').id).not.toBe(registry.get('artifact_02').id);
  });

  it('returns defensive snapshots rather than exposing mutable registry internals',()=>{
    const registry=new ArtifactRegistry({now:()=>NOW});
    const registered=registry.register(artifact());
    registered.displayName='mutated outside';
    registered.locations[0].state='evicted';
    const fetched=registry.get('artifact_01');
    expect(fetched.displayName).toBe('Generated Chair');
    expect(fetched.locations[0].state).toBe('available');
    expect('artifacts' in registry).toBe(false);
    expect('hashIndex' in registry).toBe(false);
    expect('leases' in registry).toBe(false);
  });

  it('allows location state refresh but rejects identity reuse across kind/scope/access',()=>{
    const registry=new ArtifactRegistry({now:()=>NOW});
    registry.register(artifact());
    const refreshed=registry.updateLocation('artifact_01',{
      id:'loc_connector',kind:'connector',scope:'job',state:'expired',access:null
    });
    expect(refreshed.locations[0]).toMatchObject({id:'loc_connector',kind:'connector',scope:'job',state:'expired',access:null});
    expect(()=>registry.updateLocation('artifact_01',{
      id:'loc_connector',kind:'local-cache',scope:'application',state:'available',
      access:{kind:'cache-key',key:'cache_artifact_01'}
    })).toThrow(expect.objectContaining({code:'ARTIFACT_LOCATION_IDENTITY_CONFLICT'}));
  });

  it('updates/removes mutable locations without deleting artifact identity or lineage',()=>{
    const registry=new ArtifactRegistry({now:()=>NOW});
    registry.register(artifact());
    registry.updateLocation('artifact_01',{
      id:'loc_cache',kind:'local-cache',scope:'application',state:'available',
      verifiedAt:'2026-08-24T07:30:00.000Z',access:{kind:'cache-key',key:'cache_artifact_01'}
    });
    expect(registry.get('artifact_01').locations.map((item)=>item.id).sort())
      .toEqual(['loc_cache','loc_connector']);

    const removed=registry.removeLocation('artifact_01','loc_connector');
    expect(removed.removed).toBe(true);
    expect(removed.artifact.locations.map((item)=>item.id)).toEqual(['loc_cache']);
    expect(removed.artifact.hash).toBe(H1);
    expect(removed.artifact.lineage.parents).toEqual([{artifactId:'artifact_input',hash:HP,relation:'input'}]);
    expect(registry.findByHash(H1)).toContain('artifact_01');
  });
});

describe('ArtifactRegistry integrity evidence',()=>{
  it('requires an explicit matching integrity transition before descriptor becomes verified',()=>{
    const registry=new ArtifactRegistry({now:()=>NOW});
    expect(registry.register(artifact()).integrity.state).toBe('declared');
    const verified=registry.verifyIntegrity('artifact_01',{
      hash:H1,bytes:4096,mime:'model/gltf-binary',
      verifiedAt:'2026-08-24T07:45:00.000Z',method:'stream-sha256-v1'
    });
    expect(verified.integrity).toEqual({
      state:'verified',verifiedAt:'2026-08-24T07:45:00.000Z',method:'stream-sha256-v1',rejection:null
    });
  });

  it('rejects mismatched bytes/hash/MIME instead of mutating integrity state',()=>{
    const cases=[
      {hash:H2,bytes:4096,mime:'model/gltf-binary'},
      {hash:H1,bytes:4097,mime:'model/gltf-binary'},
      {hash:H1,bytes:4096,mime:'application/octet-stream'}
    ];
    for (const mismatch of cases) {
      const registry=new ArtifactRegistry({now:()=>NOW});
      registry.register(artifact());
      expect(()=>registry.verifyIntegrity('artifact_01',{
        ...mismatch,verifiedAt:'2026-08-24T07:45:00.000Z',method:'stream-sha256-v1'
      })).toThrow(expect.objectContaining({code:'ARTIFACT_INTEGRITY_MISMATCH'}));
      expect(registry.get('artifact_01').integrity.state).toBe('declared');
    }
  });

  it('records explicit rejected integrity evidence separately from descriptor identity',()=>{
    const registry=new ArtifactRegistry({now:()=>NOW});
    registry.register(artifact());
    const rejected=registry.rejectIntegrity('artifact_01',{
      code:'HASH_MISMATCH',checkedAt:'2026-08-24T07:45:00.000Z'
    });
    expect(rejected.integrity).toEqual({
      state:'rejected',verifiedAt:null,method:null,
      rejection:{code:'HASH_MISMATCH',checkedAt:'2026-08-24T07:45:00.000Z'}
    });
    expect(rejected.hash).toBe(H1);
  });
});

describe('ArtifactRegistry lease semantics',()=>{
  it('acquires/releases an artifact-wide lease and reports it independently of locations',()=>{
    const registry=new ArtifactRegistry({now:()=>NOW});
    registry.register(artifact());
    const lease=registry.acquireLease('artifact_01',{
      id:'lease_01',holder:{kind:'job',id:'job_consumer'},reason:'compile-input',
      createdAt:'2026-08-24T07:50:00.000Z',expiresAt:'2026-08-24T09:00:00.000Z'
    });
    expect(lease).toMatchObject({artifactId:'artifact_01',locationId:null});
    expect(registry.isLeased('artifact_01')).toBe(true);
    expect(registry.leasesFor('artifact_01')).toHaveLength(1);
    expect(registry.releaseLease('lease_01')).toBe(true);
    expect(registry.isLeased('artifact_01')).toBe(false);
  });

  it('an artifact-wide lease protects every location from cleanup',()=>{
    const registry=new ArtifactRegistry({now:()=>NOW});
    registry.register(artifact());
    registry.updateLocation('artifact_01',{
      id:'loc_cache',kind:'local-cache',scope:'application',state:'available',
      access:{kind:'cache-key',key:'cache_artifact_01'}
    });
    registry.acquireLease('artifact_01',{
      id:'lease_all',holder:{kind:'project',id:'project_01'},reason:'project-retention',
      createdAt:'2026-08-24T07:50:00.000Z',expiresAt:'2026-08-24T09:00:00.000Z'
    });
    expect(()=>registry.removeLocation('artifact_01','loc_connector'))
      .toThrow(expect.objectContaining({code:'ARTIFACT_LOCATION_LEASED'}));
    expect(()=>registry.removeLocation('artifact_01','loc_cache'))
      .toThrow(expect.objectContaining({code:'ARTIFACT_LOCATION_LEASED'}));
    expect(registry.get('artifact_01').locations).toHaveLength(2);
  });

  it('protects a leased location while allowing a different unleased location to be removed',()=>{
    const registry=new ArtifactRegistry({now:()=>NOW});
    registry.register(artifact());
    registry.updateLocation('artifact_01',{
      id:'loc_cache',kind:'local-cache',scope:'application',state:'available',
      access:{kind:'cache-key',key:'cache_artifact_01'}
    });
    registry.acquireLease('artifact_01',{
      id:'lease_loc',locationId:'loc_connector',holder:{kind:'transfer',id:'transfer_01'},
      reason:'active-transfer',createdAt:'2026-08-24T07:50:00.000Z',expiresAt:'2026-08-24T09:00:00.000Z'
    });
    expect(()=>registry.removeLocation('artifact_01','loc_connector'))
      .toThrow(expect.objectContaining({code:'ARTIFACT_LOCATION_LEASED'}));
    expect(registry.removeLocation('artifact_01','loc_cache').removed).toBe(true);
    expect(registry.get('artifact_01').locations.map((item)=>item.id)).toEqual(['loc_connector']);
  });

  it('rejects unsafe lease reasons rather than exposing transport/credential text',()=>{
    const registry=new ArtifactRegistry({now:()=>NOW});
    registry.register(artifact());
    for (const reason of ['Bearer secret-token','https://internal.example/token']) {
      expect(()=>registry.acquireLease('artifact_01',{
        id:`lease_${reason.startsWith('Bearer')?'bearer':'url'}`,
        holder:{kind:'job',id:'job_unsafe'},reason,
        createdAt:'2026-08-24T07:50:00.000Z',expiresAt:'2026-08-24T09:00:00.000Z'
      })).toThrow(expect.objectContaining({code:'ARTIFACT_LEASE_INVALID'}));
    }
  });

  it('rejects already-expired leases and ignores leases after expiry',()=>{
    let now=NOW;
    const registry=new ArtifactRegistry({now:()=>now});
    registry.register(artifact());
    expect(()=>registry.acquireLease('artifact_01',{
      id:'lease_expired',holder:{kind:'job',id:'job_02'},reason:'compile-input',
      createdAt:'2026-08-24T07:00:00.000Z',expiresAt:'2026-08-24T07:30:00.000Z'
    })).toThrow(expect.objectContaining({code:'ARTIFACT_LEASE_INVALID'}));

    registry.acquireLease('artifact_01',{
      id:'lease_live',holder:{kind:'job',id:'job_03'},reason:'compile-input',
      createdAt:'2026-08-24T07:50:00.000Z',expiresAt:'2026-08-24T08:30:00.000Z'
    });
    expect(registry.isLeased('artifact_01')).toBe(true);
    now=Date.parse('2026-08-24T08:31:00.000Z');
    expect(registry.isLeased('artifact_01')).toBe(false);
    expect(registry.leasesFor('artifact_01',{includeExpired:true})).toHaveLength(1);
  });
});
