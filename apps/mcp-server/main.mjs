import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { SessionManager } from './SessionManager.js';
import { registerTools } from './registerTools.js';
import { createSecurity } from './security.js';
export async function startServer({tokens,port=39015,root=path.resolve('.mcp-sessions'),security={},managerOptions={}}) {
 const authorize=createSecurity(tokens,security); const manager=new SessionManager({root,...managerOptions});
 const connections=new Set();
 const http=createServer(async(req,res)=>{
  let server;
  try {
   if(req.url!=='/mcp') {res.writeHead(404).end();return;}
   const {owner,body}=await authorize(req);
   if(req.method!=='POST') {res.writeHead(405).end();return;}
   server=new McpServer({name:'AgentScape Remote MCP',version:'0.1.0'});
   registerTools(server,manager,owner);
   const transport=new NodeStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
   connections.add(server); res.on('close',()=>{connections.delete(server);server.close().catch(()=>{});});
   await server.connect(transport); await transport.handleRequest(req,res,body);
  } catch(e) {if(!res.headersSent) res.writeHead(e.status||500).end(JSON.stringify({error:e.status?'HTTP_REQUEST_REJECTED':'INTERNAL_ERROR'}));}
 });
 http.requestTimeout=35000; http.headersTimeout=10000;
 try {await new Promise((resolve,reject)=>{http.once('error',reject);http.listen(port,'127.0.0.1',resolve);});}
 catch(e){await manager.dispose();throw e;}
 return {http,manager,port:http.address().port,async close(){await manager.dispose();await Promise.all([...connections].map(s=>s.close()));await new Promise(r=>http.close(r));}};
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
 // Deliberately do not load dotenv or the Studio configuration.
 const tokens=JSON.parse(process.env.AGENTSCAPE_MCP_TOKENS||'[]');
 const app=await startServer({tokens});
 console.log(`AgentScape Remote MCP: http://127.0.0.1:${app.port}/mcp`);
 for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>app.close().then(()=>process.exit(0)));
}
