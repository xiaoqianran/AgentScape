import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toWebRequest } from '@modelcontextprotocol/node';
import { SessionManager } from './SessionManager.js';
import { registerTools } from './registerTools.js';
import { createSecurity } from './security.js';
import { FileAssetRepository } from './FileAssetRepository.js';
import { DockerBuildRunner } from './DockerBuildRunner.js';
import { ProgrammaticAssets } from './ProgrammaticAssets.js';
import { ProgrammaticAssetBuilder } from '../../application/programmatic-assets/ProgrammaticAssetBuilder.js';
import { createHeadlessGLTFLoader } from './HeadlessGLTFLoader.js';
import { installHeadlessAssetIO } from './HeadlessAssetIO.js';
export async function startServer({tokens,port=39015,root=path.resolve('.mcp-sessions'),dataRoot='D:/AgentScapeData/mcp-assets',security={},managerOptions={},buildRunner=null}={}) {
 installHeadlessAssetIO();
 const repository=new FileAssetRepository(dataRoot);
 const runner=buildRunner || new DockerBuildRunner({configPath:path.join(dataRoot,'sandbox.json')});
 const assets=new ProgrammaticAssets({repository,runner,builder:new ProgrammaticAssetBuilder({runner,gltfLoader:createHeadlessGLTFLoader()})});
 const authorize=createSecurity(tokens,security); const manager=new SessionManager({root,repository,hostOptions:{sandboxConfig:path.join(dataRoot,'sandbox.json')},...managerOptions});
 const connections=new Set();
 const http=createServer(async(req,res)=>{
  let server;
  try {
   if(req.url!=='/mcp') {res.writeHead(404).end();return;}
   const {owner,body}=await authorize(req);
   if(req.method!=='POST') {res.writeHead(405).end();return;}
   // The unified SDK handler supports modern per-request envelopes and legacy initialization.
   const handler=createMcpHandler(()=>{
    server=new McpServer({name:'AgentScape Remote MCP',version:'0.3.0'});
    registerTools(server,manager,owner,assets);
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
 return {http,manager,assets,port:http.address().port,async close(){await assets.close();await manager.dispose();await Promise.all([...connections].map(s=>s.close()));await new Promise(r=>http.close(r));}};
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
 // Deliberately do not load dotenv or the Studio configuration.
 const tokens=JSON.parse(process.env.AGENTSCAPE_MCP_TOKENS||'[]');
 const app=await startServer({tokens,dataRoot:process.env.AGENTSCAPE_MCP_DATA_ROOT || 'D:/AgentScapeData/mcp-assets'});
 console.log(`AgentScape Remote MCP: http://127.0.0.1:${app.port}/mcp`);
 for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>app.close().then(()=>process.exit(0)));
}
