import { createRequestWindow } from '../../application/scene/RequestWindow.js';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const issue = (code) => Object.assign(new Error(code), {code});
const secret = () => randomBytes(32).toString('hex');
const equal = (left, right) => typeof left === 'string' && typeof right === 'string'
  && left.length === right.length && timingSafeEqual(Buffer.from(left),Buffer.from(right));

/**
 * Ephemeral transport, not a second WorldRuntime.
 * Studio owns the only Runtime; MCP supplies authenticated and bounded commands.
 * Browser pairing requires a human-delivered one-time capability (not the MCP Bearer token).
 */
export class StudioLiveBridge {
  constructor({now=()=>Date.now(),pairTtlMs=120000,heartbeatMs=30000,rpcTimeoutMs=30000}={}) {
    this.now=now;
    this.pairTtlMs=pairTtlMs;
    this.heartbeatMs=heartbeatMs;
    this.rpcTimeoutMs=rpcTimeoutMs;
    this.sessions=new Map();
    this.autoByInstance=new Map();
    this.autoOwnerHistory=new Map(); // Short-lived tab binding across disconnect/reconnect.
  }

  pair(owner) {
    if(!owner)throw issue('OWNER_REQUIRED');
    for(const [id,entry] of this.sessions)if(!entry.connected&&this.now()>entry.expiresAt)this.disconnect(id,'PAIR_CODE_EXPIRED');
    if([...this.sessions.values()].filter(entry=>entry.owner===owner).length>=4)throw issue('STUDIO_SESSION_LIMIT');
    if(this.sessions.size>=32)throw issue('STUDIO_SESSION_LIMIT');
    const worldSessionId=randomUUID(),pairCode=secret();
    this.sessions.set(worldSessionId,{owner,pairCode,expiresAt:this.now()+this.pairTtlMs,
      token:null,connected:false,lastSeen:0,pending:new Map(),requests:createRequestWindow({now:this.now}),queue:[],pollWaiter:null});
    return {worldSessionId,pairCode,expiresInSeconds:Math.ceil(this.pairTtlMs/1000),status:'awaiting-studio'};
  }

  /**
   * Loopback auto mode: an approved local Studio origin registers a live tab.
   * No MCP bearer is exposed to the browser; all Scene tools still require MCP auth.
   */
  registerAuto(instanceId,worldId) {
    if(typeof instanceId!=='string'||!/^[a-f0-9-]{36}$/i.test(instanceId))throw issue('STUDIO_INSTANCE_INVALID');
    if(typeof worldId!=='string'||worldId.length>128||!worldId.length)throw issue('STUDIO_WORLD_INVALID');
    for(const [id,session] of this.sessions) {
      if(session.auto && (!session.connected||this.now()-session.lastSeen>this.heartbeatMs))this.disconnect(id,'STUDIO_DISCONNECTED');
    }
    const previous=this.autoByInstance.get(instanceId);
    for(const [key,entry] of this.autoOwnerHistory)if(entry.expiresAt<=this.now())this.autoOwnerHistory.delete(key);
    const previousOwner=(previous?this.sessions.get(previous)?.owner:null)??this.autoOwnerHistory.get(instanceId)?.owner??null;
    if(previous)this.disconnect(previous,'STUDIO_REPLACED');
    if(this.autoByInstance.size>=8)throw issue('STUDIO_TAB_LIMIT');
    const worldSessionId=randomUUID(),token=secret();
    this.sessions.set(worldSessionId,{
      owner:previousOwner,auto:true,instanceId,worldId,pairCode:null,expiresAt:0,
      token,connected:true,lastSeen:this.now(),pending:new Map(),requests:createRequestWindow({now:this.now}),queue:[],pollWaiter:null
    });
    this.autoByInstance.set(instanceId,worldSessionId);
    return {worldSessionId,studioToken:token,status:'connected',mode:'automatic',worldId};
  }

