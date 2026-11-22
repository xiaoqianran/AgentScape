import {afterEach,describe,expect,it} from 'vitest';
import {createServer} from 'node:http';
import {mkdtemp,rm,readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {WorldRepository} from '../../apps/server/WorldRepository.js';
import {handleWorldRepositoryHttp} from '../../apps/server/WorldRepositoryHttp.js';

const dirs=[];
const create=async()=> {
  const directory=await mkdtemp(path.join(tmpdir(),'agentscape-repo-versions-'));
  dirs.push(directory);
  return new WorldRepository({directory});
};
afterEach(async()=>Promise.all(dirs.splice(0).map(dir=>rm(dir,{recursive:true,force:true}))));
const code=(id,label)=>({
  schema:'agentscape.code-project',schemaVersion:1,id,
  name:'城堡'+label,source:'export function createProject() { /* '+label+' */ }',
  resources:{'textures/rock.txt':{mime:'text/plain',base64:'cm9jaw=='}},
  edits:{schema:'agentscape.native-edits',schemaVersion:1,overrides:{keep:{position:[label.length,1,3]}}}
});
const draft=(id,label)=>({
  id,name:'草稿'+label,
  document:{format:'agentscape-world-authoring',version:1,root:{
    id:'root',children:[{id:'node_'+label,components:{name:label},children:[]}]
  }},
  promotions:null
});

describe('WorldRepository persistent immutable revision history',()=>{
  it('reads a legacy v1 head, archives prior versions on first update and paginates newest-first',async()=>{
    const repo=await create(),id='world_legacy';
    const first=await repo.publish({id,kind:'code-project',baseVersion:null,content:code(id,'A')});
    expect(first.version).toBe(1);
    expect((await readdir(repo.historyDirectory))).toEqual([]); // Existing deployment before migration.
    expect((await repo.listVersions(id)).versions).toMatchObject([{version:1}]);
    const second=await repo.publish({id,kind:'code-project',baseVersion:1,content:code(id,'B')});
    const third=await repo.publish({id,kind:'code-project',baseVersion:2,content:code(id,'C')});
    expect([second.version,third.version]).toEqual([2,3]);
    const firstPage=await repo.listVersions(id,{limit:2});
    expect(firstPage).toMatchObject({id,latestVersion:3,total:3,nextOffset:2});
    expect(firstPage.versions.map(item=>item.version)).toEqual([3,2]);
    expect(firstPage.versions[0]).not.toHaveProperty('blocks');
    const secondPage=await repo.listVersions(id,{offset:2,limit:2});
    expect(secondPage.versions.map(item=>item.version)).toEqual([1]);
    expect(secondPage.nextOffset).toBe(null);
    const reopened=new WorldRepository({directory:repo.directory});
    expect((await reopened.load(id,{version:1})).content).toEqual(code(id,'A'));
    expect((await reopened.load(id,{version:2})).content).toEqual(code(id,'B'));
    expect((await reopened.load(id,{version:3})).content).toEqual(code(id,'C'));
    expect((await reopened.load(id)).version).toBe(3);
    const records=await readdir(path.join(repo.historyDirectory,id));
    expect(records.sort()).toEqual(['1.json','2.json']);
    await expect(repo.getVersionPointer(id,5)).rejects.toMatchObject({code:'WORLD_REPOSITORY_VERSION_NOT_FOUND'});
    await expect(repo.getVersionPointer(id,0)).rejects.toMatchObject({code:'WORLD_REPOSITORY_VERSION_INVALID'});
  });

  it('retries cleanly if archiving completed but the latest HEAD commit was interrupted',async()=>{
    const repo=await create(),id='world_commit_retry';
    await repo.publish({id,kind:'code-project',baseVersion:null,content:code(id,'A')});
    const first=await repo.getPointer(id);
    // Simulates the state after the immutable archive link but before the atomic HEAD rename.
    await repo.archivePointer(first);
    expect((await repo.load(id)).version).toBe(1);
    const next=await repo.publish({id,kind:'code-project',baseVersion:1,content:code(id,'B')});
    expect(next.version).toBe(2);
    expect((await repo.load(id,{version:1})).content.name).toBe('城堡A');
    expect((await repo.listVersions(id)).versions.map(item=>item.version)).toEqual([2,1]);
  });

  it('rolls back v3 to v1 by publishing v4 without losing any immutable revisions, and prevents stale updates',async()=>{
    const repo=await create(),id='world_restore';
    for(const [v,label] of [[null,'A'],[1,'B'],[2,'C']]){
      await repo.publish({id,kind:'code-project',baseVersion:v,content:code(id,label)});
    }
    const before=(await repo.load(id,{version:1}));
    const saved=await repo.rollback({id,targetVersion:1,baseVersion:3});
    expect(saved).toMatchObject({version:4,restoredFromVersion:1,digest:before.digest});
    expect((await repo.load(id)).content).toEqual(code(id,'A'));
    const versions=(await repo.listVersions(id)).versions;
    expect(versions.map(v=>v.version)).toEqual([4,3,2,1]);
    expect(versions[0].restoredFromVersion).toBe(1);
    expect((await repo.load(id,{version:2})).content.name).toBe('城堡B');
    expect((await repo.load(id,{version:3})).content.name).toBe('城堡C');
    expect((await repo.load(id,{version:4})).content.name).toBe('城堡A');
    await expect(repo.rollback({id,targetVersion:2,baseVersion:3}))
      .rejects.toMatchObject({code:'WORLD_REPOSITORY_VERSION_CONFLICT'});
    await expect(repo.rollback({id,targetVersion:4,baseVersion:4}))
      .rejects.toMatchObject({code:'WORLD_REPOSITORY_ALREADY_CURRENT'});
    await expect(repo.rollback({id,targetVersion:77,baseVersion:4}))
      .rejects.toMatchObject({code:'WORLD_REPOSITORY_VERSION_NOT_FOUND'});
    await expect(repo.publish({id,kind:'code-project',baseVersion:3,content:code(id,'Z')}))
      .rejects.toMatchObject({code:'WORLD_REPOSITORY_VERSION_CONFLICT'});
    const fifth=await repo.publish({id,kind:'code-project',baseVersion:4,content:code(id,'D')});
    expect(fifth.version).toBe(5);
    expect((await repo.load(id,{version:4})).restoredFromVersion).toBe(1);
  });

  it('restores authored document and metadata while preserving every later draft version',async()=>{
    const repo=await create(),id='world_draft_history';
    await repo.publish({id,kind:'authoring-draft',baseVersion:null,content:draft(id,'A')});
    await repo.publish({id,kind:'authoring-draft',baseVersion:1,content:draft(id,'B')});
    const restored=await repo.rollback({id,targetVersion:1,baseVersion:2});
    expect(restored).toMatchObject({kind:'authoring-draft',version:3,restoredFromVersion:1,name:'草稿A'});
    expect((await repo.load(id)).content.document.root.children[0].id).toBe('node_A');
    expect((await repo.load(id,{version:2})).content.document.root.children[0].id).toBe('node_B');
  });

  it('does not change latest on a corrupt history record or corrupted historic content',async()=>{
    const repo=await create(),id='world_integrity';
    await repo.publish({id,kind:'code-project',baseVersion:null,content:code(id,'A')});
    await repo.publish({id,kind:'code-project',baseVersion:1,content:code(id,'B')});
    const entry=await repo.getVersionPointer(id,1);
    const historicFile=path.join(repo.historyDirectory,id,'1.json');
    await writeFile(historicFile,'bad-json');
    await expect(repo.rollback({id,targetVersion:1,baseVersion:2}))
      .rejects.toMatchObject({code:'WORLD_REPOSITORY_POINTER_INVALID'});
    expect((await repo.load(id)).content.name).toBe('城堡B');
    await writeFile(historicFile,JSON.stringify(entry));
    const block=path.join(repo.blocksDirectory,entry.blocks[0].hash);
    const bytes=await readFile(block);bytes[0]^=1;await writeFile(block,bytes);
    await expect(repo.rollback({id,targetVersion:1,baseVersion:2}))
      .rejects.toMatchObject({code:'WORLD_INTEGRITY_MISMATCH'});
    expect((await repo.load(id)).content.name).toBe('城堡B');
  });

  it('does not publish a new head if prior immutable history conflicts with a pending publish',async()=>{
    const repo=await create(),id='world_atomic';
    await repo.publish({id,kind:'code-project',baseVersion:null,content:code(id,'A')});
    const folder=path.join(repo.historyDirectory,id);
    await mkdir(folder);
    await writeFile(path.join(folder,'1.json'),JSON.stringify({...await repo.getPointer(id),name:'tampered'}));
    await expect(repo.publish({id,kind:'code-project',baseVersion:1,content:code(id,'B')}))
      .rejects.toMatchObject({code:'WORLD_REPOSITORY_HISTORY_CONFLICT'});
    expect((await repo.load(id)).version).toBe(1);
    expect((await repo.load(id)).content.name).toBe('城堡A');
  });

  it('serializes concurrent writers, preserving one latest version with no lost updates',async()=>{
    const repo=await create(),id='world_concurrent';
    await repo.publish({id,kind:'code-project',baseVersion:null,content:code(id,'A')});
    const competitor=new WorldRepository({directory:repo.directory});
    const result=await Promise.allSettled([
      repo.publish({id,kind:'code-project',baseVersion:1,content:code(id,'B')}),
      competitor.rollback({id,targetVersion:1,baseVersion:1})
    ]);
    expect(result.filter(item=>item.status==='fulfilled')).toHaveLength(1);
    expect((await repo.listVersions(id)).total).toBe(2);
    expect((await repo.load(id)).content.name).toBe('城堡B');
  });
});

async function serve(repository,publishToken){
  const server=createServer(async(req,res)=>{
    if(!await handleWorldRepositoryHttp(req,res,repository,{publishToken}))res.writeHead(404).end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {server,origin:'http://127.0.0.1:'+server.address().port};
}
describe('WorldRepository version history HTTP read and authenticated rollback',()=>{
  it('reads bounded history and historic content; enforces same token, origin and CAS for rollback',async()=>{
    const repo=await create(),id='world_http_history',secret='a-local-test-secret-with-at-least-20-chars';
    await repo.publish({id,kind:'code-project',baseVersion:null,content:code(id,'A')});
    await repo.publish({id,kind:'code-project',baseVersion:1,content:code(id,'B')});
    const {server,origin}=await serve(repo,secret),route=origin+'/api/studio/worlds/'+id;
    try{
      const history=await fetch(route+'/versions?offset=0&limit=1');
      expect(history.status).toBe(200);
      expect(await history.json()).toMatchObject({latestVersion:2,total:2,nextOffset:1,
        versions:[{version:2}]});
      const historic=await fetch(route+'/versions/1');
      expect(historic.status).toBe(200);
      expect((await historic.json()).content.source).toContain('/* A */');
      const rollback=(body,headers={})=>fetch(route+'/rollback',{
        method:'POST',headers:{'content-type':'application/json',...headers},
        body:JSON.stringify(body)
      });
      const body={targetVersion:1,baseVersion:2};
      expect((await rollback(body)).status).toBe(401);
      expect((await rollback(body,{authorization:'Bearer wrong'})).status).toBe(401);
      expect((await rollback(body,{authorization:'Bearer '+secret,origin:'http://attacker.invalid'})).status).toBe(403);
      expect((await rollback({targetVersion:1,baseVersion:2,content:{}},
        {authorization:'Bearer '+secret,origin})).status).toBe(400);
      const ok=await rollback(body,{authorization:'Bearer '+secret,origin});
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({version:3,restoredFromVersion:1});
      const stale=await rollback(body,{authorization:'Bearer '+secret,origin});
      expect(stale.status).toBe(409);
      expect((await stale.json()).code).toBe('WORLD_REPOSITORY_VERSION_CONFLICT');
      expect((await(await fetch(route)).json()).content.source).toContain('/* A */');
      expect((await(await fetch(route+'/versions')).json()).versions.map(item=>item.version)).toEqual([3,2,1]);
      expect((await fetch(route+'/versions/0')).status).toBe(400);
      expect((await fetch(route+'/versions?limit=-4')).status).toBe(400);
      expect((await fetch(route+'/versions?unexpected=1')).status).toBe(400);
    }finally{await new Promise(resolve=>server.close(resolve));}
  });
  it('denies rollback on read-only deployments while continuing to serve history',async()=>{
    const repo=await create(),id='world_readonly_versions';
    await repo.publish({id,kind:'code-project',baseVersion:null,content:code(id,'A')});
    const {server,origin}=await serve(repo,'');
    try{
      const route=origin+'/api/studio/worlds/'+id;
      expect((await fetch(route+'/versions')).status).toBe(200);
      const response=await fetch(route+'/rollback',{method:'POST',body:JSON.stringify({targetVersion:1,baseVersion:1})});
      expect(response.status).toBe(503);
      expect((await response.json()).code).toBe('WORLD_REPOSITORY_READ_ONLY');
    }finally{await new Promise(resolve=>server.close(resolve));}
  });
});
