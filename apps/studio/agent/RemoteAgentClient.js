const HOST_URL='http://127.0.0.1:8789';
const isLocal=()=>['localhost','127.0.0.1'].includes(globalThis.location?.hostname);
const fail=code=>Object.assign(new Error(code),{code});

export class RemoteAgentClient {
  constructor({fetchImpl=globalThis.fetch,onEvent=()=>{}}={}) {
    this.fetch=fetchImpl.bind(globalThis);
    this.onEvent=onEvent;
  }
  async availability() {
    if(!isLocal())return {pi:false,dsh:false};
    try {
      const response=await this.fetch(HOST_URL+'/health',{cache:'no-store'});
      if(!response.ok)return {pi:false,dsh:false};
      const data=await response.json();
      return {pi:Boolean(data.backends?.pi),dsh:Boolean(data.backends?.dsh)};
    }catch{return {pi:false,dsh:false};}
  }
  async run(prompt,{backend='pi',signal}={}) {
    if(!isLocal())throw fail('AGENT_HOST_LOCAL_ONLY');
    if(!['pi','dsh'].includes(backend))throw fail('AGENT_BACKEND_UNKNOWN');
    const runId=globalThis.crypto.randomUUID().replaceAll('-','');
    const cancel=()=>{void this.fetch(HOST_URL+'/cancel',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({runId})
    }).catch(()=>{});};
    signal?.addEventListener('abort',cancel,{once:true});
    try{
      const response=await this.fetch(HOST_URL+'/run',{
        method:'POST',headers:{'content-type':'application/json','accept':'application/x-ndjson'},
        body:JSON.stringify({runId,prompt,backend}),
        signal
      });
      if(!response.ok){const data=await response.json();throw fail(data.code||'AGENT_HOST_FAILED');}
      if(!response.body)throw fail('AGENT_HOST_STREAM_MISSING');
      const reader=response.body.getReader(),decoder=new TextDecoder();
      let pending='',result=null;
      try {
        while(true){
          const {done,value}=await reader.read();
          if(done)break;
          pending+=decoder.decode(value,{stream:true});
          const lines=pending.split('\n');pending=lines.pop();
          for(const line of lines){
            if(!line.trim())continue;
            const item=JSON.parse(line);
            if(item.type==='run.result')result=item.result;
            else if(item.type==='run.error')throw fail(item.code||'AGENT_HOST_FAILED');
            else this.onEvent(item);
          }
        }
      }finally{reader.releaseLock();}
      if(!result)throw fail('AGENT_HOST_RESULT_MISSING');
      return result;
    }catch(error){
      if(signal?.aborted)return {message:'任务已停止；请重新观察当前世界。',taskStatus:'cancelled',execution:[]};
      throw error;
    }finally{signal?.removeEventListener('abort',cancel);}
  }
}
