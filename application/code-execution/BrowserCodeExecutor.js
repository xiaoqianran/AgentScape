import { validateRemoteAuthoringDocument } from './RemoteAuthoringDocument.js';

/** Trusted browser Worker. No OS isolation; never execute source on the UI thread. */
export function createBrowserCodeExecutor({ mode='disabled', authorized=false, wallTimeoutMs=12000 } = {}) {
  if (mode === 'disabled') return null;
  if (mode !== 'trusted-local') throw new Error('BROWSER_CODE_MODE_UNSUPPORTED');
  if (authorized !== true) throw new Error('CODE_EXECUTION_AUTHORIZATION_REQUIRED');
  let closed=false;
  const active=new Set();
  const executor={
    async environment() { return {engine:'browser-trusted-worker',builderVersion:'1',threeVersion:'0.186.0'}; },
    async run(request,{signal}={}) {
      if(closed)throw new Error('AUTHORING_EXECUTOR_CLOSED');
      if(signal?.aborted)throw new Error('BUILD_CANCELLED');
      return new Promise((resolve,reject)=>{
        const worker=new Worker(new URL('./BrowserCodeWorker.js',import.meta.url),{type:'module'});
        let done=false;
        const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);worker.terminate();active.delete(cancel);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
        const abort=()=>finish(new Error('BUILD_CANCELLED'));
        const cancel=()=>finish(new Error('AUTHORING_EXECUTOR_CLOSED'));
        const timer=setTimeout(()=>finish(new Error('AUTHORING_CODE_TIMEOUT')),wallTimeoutMs);
        active.add(cancel);signal?.addEventListener('abort',abort,{once:true});
        worker.onmessage=async({data})=>{
          try { if(data.error)throw new Error(data.error);finish(null,{document:validateRemoteAuthoringDocument(data.document),environment:await executor.environment(),security:{osIsolation:false,trusted:true}}); }
          catch(error){finish(error);}
        };
        worker.onerror=()=>finish(new Error('AUTHORING_SANDBOX_FAILED'));
        worker.postMessage(request);
      });
    },
    async execute(request,options){return(await executor.run({...request,mode:'authoring'},options)).document;},
    close(){closed=true;for(const cancel of active)cancel();}
  };
  return executor;
}
