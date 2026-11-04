import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp,rm,cp,readFile,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DockerBuildRunner } from '../../apps/mcp-server/DockerBuildRunner.js';
import { ProgrammaticAssetBuilder } from '../../application/programmatic-assets/ProgrammaticAssetBuilder.js';
import { ProgrammaticAssets } from '../../apps/mcp-server/ProgrammaticAssets.js';
import { FileAssetRepository } from '../../apps/mcp-server/FileAssetRepository.js';
import { createHeadlessGLTFLoader } from '../../apps/mcp-server/HeadlessGLTFLoader.js';
import { installHeadlessAssetIO } from '../../apps/mcp-server/HeadlessAssetIO.js';
import { box } from '../../apps/mcp-server/examples/procedural-assets.js';

const {source,definition}=box;

it('fails closed when an OS sandbox is unavailable',async()=>{
 const runner=new DockerBuildRunner({configPath:path.join(tmpdir(),`missing-${randomUUID()}.json`)});
 await expect(runner.run({mode:'procedural',source})).rejects.toThrow('SANDBOX_UNAVAILABLE');
});

it('does not publish a snapshot whose storage envelope would exceed the readable limit',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'world-envelope-'));
 const repository=new FileAssetRepository(root);
 try{
  await expect(repository.saveWorld('alice',{objects:[],padding:'x'.repeat(4194200)})).rejects.toThrow('EXPORT_LIMIT');
  expect(await repository.ids('alice','worlds')).toEqual([]);
 }finally{await rm(root,{recursive:true,force:true});}
});

it.runIf(process.env.AGENTSCAPE_SANDBOX_INTEGRATION==='1')('builds, publishes, reopens and verifies a real container-built immutable asset',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'procedural-assets-'));
 await cp('D:/AgentScapeData/mcp-assets/sandbox.json',path.join(root,'sandbox.json'));
 installHeadlessAssetIO();
 const runner=new DockerBuildRunner({configPath:path.join(root,'sandbox.json')});
 const repository=new FileAssetRepository(root);
 const service=new ProgrammaticAssets({repository,runner,builder:new ProgrammaticAssetBuilder({runner,gltfLoader:createHeadlessGLTFLoader()})});
 try{
  const job=await service.submit('alice',{source,definition,requestId:randomUUID()});
  const pending=service.running.get(job.buildId);if(pending)await pending.promise;
  const status=await service.status('alice',job.buildId);
  expect(status.status,JSON.stringify(status)).toBe('succeeded');
  const published=await service.publish('alice',job.buildId);
  expect(published.admission.status).toBe('ready');
  const saved=await new FileAssetRepository(root).get('alice',published.assetId,{published:true});
  expect(saved.source).toBe(source);expect(saved.build.security.network).toBe('none');
  await expect(repository.get('bob',published.assetId)).rejects.toThrow();
  const second=await service.submit('alice',{source,definition,requestId:randomUUID(),forceRebuild:true});
  await service.running.get(second.buildId)?.promise;
  expect(await service.status('alice',second.buildId)).toMatchObject({status:'succeeded',assetId:published.assetId});
  const file=path.join(repository.target('alice','assets',published.assetId),'asset.glb');
  const bytes=await readFile(file);await writeFile(file,Buffer.concat([bytes,Buffer.from('tampered')]));
  await expect(repository.get('alice',published.assetId)).rejects.toThrow('STORAGE_INTEGRITY_FAILED');
 }finally{await service.close();await rm(root,{recursive:true,force:true});}
},60000);
