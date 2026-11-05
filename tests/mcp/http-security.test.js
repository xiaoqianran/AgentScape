import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {startServer} from '../../apps/mcp-server/main.mjs';
it('fails safely on port conflicts, rate limits and never reloads stale data',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'mcp-restart-'));
 const tokens=[{identity:'test',token:randomBytes(32).toString('hex')}];
 await mkdir(path.join(root,'old-session'));await writeFile(path.join(root,'old-session','broken.json.tmp'),'{');
 const app=await startServer({root,tokens,port:0,security:{rate:1}});
 try {
  expect(app.manager.sessions.size).toBe(0);
  await expect(startServer({root,tokens,port:app.port})).rejects.toThrow();
  const url=`http://127.0.0.1:${app.port}/mcp`,headers={Authorization:`Bearer ${tokens[0].token}`};
  await fetch(url,{method:'POST',headers,body:'{}'});
  expect((await fetch(url,{method:'POST',headers,body:'{}'})).status).toBe(429);
 } finally {await app.close();await rm(root,{recursive:true,force:true});}
});
