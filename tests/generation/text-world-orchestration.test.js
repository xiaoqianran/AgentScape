import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { createProviderRegistry } from '../../generation/providers/ProviderRegistry.js';
import { GenerationOrchestrator } from '../../generation/orchestration/GenerationOrchestrator.js';
import { createArtifactModule } from '../../generation/artifacts/ArtifactModule.js';

const enc=(v)=>new TextEncoder().encode(v);
const sha=(b)=>`sha256:${createHash('sha256').update(b).digest('hex')}`;
const image=Uint8Array.from([137,80,78,71,13,10,26,10]);
const mesh=enc(`ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n0 0 1\n3 0 2 1\n`);
const nav=mesh;
const semantics=enc(JSON.stringify({schemaVersion:2,categories:['bench'],instances:[{id:'bench-1',label:'bench',confidence:.9,localization:{kind:'point-scale',center:[0,0,0],scale:.5}}]}));
const visual=Uint8Array.from([0x4e,0x47,0x53,0x50,4,0,0,0,1,0,0,0]);
const manifest=enc(JSON.stringify({schemaVersion:1,id:'generated-garden',coordinateSystem:'y-up',metersPerUnit:1,layout:{bounds:{min:[-4,-4],max:[4,4]},groundY:0,margin:.5},artifacts:{environment:{path:'environment.ply'},semantics:{path:'semantics.json'},visual:{path:'visual.spz'},navigation:{path:'navigation.ply'}}}));
const worldArtifacts=[
  ['artifact_mesh','world-mesh','model/ply',mesh],['artifact_semantics','world-semantics','application/json',semantics],
  ['artifact_visual','world-visual','model/spz',visual],['artifact_manifest','world-manifest','application/json',manifest],
  ['artifact_navigation','world-navigation','model/ply',nav]
].map(([id,role,mime,bytes])=>({id,role,mime,bytes:bytes.byteLength,hash:sha(bytes)}));
const payloads=new Map(worldArtifacts.map((a)=>[a.id,{...a,bytes:[mesh,semantics,visual,manifest,nav][worldArtifacts.indexOf(a)]}]));
payloads.set('artifact_image',{id:'artifact_image',role:'primary-image',mime:'image/png',bytes:image});

const registry=()=>{
  const r=createProviderRegistry();
  r.applyProviderSnapshot({revision:'caprev',hash:'sha256:cap',connector:{id:'connector',instance:'i1',version:'1'},providers:[
    {id:'modal-2d',version:'1',status:'available',health:'healthy',contractVersion:'1',capabilities:[{operation:'modal-2d.image.text_to_image.v1',version:'1',status:'available',category:'image-generation',input:{types:['text'],schema:{type:'object',required:['prompt'],properties:{prompt:{type:'string'}}}},output:{roles:['primary-image'],required:['primary-image']},profiles:{recommended:{}},prerequisites:{authMode:'connector-session',connection:true}}]},
    {id:'modal-world',version:'1',status:'available',health:'healthy',contractVersion:'1',capabilities:[{operation:'modal-world.world.image_to_world.v1',version:'1',status:'available',category:'world-generation',input:{types:['image','text'],schema:{type:'object',required:['sourceArtifact','prompt','model','seed'],properties:{sourceArtifact:{type:'object'},prompt:{type:'string'},model:{type:'string',enum:['hyworld2']},seed:{type:'integer',default:42}}}},output:{roles:['world-mesh','world-semantics','world-visual','world-manifest','world-navigation'],required:['world-mesh','world-semantics','world-visual','world-manifest'],optional:['world-navigation']},profiles:{recommended:{}},prerequisites:{authMode:'connector-session',connection:true}}]}
  ]},{sourceId:'connector:connector',sourceKind:'connector'});
  return r;
};

const job=(body,id,status,result=null)=>({id,provider:body.provider,operation:body.operation,kind:'generation',requestHash:body.requestHash,idempotencyKey:body.idempotencyKey,contractVersion:body.contractVersion,capabilityHash:body.capabilityHash,capabilityRevision:body.capabilityRevision,status,attempt:1,relations:[],effectiveOptions:body.options||{},createdAt:'2026-09-03T00:00:00.000Z',updatedAt:'2026-09-03T00:00:01.000Z',completedAt:status==='succeeded'?'2026-09-03T00:00:01.000Z':null,eventSequence:status==='succeeded'?2:1,result});

it('composes text-to-image and image-to-world and imports the complete verified world bundle',async()=>{
  const submitted=new Map();
  const request=async(path,options={})=>{
    if(path==='/connector/v1/jobs'&&options.method==='POST'){
      const body=JSON.parse(options.body); const id=body.provider==='modal-2d'?'job_image':'job_world'; submitted.set(id,body);
      return new Response(JSON.stringify({job:job(body,id,'accepted')}),{status:200,headers:{'content-type':'application/json'}});
    }
    if(path==='/connector/v1/jobs/job_image'){
      const body=submitted.get('job_image'); const summary={id:'artifact_image',role:'primary-image',mime:'image/png',bytes:image.byteLength,hash:sha(image)};
      return new Response(JSON.stringify({job:job(body,'job_image','succeeded',{artifacts:[summary]})}),{status:200,headers:{'content-type':'application/json'}});
    }
    if(path==='/connector/v1/jobs/job_world'){
      const body=submitted.get('job_world'); return new Response(JSON.stringify({job:job(body,'job_world','succeeded',{artifacts:worldArtifacts})}),{status:200,headers:{'content-type':'application/json'}});
    }
    if(path.startsWith('/connector/v1/artifacts/')){
      const id=path.split('/').at(-1); const item=payloads.get(id); if(!item) throw new Error(`missing ${id}`);
      return new Response(item.bytes,{status:200,headers:{'content-type':item.mime,'content-length':String(item.bytes.byteLength)}});
    }
    throw new Error(`unexpected ${path}`);
  };
  const connectorClient={request,session:()=>({status:'paired',connector:{id:'connector',instance:'i1',version:'1'}})};
  const artifacts=createArtifactModule();
  const orchestrator=new GenerationOrchestrator({providerRegistry:registry(),connectorClient,artifactRegistry:artifacts.registry,byteStore:artifacts.byteStore,pollIntervalMs:0});
  expect(orchestrator.canGenerateTextWorld()).toBe(true);
  const result=await orchestrator.generateTextWorldArtifacts({prompt:'a compact Japanese garden'});
  expect(result).toMatchObject({status:'world-artifacts-ready',route:{kind:'text-image-world',image:{provider:'modal-2d'},world:{provider:'modal-world'}},jobs:{image:'job_image',world:'job_world'}});
  expect(Object.keys(result.artifacts).sort()).toEqual(['world-manifest','world-mesh','world-navigation','world-semantics','world-visual']);
  expect(Object.values(result.artifacts).every((x)=>x.artifact.integrity==='verified')).toBe(true);
  expect(submitted.get('job_world')).toMatchObject({inputs:{sourceArtifact:{id:'artifact_image',role:'primary-image',mime:'image/png',hash:sha(image)},prompt:'a compact Japanese garden',model:'hyworld2',seed:42},parent:{jobId:'job_image'},outputRoles:['world-manifest','world-mesh','world-navigation','world-semantics','world-visual']});
});
