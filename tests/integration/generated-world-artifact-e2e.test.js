import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ArtifactRegistry } from '../../generation/artifacts/ArtifactRegistry.js';
import { MemoryArtifactByteStore } from '../../generation/artifacts/MemoryArtifactByteStore.js';
import { GenerationOrchestrator } from '../../generation/orchestration/GenerationOrchestrator.js';
import { loadGeneratedWorld } from '../../world/loadGeneratedWorld.js';

const sha=(bytes)=>`sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const text=(value)=>new TextEncoder().encode(value);

const meshBytes=text(`ply
format ascii 1.0
element vertex 4
property float x
property float y
property float z
element face 2
property list uchar int vertex_indices
end_header
-2 0 -2
2 0 -2
2 0 2
-2 0 2
3 0 2 1
3 0 3 2
`);
const semanticsBytes=text(JSON.stringify([{id:1,label:'bench',center_point_3d:[0,0,0]}]));
const spzBytes=new Uint8Array([0x4e,0x47,0x53,0x50,4,0,0,0,1,0,0,0]);

const payloads={
  artifact_world_mesh:{bytes:meshBytes,mime:'model/ply',role:'world-mesh'},
  artifact_world_semantics:{bytes:semanticsBytes,mime:'application/json',role:'world-semantics'},
  artifact_world_visual:{bytes:spzBytes,mime:'model/spz',role:'world-visual'}
};

const summaries=Object.entries(payloads).map(([id,value])=>({
  id,role:value.role,mime:value.mime,bytes:value.bytes.byteLength,hash:sha(value.bytes)
}));

const job={
  id:'job_world_01',provider:'modal-world',operation:'modal-world.world.image_to_world.v1',
  status:'succeeded',attempt:1,capabilityRevision:'caprev_world',model:{id:'hyworld2',version:null,revision:null},workflow:null,
  createdAt:'2026-08-31T00:00:00.000Z',updatedAt:'2026-08-31T00:01:00.000Z',completedAt:'2026-08-31T00:01:00.000Z',
  result:{artifacts:summaries}
};

describe('generated world artifact E2E',()=>{
  it('runs Connector artifacts through integrity verification into loadGeneratedWorld without provider coupling',async()=>{
    const connectorClient={
      session:()=>({status:'paired',connector:{id:'unified-connector',instance:'instance_01'}}),
      request:async(path)=>{
        const id=path.split('/').at(-1);
        const value=payloads[id];
        if(!value) throw new Error(`unexpected artifact ${id}`);
        return new Response(value.bytes,{status:200,headers:{
          'content-type':value.mime,'content-length':String(value.bytes.byteLength)
        }});
      }
    };
    const registry=new ArtifactRegistry();
    const byteStore=new MemoryArtifactByteStore();
    const orchestrator=new GenerationOrchestrator({
      providerRegistry:{listProviders:()=>[],findCapabilities:()=>[]},connectorClient,
      jobClient:{get:async()=>job,list:async()=>[]},artifactRegistry:registry,byteStore
    });

    const mesh=await orchestrator.importGenerationResult(job.id,{role:'world-mesh'});
    const semantics=await orchestrator.importGenerationResult(job.id,{role:'world-semantics'});
    const visual=await orchestrator.importGenerationResult(job.id,{role:'world-visual'});
    expect([mesh,semantics,visual].every((item)=>item.artifact.integrity==='verified')).toBe(true);

    const environment=await loadGeneratedWorld({
      mesh:{data:byteStore.get(mesh.cacheKey).data,format:'ply'},
      semantics:{data:byteStore.get(semantics.cacheKey).data,format:'json'},
      visual:{data:byteStore.get(visual.cacheKey).data,format:'spz'},
      coordinateSystem:'y-up'
    });

    expect(environment.floor.geometry.getAttribute('position').count).toBe(4);
    expect(environment.colliders[0]).toMatchObject({shape:'trimesh'});
    expect(environment.semantics).toEqual([{id:1,label:'bench',center_point_3d:[0,0,0]}]);
    expect(environment.generated.visual).toMatchObject({format:'spz',bytes:spzBytes.byteLength,status:'deferred'});
  });
});
