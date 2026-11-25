import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toWebRequest } from '@modelcontextprotocol/node';
import { SessionManager } from './SessionManager.js';
import { StudioLiveBridge } from './StudioLiveBridge.js';
import { handleStudioBridgeHttp } from './StudioBridgeHttp.js';
import { registerTools } from './registerTools.js';
import { handleRestrictedAgentMcp } from './AgentMcpCompat.js';
import { TransferStore } from './TransferStore.js';
import { handleTransferHttp } from './TransferHttp.js';
import { MCP_MESSAGE_BYTES } from './TransferLimits.js';
import { createSecurity } from './security.js';
import { FileAssetRepository } from './FileAssetRepository.js';
import { createCodeExecutor } from './CodeExecutor.js';
import { ProgrammaticAssets } from './ProgrammaticAssets.js';
import { ProgrammaticAssetBuilder } from '../../application/programmatic-assets/ProgrammaticAssetBuilder.js';
import { createHeadlessGLTFLoader } from './HeadlessGLTFLoader.js';
import { installHeadlessAssetIO } from './HeadlessAssetIO.js';
export async function startServer({tokens,port=39015,root=path.resolve('.mcp-sessions'),dataRoot=path.resolve('.mcp-assets'),security={},transferOptions={},managerOptions={},buildRunner=null,studioOrigins,codeExecution={mode:'worker-wasm'}}={}) {
 installHeadlessAssetIO();
 const repository=new FileAssetRepository(dataRoot);
 const runner=buildRunner || createCodeExecutor({...codeExecution,configPath:path.join(dataRoot,'sandbox.json')});
 const assets=new ProgrammaticAssets({repository,runner,builder:new ProgrammaticAssetBuilder({runner,gltfLoader:createHeadlessGLTFLoader()})});
 const authorize=createSecurity(tokens,security);
 const transfers=await new TransferStore(root,transferOptions).initialize();
 const manager=new SessionManager({root,repository,hostOptions:{codeExecution,sandboxConfig:path.join(dataRoot,'sandbox.json')},...managerOptions});
 manager.transfers=transfers;
 const studioBridge=new StudioLiveBridge();
 const responseLimit=security.maxBody ?? MCP_MESSAGE_BYTES;
 const connections=new Set();let closing=false;
 const http=createServer(async(req,res)=>{
  let server;
  try {
   if(closing){res.writeHead(503,{Connection:"close"}).end();return;}
   if(await handleStudioBridgeHttp(req,res,studioBridge,{...(studioOrigins?{origins:studioOrigins}:{})}))return;
   if(await handleTransferHttp(req,res,authorize,transfers))return;
   if(req.url!=='/mcp' && req.url!=='/agent-mcp') {res.writeHead(404).end();return;}
   const {owner,body}=await authorize(req);
   if(req.url==='/agent-mcp'){
     if(req.method!=='POST'){res.writeHead(405).end();return;}
     const answer=await handleRestrictedAgentMcp({body,owner,manager,assets,studioBridge,scope:req.headers['x-agentscape-project']});
     if(answer.body===null){res.writeHead(answer.status).end();return;}
     const payload=JSON.stringify(answer.body);
     if(Buffer.byteLength(payload)>responseLimit)throw Object.assign(new Error('RESPONSE_LIMIT'),{status:413});
     res.writeHead(answer.status,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(payload)}).end(payload);
     return;
   }
   if(req.method!=='POST') {res.writeHead(405).end();return;}
   // The unified SDK handler supports modern per-request envelopes and legacy initialization.
   const handler=createMcpHandler(()=>{
    server=new McpServer({name:'AgentScape Remote MCP',version:'0.3.0'});
    registerTools(server,manager,owner,assets,studioBridge,{agentOnly:req.url==='/agent-mcp'});
    connections.add(server);
    return server;
   });
   res.on('close',()=>{connections.delete(server);handler.close().catch(()=>{});});
   const response=await handler.fetch(await toWebRequest(req,body),{parsedBody:body});
   const payload=Buffer.from(await response.arrayBuffer());
   if(payload.length>responseLimit)throw Object.assign(new Error('RESPONSE_LIMIT'),{status:413});
   res.writeHead(response.status,Object.fromEntries(response.headers));
   res.end(payload);
  } catch(e) {
   if(!res.headersSent){
    const headers=e.status===429&&Number.isSafeInteger(e.retryAfter)?{'Retry-After':String(e.retryAfter)}:{};
    res.writeHead(e.status||500,headers).end(JSON.stringify({error:e.status?'HTTP_REQUEST_REJECTED':'INTERNAL_ERROR'}));
   }
  }
 });
 http.requestTimeout=120000; http.headersTimeout=10000;
 try {await new Promise((resolve,reject)=>{http.once('error',reject);http.listen(port,'127.0.0.1',resolve);});}
 catch(e){await manager.dispose();await transfers.close();throw e;}
 return {http,manager,assets,studioBridge,transfers,port:http.address().port,async close(){closing=true;studioBridge.dispose();await assets.close();await manager.dispose();await Promise.all([...connections].map(s=>s.close()));await new Promise(r=>http.close(r));await transfers.close();}};
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
 // Deliberately do not load dotenv or the Studio configuration.
 const tokens=JSON.parse(process.env.AGENTSCAPE_MCP_TOKENS||'[]');
 const app=await startServer({tokens,dataRoot:process.env.AGENTSCAPE_MCP_DATA_ROOT || path.resolve('.mcp-assets'),codeExecution:{mode:process.env.AGENTSCAPE_CODE_EXECUTION || 'worker-wasm',authorized:process.env.AGENTSCAPE_TRUSTED_CODE==='1',remote:process.env.AGENTSCAPE_PUBLIC_SERVICE==='1'}});
 console.log(`AgentScape Remote MCP: http://127.0.0.1:${app.port}/mcp`);
 for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>app.close().then(()=>process.exit(0)));
}
