import {describe,it,expect,afterEach} from 'vitest';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {WorldRepository} from '../../apps/server/WorldRepository.js';
import {handleWorldRepositoryHttp} from '../../apps/server/WorldRepositoryHttp.js';

const dirs=[];
const make=async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'agentscape-world-repo-'));dirs.push(directory);
 return new WorldRepository({directory});
};
const project=(id='world_a',source='export function createProject() {}')=>({
 schema:'agentscape.code-project',schemaVersion:1,id,name:'测试共享世界',source,resources:{},
 edits:{schema:'agentscape.native-edits',schemaVersion:1,overrides:{tower:{position:[6,0,0]}}}
});
afterEach(async()=>Promise.all(dirs.splice(0).map(dir=>rm(dir,{recursive:true,force:true}))));

describe('WorldRepository content-addressed persisted project and authoring worlds',()=>{
 it('publishes, lists bounded metadata, reads in a second repository and protects versions',async()=>{
  const repo=await make(),id='world_shared';
  const first=await repo.publish({id,kind:'code-project',baseVersion:null,content:project(id)});
  expect(first).toMatchObject({id,version:1,kind:'code-project'});
  expect(JSON.stringify(await repo.list())).not.toContain('export function');
  const other=new WorldRepository({directory:repo.directory});
  expect((await other.load(id)).content.edits.overrides.tower.position).toEqual([6,0,0]);
  await expect(other.publish({id,kind:'code-project',baseVersion:null,content:project(id)}))
    .rejects.toMatchObject({code:'WORLD_REPOSITORY_VERSION_CONFLICT'});
  const second=await other.publish({id,kind:'code-project',baseVersion:1,
    content:project(id,'export function createProject(){return 2;}')});
  expect(second.version).toBe(2);
  expect((await repo.load(id)).content.source).toContain('return 2');
  await expect(repo.publish({id,kind:'code-project',baseVersion:1,content:project(id)}))
    .rejects.toMatchObject({code:'WORLD_REPOSITORY_VERSION_CONFLICT'});
 });
 it('rejects unsafe IDs and verifies immutable bytes after tampering',async()=>{
  const repo=await make();
  await expect(repo.publish({id:'../escape',kind:'code-project',baseVersion:null,content:project()}))
    .rejects.toMatchObject({code:'WORLD_REPOSITORY_ID_INVALID'});
  await expect(repo.publish({id:'world_b',kind:'code-project',baseVersion:null,content:project('wrong')}))
    .rejects.toMatchObject({code:'WORLD_REPOSITORY_ID_MISMATCH'});
  await repo.publish({id:'world_b',kind:'code-project',baseVersion:null,content:project('world_b')});
  const pointer=await repo.getPointer('world_b');
  const block=path.join(repo.blocksDirectory,pointer.blocks[0].hash);
  const bytes=await readFile(block);bytes[5]^=1;await writeFile(block,bytes);
  await expect(repo.load('world_b')).rejects.toMatchObject({code:'WORLD_INTEGRITY_MISMATCH'});
 });
 it('supports typed authoring-draft worlds in the same indexed repository',async()=>{
  const repo=await make(),id='world_draft';
  const document={format:'agentscape-world-authoring',version:1,root:{id:'root',children:[]}};
  await repo.publish({id,kind:'authoring-draft',baseVersion:null,content:{id,name:'草稿',document,promotions:null}});
  expect((await repo.list()).worlds[0]).toMatchObject({id,kind:'authoring-draft'});
  expect((await repo.load(id)).content.document).toEqual(document);
  await expect(repo.publish({id,kind:'code-project',baseVersion:1,content:project(id)}))
    .rejects.toMatchObject({code:'WORLD_REPOSITORY_VERSION_CONFLICT'});
 });
});

async function serve(repository,publishToken) {
 const server=createServer(async(req,res)=>{if(!await handleWorldRepositoryHttp(req,res,repository,{publishToken}))res.writeHead(404).end();});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {server,url:'http://127.0.0.1:'+server.address().port};
}
describe('WorldRepository HTTP auth and publication',()=>{
 it('requires an explicit token and same origin, and does not allow stale overwrite',async()=>{
  const repo=await make(),token='private-shared-secret-with-required-entropy';
  const {server,url}=await serve(repo,token);
  try{
   const target=url+'/api/studio/worlds/world_browser';
   const input={kind:'code-project',baseVersion:null,content:project('world_browser')};
   const put=(headers={})=>fetch(target,{method:'PUT',headers:{'content-type':'application/json',...headers},body:JSON.stringify(input)});
   expect((await put()).status).toBe(401);
   expect((await put({authorization:'Bearer invalid'})).status).toBe(401);
   expect((await put({authorization:'Bearer '+token,origin:'http://attacker.example'})).status).toBe(403);
   expect((await put({authorization:'Bearer '+token,origin:url})).status).toBe(200);
   expect((await put({authorization:'Bearer '+token,origin:url})).status).toBe(409);
   expect((await(await fetch(target)).json()).content.edits.overrides.tower.position).toEqual([6,0,0]);
   expect((await(await fetch(url+'/api/studio/worlds')).json()).total).toBe(1);
  }finally{await new Promise(resolve=>server.close(resolve));}
 });
 it('is read-only when the deployment has no publish token',async()=>{
  const repo=await make(),{server,url}=await serve(repo,'');
  try{
   const response=await fetch(url+'/api/studio/worlds/world_x',{method:'PUT',body:'{}'});
   expect(response.status).toBe(503);
   expect((await response.json()).code).toBe('WORLD_REPOSITORY_READ_ONLY');
  }finally{await new Promise(resolve=>server.close(resolve));}
 });
});
