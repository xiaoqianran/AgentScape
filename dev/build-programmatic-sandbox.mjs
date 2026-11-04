import { mkdtemp, mkdir, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand } from '../apps/mcp-server/DockerBuildRunner.js';
import { sandboxBundle } from '../apps/mcp-server/SandboxBundle.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const configPath=process.argv[2] || 'D:/AgentScapeData/mcp-assets/sandbox.json';
const directory=await mkdtemp(path.join(tmpdir(),'agentscape-sandbox-'));
try {
 const {code:bundle,runner,digest}=await sandboxBundle();
 await writeFile(path.join(directory,'bundle.js'),bundle);await writeFile(path.join(directory,'run.mjs'),runner);
 for(const name of ['quickjs-emscripten','quickjs-emscripten-core','@jitl'])await cp(path.join(root,'node_modules',name),path.join(directory,'node_modules',name),{recursive:true});
 const inspected=await runCommand('docker',['image','inspect','node:24-alpine'],{timeoutMs:5000});
 if(inspected.code!==0)throw Error('Provision the official node:24-alpine base image first');
 const base=JSON.parse(inspected.stdout)[0].RepoDigests.find(v=>v.startsWith('node@sha256:'));
 if(!base)throw Error('Pinned base digest unavailable');
 await writeFile(path.join(directory,'Dockerfile'),`FROM ${base}\nWORKDIR /app\nCOPY . /app/\nLABEL agentscape.sandbox.version="1" agentscape.sandbox.digest="${digest}"\nUSER 65534:65534\nENTRYPOINT ["node","/app/run.mjs"]\n`);
 const result=await runCommand('docker',['build','--network','none','--tag',`agentscape-builder:${digest.slice(0,16)}`,directory],{timeoutMs:120000,maxBytes:1048576});
 if(result.code!==0)throw Error(result.stderr);
 const image=JSON.parse((await runCommand('docker',['image','inspect',`agentscape-builder:${digest.slice(0,16)}`])).stdout)[0].Id;
 await mkdir(path.dirname(configPath),{recursive:true});await writeFile(configPath,JSON.stringify({image,digest,base},null,2));
 console.log(JSON.stringify({image,digest,configPath}));
} finally {await rm(directory,{recursive:true,force:true});}
