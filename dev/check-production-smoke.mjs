import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const ROUTES = Object.freeze([
  ['/', 'AgentScape'],
  ['/studio/', 'AgentScape'],
  ['/home/', 'AgentScape Home'],
  ['/starter/', 'AgentScape · First world'],
  ['/observatory/', 'AgentScape Observatory'],
  ['/examples/code-project/', '自由代码世界 · AgentScape'],
  ['/examples/native-scene/', '原生 Three.js · AgentScape'],
  ['/examples/three-code/', 'AgentScape code assets']
]);

function fail(code,path,detail) {
  return Object.assign(new Error(code+' '+path+' '+detail),{code,path});
}

async function fetchOrFail(base,path,fetchFn) {
  let last;
  for(let attempt=1;attempt<=2;attempt++){
    try {
      const response=await fetchFn(new URL(path,base),{signal:AbortSignal.timeout(12000)});
      if(!response.ok) throw fail('SMOKE_HTTP_ERROR',path,'HTTP '+response.status);
      return response;
    } catch(error) {
      last=error;
      // A content mismatch is not transient; only transport/HTTP errors get retries.
      if(attempt<3) await new Promise(resolve=>setTimeout(resolve,attempt*600));
    }
  }
  throw fail('SMOKE_FETCH_FAILED',path,last?.message || String(last));
}

/** Exact page titles and real JS files are deploy contracts; log which one failed. */
export async function runProductionSmoke({baseURL,fetchFn=fetch,log=console.log}={}) {
  if(!baseURL || !/^https?:\/\//.test(baseURL)) throw new TypeError('SMOKE_URL_REQUIRED');
  const base=new URL(baseURL);
  for(const [path,title] of ROUTES){
    log('checking page '+new URL(path,base));
    const html=await (await fetchOrFail(base,path,fetchFn)).text();
    const actual=html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? '(missing title)';
    if(actual!==title) throw fail('SMOKE_TITLE_MISMATCH',path,
      JSON.stringify({expected:title,actual}));
    const script=html.match(/<script\b[^>]*\bsrc="(\/assets\/[^"]+\.js)"[^>]*>/i)?.[1];
    if(!script) throw fail('SMOKE_JS_BUNDLE_MISSING',path,'no /assets/*.js script');
    await fetchOrFail(base,script,fetchFn);
    log('verified page '+path+' and '+script);
  }
  for(const path of ['/api/capabilities','/api/capabilities/health']){
    log('checking capability endpoint '+new URL(path,base));
    let json;
    try {json=await (await fetchOrFail(base,path,fetchFn)).json();}
    catch(error) {throw fail('SMOKE_CAPABILITY_FETCH_OR_JSON',path,error.message);}
    for(const name of ['agent','asset.compile']){
      const capability=json?.capabilities?.[name];
      if(typeof capability?.available!=='boolean')
        throw fail('SMOKE_CAPABILITY_INVALID',path,'missing '+name+'.available');
      if(path.endsWith('/health') && !['unconfigured','ok','slow','down'].includes(capability.state))
        throw fail('SMOKE_CAPABILITY_INVALID',path,'invalid '+name+'.state: '+capability.state);
    }
    log('verified capability '+path);
  }
  return {status:'passed',pages:ROUTES.length,endpoints:2};
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  runProductionSmoke({baseURL:process.env.URL})
    .then(value=>console.log('Production smoke passed:',JSON.stringify(value)))
    .catch(error=>{console.error('::error::'+error.message);process.exitCode=1;});
}
