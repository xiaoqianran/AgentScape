import http from 'node:http';
import { createHash } from 'node:crypto';
import { connectStudioMcp } from './McpWorldTools.js';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { runPiAgent } from './PiAgentBackend.js';
import { runDshAgent } from './DshAgentBackend.js';
import { finalizeRun } from './AgentRunFinalizer.js';
import { reviewStudioVisual, iterateVisualProject } from './VisualReview.js';
// The TaskSpec compiler is loaded only for explicitly requested strict acceptance.
const compileTaskSpecWithModel = async (prompt,options) =>
  (await import('./TaskCompiler.js')).compileTaskSpecWithModel(prompt,options);

export function loadPrivateEnv(file) {
  if(!existsSync(file))return;
  for(const entry of readFileSync(file,'utf8').split(/\r?\n/)) {
    const text=entry.trim(),cut=text.indexOf('=');
    if(!text || text.startsWith('#') || cut<=0)continue;
    const key=text.slice(0,cut).trim();
    if(!/^[A-Z][A-Z0-9_]*$/.test(key) || process.env[key]!==undefined)continue;
    let value=text.slice(cut+1).trim();
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))
      value=value.slice(1,-1);
    process.env[key]=value;
  }
}
const DEFAULT_ORIGINS=new Set([
  'http://localhost:5173','http://127.0.0.1:5173',
  'http://localhost:4173','http://127.0.0.1:4173',
  'http://localhost:4178','http://127.0.0.1:4178'
]);
const errorCode=err=>/^[A-Z_]{3,80}$/.test(err?.code||'')?err.code:'AGENT_RUN_FAILED';
export const getConfig=env=>({
  baseUrl:env.AGENTSCAPE_LLM_BASE_URL||env.AGENTSCAPE_TEST_LLM_BASE_URL,
  apiKey:env.AGENTSCAPE_LLM_API_KEY||env.AGENTSCAPE_TEST_LLM_API_KEY,
  modelId:env.AGENTSCAPE_LLM_MODEL||env.AGENTSCAPE_TEST_LLM_MODEL,
  taskCompilerTimeoutMs:env.AGENTSCAPE_TASK_COMPILER_TIMEOUT_MS,
  taskCompilerModelId:env.AGENTSCAPE_TASK_COMPILER_MODEL,
  taskCompilerDisableThinking:env.AGENTSCAPE_TASK_COMPILER_DISABLE_THINKING,
  taskAcceptanceMode:env.AGENTSCAPE_TASK_ACCEPTANCE_MODE || 'world',
  visualReviewMode:env.AGENTSCAPE_VISUAL_REVIEW_MODE || 'auto',
  visualModelId:env.AGENTSCAPE_VISUAL_MODEL || env.AGENTSCAPE_LLM_MODEL || env.AGENTSCAPE_TEST_LLM_MODEL,
  visualTimeoutMs:env.AGENTSCAPE_VISUAL_TIMEOUT_MS,
  visualMaxRevisions:env.AGENTSCAPE_VISUAL_MAX_REVISIONS==null ? 2 : Number(env.AGENTSCAPE_VISUAL_MAX_REVISIONS),
  mcpUrl:env.AGENTSCAPE_MCP_URL||'http://127.0.0.1:39015/agent-mcp',
  mcpToken:env.AGENTSCAPE_MCP_TOKEN,
  dshPatch:env.AGENTSCAPE_DSH_RESTRICTED==='1'?fileURLToPath(new URL('./dsh-restricted.patch.yml', import.meta.url)):null,
  dshProvider:env.AGENTSCAPE_DSH_PROVIDER||'agentscape-newapi',
  dshModel:env.AGENTSCAPE_DSH_MODEL||env.AGENTSCAPE_LLM_MODEL||env.AGENTSCAPE_TEST_LLM_MODEL,
  dshHome:env.AGENTSCAPE_DSH_HOME||path.resolve('.agent-host/dsh'),
  dshPatches:env.AGENTSCAPE_DSH_RESTRICTED==='1'?[
    fileURLToPath(new URL('./dsh-restricted.patch.yml',import.meta.url)),
    ...((env.AGENTSCAPE_DSH_PROVIDER||'agentscape-newapi')==='agentscape-newapi' ? [fileURLToPath(new URL('./dsh-newapi.patch.yml',import.meta.url))] : [])
  ]:[]
});
const readiness=c=>({
  pi:Boolean(c.baseUrl&&c.apiKey&&c.modelId&&c.mcpToken),
  dsh:Boolean(c.dshPatch&&c.dshProvider&&c.dshModel&&c.mcpToken)
});
async function readJson(req){
  const parts=[];let size=0;
  for await(const chunk of req){
    size+=chunk.length;
    if(size>256*1024)throw Object.assign(new Error('BODY_TOO_LARGE'),{code:'BODY_TOO_LARGE'});
    parts.push(chunk);
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
export function isNewWorldRequest(prompt) {
  const command = prompt.trim().replace(/^(?:(?:请(?:你)?|帮我|给我|能否|可以|你能)\s*)+/, '');
  return /^(?:创建|新建|生成|搭建|建造|构建|打造|做)(?![^，。！？\n]{0,80}(?:当前|这个|原有|现有)世界)[^，。！？\n]{0,80}世界(?![地图观里中内])/u.test(command)
    || /^(?:please\s+)?(?:create|build|generate|make)\s+(?:me\s+)?(?:a\s+|an\s+)?(?:new\s+)?(?:[\w-]+\s+){0,5}world\b(?!\s+(?:map|view|building)\b)/i.test(command)
      && !/^(?:please\s+)?(?:create|build|generate|make)\b[^.!?]*\b(?:in|inside|within)\s+(?:this|the current|the existing)\s+world\b/i.test(command);
}

async function prepareWorld(config, runId, signal) {
  const id = 'world_' + createHash('sha256').update(runId).digest('hex').slice(0,32);
  const connection = await connectStudioMcp({url:config.mcpUrl,token:config.mcpToken,signal});
  try {
    const tool = connection.tools.find(tool=>tool.name==='studio_project');
    const result = await tool.execute(runId,{operation:'create_world',id},signal);
    const project = JSON.parse(result.content[0].text);
    if(project.id!==id)throw new Error('TASK_PROJECT_CREATE_FAILED');
    return {...project,worldSessionId:connection.worldSessionId};
  } finally { await connection.close(); }
}

async function attachWorldSession(config,signal) {
  const connection=await connectStudioMcp({url:config.mcpUrl,token:config.mcpToken,signal});
  try { return connection.worldSessionId; }
  finally { await connection.close(); }
}

export function createAgentHost({config=getConfig(process.env),host='127.0.0.1',port=8789,
  origins=DEFAULT_ORIGINS,prepareProject=prepareWorld,backends={pi:runPiAgent,dsh:runDshAgent},
  finalize=finalizeRun,reviewVisual=reviewStudioVisual,
  attachSession=attachWorldSession,compileTask=compileTaskSpecWithModel}={}) {
  if(host!=='127.0.0.1')throw new Error('AGENT_HOST_LOOPBACK_REQUIRED');
  const acceptanceMode=config.taskAcceptanceMode || 'world';
  if(!['world','strict'].includes(acceptanceMode))throw new Error('TASK_ACCEPTANCE_MODE_INVALID');
  const visualMode=config.visualReviewMode || 'auto';
  if(!['auto','on','off'].includes(visualMode))throw new Error('VISUAL_REVIEW_MODE_INVALID');
  const visualMaxRevisions=config.visualMaxRevisions ?? 2;
  if(!Number.isSafeInteger(visualMaxRevisions)||visualMaxRevisions<0||visualMaxRevisions>3)
    throw new Error('VISUAL_MAX_REVISIONS_INVALID');
  const runs=new Map(), enabled=readiness(config);
  const respond=(res,status,payload,origin)=>{
    const body=JSON.stringify(payload);
    res.writeHead(status,{'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store','content-length':Buffer.byteLength(body),
      ...(origin?{'access-control-allow-origin':origin,'vary':'Origin'}:{})});
    res.end(body);
  };
  const server=http.createServer(async(req,res)=>{
    const origin=req.headers.origin;
    if(!origin||!origins.has(origin))return respond(res,403,{code:'AGENT_HOST_ORIGIN_FORBIDDEN'});
    if(req.method==='OPTIONS'){
      res.writeHead(204,{'access-control-allow-origin':origin,'access-control-allow-methods':'GET, POST, OPTIONS',
        'access-control-allow-headers':'content-type','vary':'Origin'}).end();return;
    }
    const url=new URL(req.url||'/', 'http://127.0.0.1');
    if(url.pathname==='/health'&&req.method==='GET')return respond(res,200,{status:'ready',backends:enabled},origin);
    if(req.method!=='POST'||!['/run','/cancel'].includes(url.pathname))
      return respond(res,404,{code:'UNKNOWN_AGENT_ENDPOINT'},origin);
    let input;
    try{input=await readJson(req);}catch(error){return respond(res,400,{code:errorCode(error)},origin);}
    if(!input || !/^[a-zA-Z0-9_-]{10,80}$/.test(input.runId||''))
      return respond(res,400,{code:'INVALID_RUN_ID'},origin);
    if(url.pathname==='/cancel'){
      const entry=runs.get(input.runId);
      if(!entry)return respond(res,404,{code:'RUN_NOT_FOUND'},origin);
      entry.controller.abort();
      return respond(res,200,{status:'cancellation-requested'},origin);
    }
    if(!['pi','dsh'].includes(input.backend)||typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>12000)
      return respond(res,400,{code:'INVALID_AGENT_REQUEST'},origin);
    if(!enabled[input.backend])return respond(res,503,{code:'AGENT_BACKEND_UNCONFIGURED'},origin);
    if(runs.size||runs.has(input.runId))return respond(res,409,{code:'AGENT_WORLD_BUSY'},origin);
    const controller=new AbortController();
    const events=[];
    const streaming=String(req.headers.accept||'').includes('application/x-ndjson');
    if(streaming)res.writeHead(200,{'content-type':'application/x-ndjson; charset=utf-8',
      'cache-control':'no-store','access-control-allow-origin':origin,'vary':'Origin'});
    const stream=event=>{if(streaming&&!res.writableEnded)res.write(JSON.stringify(event)+'\n');};
    runs.set(input.runId,{controller});
    try{
      const emit=event=>{if(events.length<250)events.push(event);stream(event);};
      // World-first mode runs the original request without rewriting it into a fixed ontology.
      const taskSpec=acceptanceMode==='strict'
        ? await compileTask(input.prompt,{configuration:config,signal:controller.signal}) : null;
      const project=isNewWorldRequest(input.prompt) ? await prepareProject(config,input.runId,controller.signal) : null;
      const projectScope=project ? project.worldSessionId+'/'+project.id : undefined;
      // DSH SDK connects to MCP independently. Pin the authoritative Studio before it runs.
      const expectedWorldSessionId=project?.worldSessionId ||
        (input.backend==='dsh' ? await attachSession(config,controller.signal) : undefined);
      if(project)emit({type:'project.created',projectId:project.id,revision:project.revision});
      const prompt=project ? [
        'The Host has prepared a dedicated draft for this task. Use studio_project read to obtain the starter and guide.',
        'Write the complete scene source via studio_project write with the current expectedRevision; use that same project.',
        acceptanceMode==='strict'
          ? 'Use the starter and Runtime interfaces. Register the required entities, run the revision, save and verify all user-derived criteria via scene_verify.'
          : 'Use the starter and native Three.js APIs freely to implement the requested world. Semantic entity/action registration is optional; use it only if interaction is needed. Run the revision, save, and check observable state with scene_verify. Do not substitute a fixed object vocabulary for the user request.',
        'User request:',input.prompt
      ].join('\n') : input.prompt;
      const fullPrompt=taskSpec?.status==='ready' ? [
        prompt,'User-derived task requirements (do not weaken; use these exact entity IDs):',
        JSON.stringify(taskSpec.requiredChecks),
        'The Host will independently verify these criteria. A tool result is not task completion.'
      ].join('\n') : prompt;
      const shouldReview=visualMode==='on'||(visualMode==='auto'&&Boolean(project));
      const runBackend=prompt=>backends[input.backend]({prompt,projectScope,configuration:config,signal:controller.signal,emit});
      const verify=backendOutput=>finalize({output:{...backendOutput,backend:input.backend},project,
        configuration:config,signal:controller.signal,expectedWorldSessionId,taskSpec,
        deferVisualReview:shouldReview});
      let output=await verify(await runBackend(fullPrompt));
      if(shouldReview && output.taskStatus==='completed') {
        output=await iterateVisualProject({prompt:input.prompt,initial:output,
          review:()=>reviewVisual({prompt:input.prompt,project,configuration:config,signal:controller.signal}),
          revise:({prompt})=>runBackend(prompt),verify,maxRevisions:visualMaxRevisions,
          signal:controller.signal,emit});
      }
      emit({type:'run.finished',backend:input.backend,taskStatus:output.taskStatus,verified:output.verified});
      if(streaming){stream({type:'run.result',result:{...output,runId:input.runId}});res.end();return;}
      return respond(res,200,{...output,runId:input.runId,events},origin);
    }catch(error){
      if(controller.signal.aborted){
        const finished={type:'run.finished',backend:input.backend,taskStatus:'cancelled',verified:false};
        events.push(finished);stream(finished);
        const cancelled={schema:'agentscape.agent-run',schemaVersion:1,backend:input.backend,
          taskStatus:'cancelled',verified:false,steps:0,execution:[],
          verification:{status:'unverified',reason:'RUN_CANCELLED',checks:[]}};
        if(streaming){stream({type:'run.result',result:{...cancelled,runId:input.runId}});res.end();return;}
        return respond(res,200,{...cancelled,runId:input.runId,events},origin);
      }
      if(streaming){stream({type:'run.error',code:errorCode(error)});res.end();return;}
      return respond(res,500,{code:errorCode(error),message:errorCode(error),runId:input.runId,
        events:events.slice(-40)},origin);
    }finally{runs.delete(input.runId);}
  });
  return {server,config,enabled,listen:()=>new Promise((resolve,reject)=>{
    server.once('error',reject);server.listen(port,host,()=>resolve(server.address()));
  }),close:async()=>{
    for(const entry of runs.values())entry.controller.abort();
    await new Promise(resolve=>server.close(resolve));
  }};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  loadPrivateEnv('.env.local');
  if(!process.env.AGENTSCAPE_LLM_API_KEY && process.env.AGENTSCAPE_TEST_LLM_API_KEY)
    process.env.AGENTSCAPE_LLM_API_KEY=process.env.AGENTSCAPE_TEST_LLM_API_KEY;
  const app=createAgentHost();
  await app.listen();
  console.log('AgentScape Agent Host listening on http://127.0.0.1:8789 (Pi / DSH)');
  for(const event of ['SIGINT','SIGTERM'])process.once(event,()=>app.close().then(()=>process.exit(0)));
}