  currentSession(owner=null) {
    const active=[];
    for(const [id,s] of this.sessions){
      if(!s.auto)continue;
      if(!s.connected||this.now()-s.lastSeen>this.heartbeatMs){this.disconnect(id,'STUDIO_DISCONNECTED');continue;}
      if(owner!=null && s.owner!=null && s.owner!==owner)continue;
      active.push({worldSessionId:id,worldId:s.worldId,status:'connected',connected:true,mode:'automatic'});
    }
    if(!active.length)throw issue('STUDIO_NOT_CONNECTED');
    if(active.length>1)throw issue('STUDIO_MULTIPLE_WORLDS');
    if(owner!=null)this.ownerSession(owner,active[0].worldSessionId);
    return active[0];
  }
  isStudioSession(id) {return this.sessions.has(id);}
  ownerSession(owner,id) {
    const s=this.sessions.get(id);
    if(!s||(s.owner!=null && s.owner!==owner))throw issue('SESSION_NOT_FOUND');
    if(s.auto && s.owner==null){if(!owner)throw issue('OWNER_REQUIRED');s.owner=owner;}
    return s;
  }
  status(owner,id) {
    const s=this.ownerSession(owner,id);
    if(s.connected&&this.now()-s.lastSeen>this.heartbeatMs)this.disconnect(id,'STUDIO_DISCONNECTED');
    return {worldSessionId:id,mode:s.auto?'automatic':'paired',worldId:s.worldId||null,status:s.connected?'connected':s.pairCode&&this.now()<s.expiresAt?'awaiting-studio':'disconnected',
      connected:s.connected,lastSeen:s.lastSeen||null};
  }
  connect(pairCode) {
    const candidate=[...this.sessions.entries()].find(([,s])=>s.pairCode&&equal(s.pairCode,pairCode));
    if(!candidate)throw issue('PAIR_CODE_INVALID');
    const [id,s]=candidate;
    if(this.now()>s.expiresAt) {this.disconnect(id,'PAIR_CODE_EXPIRED');throw issue('PAIR_CODE_EXPIRED');}
    s.pairCode=null;
    s.token=secret();
    s.connected=true;
    s.lastSeen=this.now();
    return {worldSessionId:id,studioToken:s.token,status:'connected'};
  }
  authorized(id,token) {
    const s=this.sessions.get(id);
    if(!s||!s.connected||!equal(s.token,token))throw issue('STUDIO_AUTH_FAILED');
    if(this.now()-s.lastSeen>this.heartbeatMs) {this.disconnect(id,'STUDIO_DISCONNECTED');throw issue('STUDIO_DISCONNECTED');}
    return s;
  }
  async poll(id,token) {
    const s=this.authorized(id,token);
    s.lastSeen=this.now();
    if(s.queue.length)return {request:s.queue.shift()};
    // Poll has its own short deadline to allow rapid disconnect and heartbeat.
    if(s.pollWaiter)throw issue('STUDIO_POLL_CONFLICT');
    return new Promise(resolve=>{
      const timer=setTimeout(()=>{
        if(s.pollWaiter?.resolve===resolve)s.pollWaiter=null;
        resolve({request:null});
      },8000);
      timer.unref?.();
      s.pollWaiter={resolve,timer};
    });
  }
  reply(id,token,{requestId,result,error}) {
    const s=this.authorized(id,token);
    s.lastSeen=this.now();
    const pending=s.pending.get(requestId);
    if(!pending)throw issue('STUDIO_REQUEST_NOT_FOUND');
    s.pending.delete(requestId);
    clearTimeout(pending.timer);
    if(error)pending.reject(issue(typeof error.code==='string'&&/^[A-Z_]+$/.test(error.code)?error.code:'STUDIO_OPERATION_FAILED'));
    else pending.resolve(result);
    return {status:'accepted'};
  }
  async call(owner,id,method,args,{signal,requestId}={}) {
    const s=this.ownerSession(owner,id);
    if(!s.connected||this.now()-s.lastSeen>this.heartbeatMs){
      this.disconnect(id,'STUDIO_DISCONNECTED');
      throw issue('STUDIO_DISCONNECTED');
    }
    const fingerprint=requestId?JSON.stringify([method,args]):null;
    const replay=s.requests.replay(requestId,fingerprint);
    if(replay)return replay;
    if(requestId)s.requests.ensureCapacity();
    if(s.pending.size>=1)throw issue('STUDIO_BUSY');
    if(signal?.aborted)throw issue('ACTION_CANCELLED');
    const transportId=randomUUID();
    const promise=new Promise((resolve,reject)=>{
      const cancel=()=>{const item=s.pending.get(transportId);if(!item)return;clearTimeout(item.timer);s.pending.delete(transportId);s.queue=s.queue.filter(item=>item.requestId!==transportId);item.reject(issue('ACTION_CANCELLED'));};
      const timer=setTimeout(()=>{
        s.pending.delete(transportId);
        s.queue=s.queue.filter(item=>item.requestId!==transportId);
        signal?.removeEventListener('abort',cancel);
        reject(issue('STUDIO_TIMEOUT'));
      },this.rpcTimeoutMs);
      timer.unref?.();
      const pending={
        timer,
        resolve:value=>{signal?.removeEventListener('abort',cancel);resolve(value);},
        reject:error=>{signal?.removeEventListener('abort',cancel);reject(error);}
      };
      s.pending.set(transportId,pending);
      signal?.addEventListener('abort',cancel,{once:true});
      const request={requestId:transportId,method,args};
      if(s.pollWaiter){
        clearTimeout(s.pollWaiter.timer);
        const waiter=s.pollWaiter;s.pollWaiter=null;
        waiter.resolve({request});
      }else s.queue.push(request);
    });
    if(requestId){
      s.requests.track(requestId,fingerprint,promise);
    }
    return promise;
  }
  disconnect(id,reason='STUDIO_DISCONNECTED') {
    const s=this.sessions.get(id);
    if(!s)return false;
    this.sessions.delete(id);
    if(s.auto && this.autoByInstance.get(s.instanceId)===id)this.autoByInstance.delete(s.instanceId);
    if(s.auto && s.owner!=null){
      this.autoOwnerHistory.delete(s.instanceId);
      this.autoOwnerHistory.set(s.instanceId,{owner:s.owner,expiresAt:this.now()+10*60_000});
      while(this.autoOwnerHistory.size>64)this.autoOwnerHistory.delete(this.autoOwnerHistory.keys().next().value);
    }
    s.connected=false;
    if(s.pollWaiter){
      clearTimeout(s.pollWaiter.timer);s.pollWaiter.resolve({request:null});s.pollWaiter=null;
    }
    for(const pending of s.pending.values()){clearTimeout(pending.timer);pending.reject(issue(reason));}
    s.pending.clear();s.queue.length=0;
    return true;
  }
  close(owner,id) {this.ownerSession(owner,id);this.disconnect(id);return {worldSessionId:id,status:'disconnected'};}
  dispose(){for(const id of [...this.sessions.keys()])this.disconnect(id);this.autoOwnerHistory.clear();}
}
