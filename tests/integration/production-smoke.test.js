import {it,expect} from 'vitest';
import {runProductionSmoke} from '../../dev/check-production-smoke.mjs';

const titles=new Map([
  ['/','AgentScape Home'],['/studio/','AgentScape'],['/home/','AgentScape Home'],
  ['/starter/','AgentScape · First world'],['/observatory/','AgentScape Observatory'],
  ['/examples/code-project/','自由代码世界 · AgentScape'],
  ['/examples/native-scene/','原生 Three.js · AgentScape'],
  ['/examples/three-code/','AgentScape code assets']
]);
function server({changedTitle=false,missingScript=false,missingCapability=false}={}){
  const seen=[];
  const fetchFn=async url=>{
    const pathname=new URL(url).pathname;seen.push(pathname);
    if(titles.has(pathname)){
      const title=changedTitle && pathname==='/' ? 'Old studio title' : titles.get(pathname);
      return new Response('<!doctype html><title>'+title+'</title>'+
        (missingScript&&pathname==='/' ? '' : '<script type="module" crossorigin src="/assets/test.js"></script>'),{status:200});
    }
    if(pathname==='/assets/test.js')return new Response('export default 1',{status:200});
    if(pathname==='/api/capabilities'||pathname==='/api/capabilities/health'){
      return Response.json({capabilities:{
        agent:{available:false,...(pathname.endsWith('/health')?{state:'unconfigured'}:{})},
        ...(!missingCapability?{'asset.compile':{available:false,...(pathname.endsWith('/health')?{state:'down'}:{})}}:{})
      }});
    }
    return new Response('',{status:404});
  };
  return {seen,fetchFn};
}
const silent=()=>{};

it('checks all production pages, generated assets and both capability endpoints',async()=>{
  const stub=server();
  const result=await runProductionSmoke({baseURL:'http://localhost:4178',fetchFn:stub.fetchFn,log:silent});
  expect(result).toEqual({status:'passed',pages:8,endpoints:2});
  expect(stub.seen).toContain('/api/capabilities/health');
});
it.each([
  [{changedTitle:true},'SMOKE_TITLE_MISMATCH /'],
  [{missingScript:true},'SMOKE_JS_BUNDLE_MISSING /'],
  [{missingCapability:true},'SMOKE_CAPABILITY_INVALID /api/capabilities']
])('provides actionable failure diagnostics when production has drifted',async(options,code)=>{
  const stub=server(options);
  await expect(runProductionSmoke({baseURL:'http://localhost:4178',fetchFn:stub.fetchFn,log:silent}))
    .rejects.toThrow(code);
});
