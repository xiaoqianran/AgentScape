import { it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { startServer } from '../../apps/mcp-server/main.mjs';

it('serves modern per-request discovery and tools without a legacy handshake', async () => {
 const token=randomBytes(32).toString('hex');
 const app=await startServer({tokens:[{identity:'modern',token}],port:0,root:tmpdir()});
 try {
  for(const method of ['server/discover','tools/list']) {
   const response=await fetch(`http://127.0.0.1:${app.port}/mcp`,{
    method:'POST',headers:{'Mcp-Method':method,Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2026-07-28'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:{_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientInfo':{name:'modern-test',version:'1'},'io.modelcontextprotocol/clientCapabilities':{}}}})
   });
   const body=await response.text();
   expect(response.status,body).toBe(200);
   const result=JSON.parse(body.startsWith('event:')||body.startsWith('data:')?body.split('\n').find(line=>line.startsWith('data:')).slice(5):body);
   expect(result.error).toBeUndefined();
   if(method==='tools/list') expect(result.result.tools).toHaveLength(9);
  }
 } finally { await app.close(); }
});
