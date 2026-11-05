import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toWebRequest } from '@modelcontextprotocol/node';
import { SessionManager } from './SessionManager.js';
import { StudioLiveBridge } from './StudioLiveBridge.js';
import { handleStudioBridgeHttp } from './StudioBridgeHttp.js';
import { registerTools } from './registerTools.js';
import { createSecurity } from './security.js';
import { FileAssetRepository } from './FileAssetRepository.js';
import { createCodeExecutor } from './CodeExecutor.js';
import { ProgrammaticAssets } from './ProgrammaticAssets.js';
import { ProgrammaticAssetBuilder } from '../../application/programmatic-assets/ProgrammaticAssetBuilder.js';
import { createHeadlessGLTFLoader } from './HeadlessGLTFLoader.js';
import { installHeadlessAssetIO } from './HeadlessAssetIO.js';
export async function startServer({tokens,port=39015,root=path.resolve('.mcp-sessions'),dataRoot=path.resolve('.mcp-assets'),security={},managerOptions={},buildRunner=null,studioOrigins,codeExecution={mode:'worker-wasm'}}={}) {
 installHeadlessAssetIO();
 const repository=new FileAssetRepository(dataRoot);
 const runner=buildRunner || createCodeExecutor({...codeExecution,configPath:path.join(dataRoot,'sandbox.json')});
 const assets=new ProgrammaticAssets({repository,runner,builder:new ProgrammaticAssetBuilder({runner,gltfLoader:createHeadlessGLTFLoader()})});
 const authorize=createSecurity(tokens,security); const manager=new SessionManager({root,repository,hostOptions:{codeExecution,sandboxConfig:path.join(dataRoot,'sandbox.json')},...managerOptions});
 const studioBridge=new StudioLiveBridge();
 const connections=new Set();
 const http=createServer(async(req,res)=>{
  let server;
  try {
   if(await handleStudioBridgeHttp(req,res,studioBridge,{...(studioOrigins?{origins:studioOrigins}:{})}))return;
   if(req.url!=='/mcp') {res.writeHead(404).end();return;}
   const {owner,body}=await authorize(req);
   if(req.method!=='POST') {res.writeHead(405).end();return;}
   // The unified SDK handler supports modern per-request envelopes and legacy initialization.
   const handler=createMcpHandler(()=>{
    server=new McpServer({name:'AgentScape Remote MCP',version:'0.3.0'});
    registerTools(server,manager,owner,assets,studioBridge);
    connections.add(server);
    return server;
   });
   res.on('close',()=>{connections.delete(server);handler.close().catch(()=>{});});
   const response=await handler.fetch(await toWebRequest(req,body));
   res.writeHead(response.status,Object.fromEntries(response.headers));
   res.end(Buffer.from(await response.arrayBuffer()));
  } catch(e) {if(!res.headersSent) res.writeHead(e.status||500).end(JSON.stringify({error:e.status?'HTTP_REQUEST_REJECTED':'INTERNAL_ERROR'}));}
 });
 http.requestTimeout=35000; http.headersTimeout=10000;
 try {await new Promise((resolve,reject)=>{http.once('error',reject);http.listen(port,'127.0.0.1',resolve);});}
 catch(e){await manager.dispose();throw e;}
 return {http,manager,assets,studioBridge,port:http.address().port,async close(){studioBridge.dispose();await assets.close();await manager.dispose();await Promise.all([...connections].map(s=>s.close()));await new Promise(r=>http.close(r));}};
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
 // Deliberately do not load dotenv or the Studio configuration.
 const tokens=JSON.parse(process.env.AGENTSCAPE_MCP_TOKENS||'[]');
 const app=await startServer({tokens,dataRoot:process.env.AGENTSCAPE_MCP_DATA_ROOT || path.resolve('.mcp-assets'),codeExecution:{mode:process.env.AGENTSCAPE_CODE_EXECUTION || 'worker-wasm',authorized:process.env.AGENTSCAPE_TRUSTED_CODE==='1',remote:process.env.AGENTSCAPE_PUBLIC_SERVICE==='1'}});
 console.log(`AgentScape Remote MCP: http://127.0.0.1:${app.port}/mcp`);
 for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>app.close().then(()=>process.exit(0)));
}
