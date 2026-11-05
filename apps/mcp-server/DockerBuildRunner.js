import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { validateRemoteAuthoringDocument } from './RemoteAuthoringDocument.js';
import { pipelineDigest } from './BuildEnvironment.js';
import { sandboxBundle } from './SandboxBundle.js';

export function runCommand(command,args,{input='',timeoutMs=15000,maxBytes=4194304,signal}={}) {
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
  const output=[],errors=[];let size=0,problem;
  const stop=code=>{problem ||= new Error(code);child.kill();};
  const timer=setTimeout(()=>stop('BUILD_TIMEOUT'),timeoutMs);
  const abort=()=>stop('BUILD_CANCELLED');signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>maxBytes)stop('BUILD_OUTPUT_LIMIT');else output.push(chunk);});
  child.stderr.on('data',chunk=>{if(errors.reduce((n,b)=>n+b.length,0)<4096)errors.push(chunk);});
  child.on('error',()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(new Error('SANDBOX_UNAVAILABLE'));});
  child.on('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(problem)reject(problem);else resolve({code,stdout:Buffer.concat(output).toString('utf8'),stderr:Buffer.concat(errors).toString('utf8')});});
  child.stdin.on('error',()=>{});child.stdin.end(input);
 });
}

export class DockerBuildRunner {
 constructor({configPath,command='docker',timeoutMs=15000}={}) {Object.assign(this,{configPath,command,timeoutMs});this.controllers=new Set();this.id=randomUUID();}
 async environment() {
  try {
   const config=JSON.parse(await readFile(this.configPath,'utf8'));
   if(config.digest!==(await sandboxBundle()).digest)throw Error();
   if(!/^sha256:[a-f0-9]{64}$/.test(config.image))throw Error();
   const image=await runCommand(this.command,['image','inspect',config.image],{timeoutMs:5000});
   if(image.code!==0)throw Error();
   const metadata=JSON.parse(image.stdout)[0];
   if(metadata.Os!=='linux'||metadata.Config?.Labels?.['agentscape.sandbox.version']!=='1'||metadata.Config?.Labels?.['agentscape.sandbox.digest']!==config.digest)throw Error();
   return {...config,engine:'docker-linux',builderVersion:'1',threeVersion:'0.186.0',pipelineDigest:await pipelineDigest()};
  }catch{throw new Error('SANDBOX_UNAVAILABLE');}
 }
 async run(request,{signal}={}) {
  const environment=await this.environment();
  const controller=new AbortController();this.controllers.add(controller);
  const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const name=`agentscape-build-${randomUUID()}`;
  let container=name;
  try {
   const created=await runCommand(this.command,['create','--name',name,'--label',`agentscape.runner=${this.id}`,'--interactive','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--memory','256m','--memory-swap','256m','--cpus','1','--user','65534:65534','--tmpfs','/tmp:rw,noexec,nosuid,size=16m','--init','--pull','never',environment.image],{timeoutMs:5000,signal:controller.signal});
   if(created.code!==0)throw new Error('SANDBOX_UNAVAILABLE');
   container=created.stdout.trim();if(!/^[a-f0-9]{64}$/.test(container))throw new Error('SANDBOX_UNAVAILABLE');
   const inspected=await runCommand(this.command,['inspect',container],{timeoutMs:5000});
   const info=JSON.parse(inspected.stdout)[0],h=info.HostConfig;
   if(info.Image!==environment.image||info.Config.User!=='65534:65534'||!h.ReadonlyRootfs||h.NetworkMode!=='none'||h.Privileged||h.PidsLimit!==64||h.Memory!==268435456||h.MemorySwap!==268435456||h.NanoCpus!==1e9||!h.CapDrop.includes('ALL')||!h.SecurityOpt.some(s=>s.startsWith('no-new-privileges'))||info.Mounts.some(m=>m.Type!=='tmpfs'))throw new Error('SANDBOX_POLICY_MISMATCH');
   const result=await runCommand(this.command,['start','--attach','--interactive',container],{input:JSON.stringify(request),timeoutMs:this.timeoutMs,signal:controller.signal});
   let data;try{data=JSON.parse(result.stdout);}catch{throw new Error(result.code===137?'BUILD_MEMORY_LIMIT':'BUILD_EXECUTION_FAILED');}
   if(result.code!==0||data.error)throw new Error(/^[A-Z_]+$/.test(data.error||'')?data.error:'BUILD_EXECUTION_FAILED');
   return {document:validateRemoteAuthoringDocument(data.document),environment,security:{network:'none',readOnly:true,user:'65534:65534',memoryBytes:h.Memory,pids:h.PidsLimit,cpus:1,noNewPrivileges:true,capabilities:[],mounts:[]}};
  } finally {
   signal?.removeEventListener('abort',abort);this.controllers.delete(controller);
   const cleaned=await runCommand(this.command,['rm','--force',container],{timeoutMs:5000}).catch(()=>null);
   if(!cleaned||cleaned.code!==0){
    const remaining=await runCommand(this.command,['inspect',container],{timeoutMs:5000}).catch(()=>null);
    if(!remaining||remaining.code===0||!remaining.stderr.includes('No such'))throw new Error('SANDBOX_CLEANUP_FAILED');
   }
  }
 }
 async execute(request) {return (await this.run({mode:'authoring',...request})).document;}
 close() {for(const controller of this.controllers)controller.abort();this.controllers.clear();}
}
