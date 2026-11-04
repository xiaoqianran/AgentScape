import { Worker } from 'node:worker_threads';
import { validateRemoteAuthoringDocument } from './RemoteAuthoringDocument.js';
import { sandboxBundle } from './SandboxBundle.js';
export function createIsolatedAuthoringExecutor({ timeoutMs=1500, memoryBytes=96*1024*1024, wallTimeoutMs=12000 }={}) {
 const active=new Set(); let disposed=false;
 return {
  async execute({code,document}) {
   if (disposed) throw new Error('AUTHORING_EXECUTOR_CLOSED');
   if (typeof code!=='string' || code.length>32768) throw new Error('AUTHORING_CODE_LIMIT');
   validateRemoteAuthoringDocument(document);
   const bundle=(await sandboxBundle()).code;
   if (disposed) throw new Error('AUTHORING_EXECUTOR_CLOSED');
   return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./AuthoringSandboxWorker.mjs',import.meta.url),{workerData:{bundle,code,document,timeoutMs,memoryBytes},resourceLimits:{maxOldGenerationSizeMb:128},execArgv:[]});
    let finished=false;
    const finish=(error,value)=>{
     if (finished) return; finished=true; clearTimeout(timer); active.delete(worker); void worker.terminate();
     if(error) reject(error); else resolve(value);
    };
    const timer=setTimeout(()=>finish(new Error('AUTHORING_CODE_TIMEOUT')),wallTimeoutMs);
    active.add(worker);
    worker.once('message',message=>{
     if(message.error) return finish(new Error(message.error));
     try { finish(null,validateRemoteAuthoringDocument(JSON.parse(message.json))); }
     catch(error) { finish(error); }
    });
    worker.once('error',()=>finish(new Error('AUTHORING_SANDBOX_FAILED')));
    worker.once('exit',()=>finish(new Error('AUTHORING_SANDBOX_STOPPED')));
   });
  },
  close() { disposed=true; for(const worker of active) void worker.terminate(); active.clear(); }
 };
}
