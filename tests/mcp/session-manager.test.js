import { describe,it,expect } from 'vitest';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SessionManager } from '../../apps/mcp-server/SessionManager.js';
import { actionSchemas } from '../../apps/mcp-server/registerTools.js';
import { createSecurity } from '../../apps/mcp-server/security.js';

describe('Session limits and cleanup with real Runtime',()=>{
 it('enforces mutual exclusion, idempotency binding, TTL, cancellation, timeout and cleanup',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'mcp-limits-'));
  const manager=new SessionManager({root,maxSessions:1,ttlMs:10});
  try {
   const {worldSessionId:id}=await manager.create('a'); const s=manager.get('a',id);
   await expect(manager.create('a')).rejects.toThrow('SESSION_LIMIT');
   let release; const active=manager.run('a',id,()=>new Promise(r=>{release=r;}),{requestId:'one',fingerprint:'a'});
   await Promise.resolve();
   await expect(manager.run('a',id,()=>{})).rejects.toThrow('SESSION_BUSY');
   await expect(manager.run('a',id,()=>{},{requestId:'one',fingerprint:'b'})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
   release('ok');await active;
   await expect(s.host.execute('evil',{})).rejects.toThrow('SKILL_FORBIDDEN');
   expect(()=>actionSchemas.moveObject.parse({id:'cup',position:[NaN,0,0]})).toThrow();
   const abort=new AbortController();abort.abort();
   await expect(manager.run('a',id,(s,signal)=>s.host.execute('navigateTo',{id:'agent_01',end:[4,0,4]},signal),{signal:abort.signal})).rejects.toThrow('ACTION_CANCELLED');
   s.host.maxSteps=1;
   await expect(manager.run('a',id,s=>s.host.execute('navigateTo',{id:'agent_01',end:[4,0,4]}))).rejects.toThrow('ACTION_TIMEOUT');
   expect(s.host.world.mutationOwner).toBe(null);
   await expect(manager.run('a',id,()=>{throw new Error('runtime failure');})).rejects.toThrow('runtime failure');
   expect(s.active).toBe(null);
   manager.maxExportBytes=1; await expect(manager.export(s)).rejects.toThrow('EXPORT_LIMIT');
   s.lastUsed=0; await manager.reap();expect(manager.sessions.size).toBe(0);expect(s.host.world.ready).toBe(false);
   const next=await manager.create('a'); const live=manager.get('a',next.worldSessionId);
   const action=manager.run('a',next.worldSessionId,(s,signal)=>s.host.execute('navigateTo',{id:'agent_01',end:[4,0,4]},signal));
   await Promise.resolve();const closing=manager.close('a',next.worldSessionId);
   await expect(action).rejects.toThrow('ACTION_CANCELLED');await closing;expect(live.host.world.ready).toBe(false);
  } finally {await manager.dispose();await rm(root,{recursive:true,force:true});}
 },30000);
 it('requires strong independent credentials',()=>{expect(()=>createSecurity([{identity:'a',token:'short'}])).toThrow();});
});
