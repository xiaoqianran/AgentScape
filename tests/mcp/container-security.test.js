import { it,expect } from 'vitest';
import { DockerBuildRunner,runCommand } from '../../apps/mcp-server/DockerBuildRunner.js';
import { mkdtemp,rm,cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProgrammaticAssetBuilder } from '../../application/programmatic-assets/ProgrammaticAssetBuilder.js';
import { ProgrammaticAssets } from '../../apps/mcp-server/ProgrammaticAssets.js';
import { FileAssetRepository } from '../../apps/mcp-server/FileAssetRepository.js';
import { createHeadlessGLTFLoader } from '../../apps/mcp-server/HeadlessGLTFLoader.js';
import { parseDefinition } from '../../application/programmatic-assets/ProgrammaticAssetContract.js';
import { box } from '../../apps/mcp-server/examples/procedural-assets.js';

it('rejects malformed physics, claimed verification and arbitrary resource sources before building',()=>{
 for(const definition of [
  {...box.definition,verification:{articulation:{ok:true}}},
  {...box.definition,source:{kind:'glb',url:'file:///secret'}},
  {...box.definition,physics:{body:'dynamic',mass:-1,colliders:[{shape:'box',halfExtents:[1,1,1]}]}},
  {...box.definition,physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[NaN,1,1]}]}}
 ])expect(()=>parseDefinition(definition)).toThrow();
});

it.runIf(process.env.AGENTSCAPE_SANDBOX_INTEGRATION==='1')('rejects malicious code in real restricted containers, cancels builds and keeps the service responsive',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'container-security-'));
 await cp('D:/AgentScapeData/mcp-assets/sandbox.json',path.join(root,'sandbox.json'));
 const runner=new DockerBuildRunner({configPath:path.join(root,'sandbox.json')});
 const repository=new FileAssetRepository(root),builder=new ProgrammaticAssetBuilder({runner,gltfLoader:createHeadlessGLTFLoader()});
 const service=new ProgrammaticAssets({repository,builder,runner});
 try{
  for(const expression of ['process.env','require("node:fs").readFileSync("/host/secret")','fetch("https://example.com")','new ArrayBuffer(512*1024*1024)','while(true) {}','new THREE.SphereGeometry(1,100000,100000)']){
   const source=`export function createAsset(THREE) {${expression};return new THREE.Group();}`;
   await expect(runner.run({mode:'procedural',source})).rejects.toThrow();
  }
  await expect(runner.run({mode:'procedural',source:'import fs from "node:fs";export function createAsset(THREE){return fs;}' })).rejects.toThrow();
  const job=await service.submit('alice',{source:'export function createAsset(THREE){while(true){}}',definition:box.definition,requestId:randomUUID()});
  await expect(service.cancel('bob',job.buildId)).rejects.toThrow('BUILD_NOT_FOUND');
  expect((await service.cancel('alice',job.buildId)).status).toBe('cancelled');
  expect((await runCommand('docker',['ps','--all','--filter',`label=agentscape.runner=${runner.id}`,'--format','{{.Names}}'])).stdout.trim()).toBe('');
  const requestId=randomUUID();
  const first=await service.submit('alice',{...box,requestId});
  expect((await service.submit('alice',{...box,requestId})).buildId).toBe(first.buildId);
  await expect(service.submit('alice',{...box,source:box.source+'\n// changed',requestId})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
 }finally{await service.close();await rm(root,{recursive:true,force:true});}
},90000);
