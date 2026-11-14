import { SceneObjectForge } from '../../../application/object-forge/SceneObjectForge.js';
const localHost=host=>host==='127.0.0.1'||host==='localhost';
const failure=code=>Object.assign(new Error(code),{code});
const decode=bytes=>Uint8Array.from(atob(bytes),char=>char.charCodeAt(0));
const settingKey='agentscape.mcp.autoEnabled.v1';
const tabKey='agentscape.mcp.instanceId.v1';

function instanceId() {
  try {
    const saved=globalThis.sessionStorage?.getItem(tabKey);
    if(saved&&/^[a-f0-9-]{36}$/i.test(saved))return saved;
    const id=globalThis.crypto.randomUUID();
    globalThis.sessionStorage?.setItem(tabKey,id);
    return id;
  }catch{return globalThis.crypto.randomUUID();}
}
export function defaultAutoMcpEnabled() {
  if(!localHost(globalThis.location?.hostname))return false;
  try{return globalThis.localStorage?.getItem(settingKey)!=='false';}
  catch{return true;}
}

export class StudioLiveBridgeClient {
  constructor({scene,world,serverUrl='http://127.0.0.1:39015',fetchImpl=globalThis.fetch,instance=instanceId()}={}) {
    if(!scene?.observe || !scene?.addModel || !world?.events?.on)throw new TypeError('StudioLiveBridgeClient requires SceneFacade and WorldRuntime');
    const url=new URL(serverUrl);
    if(url.protocol!=='http:'||!localHost(url.hostname)||url.username||url.password||url.pathname!=='/')
      throw failure('BRIDGE_LOCAL_ENDPOINT_REQUIRED');
    this.base=url.origin;
    this.fetch=fetchImpl.bind(globalThis);
    this.scene=scene;
    this.world=world;
    this.objectForge=new SceneObjectForge();
    this.instance=instance;
    this.session=null;
    this.abort=null;
    this.registerAbort=null;
    this.registering=false;
    this.retryTimer=null;
    this.retryDelay=1200;
    this.autoEnabled=false;
    this.disposed=false;
    this.listeners=new Set();
    this.current=Object.freeze({status:'disconnected',worldSessionId:null,error:null,autoEnabled:false,mode:null});
    this.stopEvents=[
      world.events.on('environment.replaced',()=>this.disconnect('WORLD_CHANGED',{retry:false})),
      world.events.on('world.session.changed',()=>this.refreshAuto()),
      world.events.on('world.session.reset',()=>this.refreshAuto()),
      world.events.on('scene.restored',()=>this.autoEnabled?this.scheduleAuto(650):this.disconnect('WORLD_RESTORED')),
      world.events.on('world.disposing',()=>this.dispose())
    ];
  }
  subscribe=(listener)=>{this.listeners.add(listener);return ()=>this.listeners.delete(listener);};
  snapshot=()=>this.current;
  emit(update){
    this.current=Object.freeze({...this.current,...update});
    for(const listener of this.listeners)listener();
  }
  async post(path,body,signal){
    const result=await this.fetch(this.base+'/studio-bridge/'+path,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),
      signal,cache:'no-store'
    });
    const payload=await result.json();
    if(!result.ok)throw failure(payload.code||'BRIDGE_REQUEST_FAILED');
    return payload;
  }
  clearRetry(){
    if(this.retryTimer)clearTimeout(this.retryTimer);
    this.retryTimer=null;
  }
  setAutoEnabled(enabled){
    if(this.disposed)throw failure('STUDIO_DISPOSED');
    const allowed=!globalThis.location?.hostname||localHost(globalThis.location.hostname);
    enabled=Boolean(enabled)&&allowed;
    try{globalThis.localStorage?.setItem(settingKey,enabled?'true':'false');}
    catch{/* Browser storage may be blocked; session behavior still works. */}
    if(!enabled){
      this.autoEnabled=false;
      this.clearRetry();
      this.registerAbort?.abort();
      this.disconnect(null,{retry:false});
      this.emit({autoEnabled:false,error:null});
      return;
    }
    if(this.autoEnabled)return;
    this.autoEnabled=true;
    this.retryDelay=1200;
    this.emit({autoEnabled:true,status:'connecting',error:null,mode:'automatic'});
    void this.registerAuto();
  }
  async registerAuto() {
    if(!this.autoEnabled||this.disposed||this.session||this.registering)return;
    this.clearRetry();
    this.registering=true;
    this.registerAbort=new AbortController();
    this.emit({status:'connecting',error:null,mode:'automatic'});
    try{
      const response=await this.post('auto-register',{
        instanceId:this.instance,
        worldId:String(this.world.environment?.id||'studio-world')
      },this.registerAbort.signal);
      if(!this.autoEnabled||this.disposed) {
        void this.post('disconnect',response).catch(()=>{});
        return;
      }
      this.activate(response,'automatic');
      this.retryDelay=1200;
    }catch(error){
      if(this.autoEnabled&&!this.disposed){
        this.emit({status:'disconnected',error:'MCP_OFFLINE',mode:'automatic'});
        this.scheduleAuto();
      }
    }finally{
      this.registering=false;
      this.registerAbort=null;
    }
  }
  scheduleAuto(delay=this.retryDelay){
    if(!this.autoEnabled||this.disposed||this.retryTimer)return;
    this.retryTimer=setTimeout(()=>{
      this.retryTimer=null;
      void this.registerAuto();
    },delay);
    this.retryDelay=Math.min(this.retryDelay*2,10000);
  }
  refreshAuto(){
    if(!this.autoEnabled||this.disposed)return;
    this.clearRetry();
    this.registerAbort?.abort();
    this.disconnect('WORLD_CHANGED',{retry:false});
    this.scheduleAuto(50);
  }
  activate(response,mode){
    this.session={worldSessionId:response.worldSessionId,studioToken:response.studioToken};
    this.abort=new AbortController();
    this.emit({status:'connected',worldSessionId:response.worldSessionId,error:null,mode});
    void this.run(this.session,this.abort.signal);
    return this.snapshot();
  }
  async connect(pairCode) {
    if(this.autoEnabled)throw failure('STUDIO_AUTO_ACTIVE');
    if(this.session||this.current.status==='connecting')throw failure('STUDIO_ALREADY_CONNECTED');
    if(typeof pairCode!=='string'||pairCode.length<32)throw failure('PAIR_CODE_INVALID');
    this.emit({status:'connecting',error:null});
    try{
      const result=await this.post('connect',{pairCode:pairCode.trim()});
      return this.activate(result,'paired');
    }catch(error){
      this.emit({status:'disconnected',worldSessionId:null,error:error.code||'BRIDGE_CONNECTION_FAILED'});
      throw error;
    }
  }
  async execute(request){
    const {method,args={}}=request;
    if (method === 'project') {
      if (!this.codeProjects) throw failure('STUDIO_PROJECTS_UNAVAILABLE');
      const { operation, ...input } = args;
      if (operation === 'read') { await this.codeProjects.refresh(); return this.codeProjects.read(); }
      if (operation === 'write') return this.codeProjects.write(input);
      if (operation === 'patch') return this.codeProjects.patch(input);
      if (operation === 'file_read') return this.codeProjects.readFile(input.path,input);
      if (operation === 'file') return this.codeProjects.editFile(input);
      if (operation === 'resource') return this.codeProjects.editResource(input);
      if (operation === 'preview_batch') return this.codeProjects.previewBatch(input);
      if (operation === 'apply_batch') return this.codeProjects.applyBatch(input);
      if (operation === 'discard_batch') return this.codeProjects.discardBatch(input);
      if (operation === 'undo_batch') return this.codeProjects.undoBatch(input);
      if (operation === 'run') return this.codeProjects.run(input);
      if (operation === 'save') return this.codeProjects.save();
      if (operation === 'open') return this.codeProjects.load(input.id);
      if (operation === 'close') return this.codeProjects.close();
      throw failure('STUDIO_METHOD_FORBIDDEN');
    }
    if (this.codeProjects?.busy) throw failure('PROJECT_BUSY');
    switch(method){
      case 'observe':return args.target?this.scene.inspect(args.target,{actor:args.actor}):this.scene.observe({
        actor:args.actor,...(args.limit!=null?{limit:args.limit,offset:args.offset||0}:{})
      });
      case 'apply':return this.scene.apply({requestId:args.requestId,expectedRevision:args.expectedRevision,operations:args.operations});
      case 'interact':return this.scene.interact(args.interaction);
      case 'job':return this.scene.getJob(args.jobId);
      case 'cancel':return this.scene.cancelJob(args.jobId);
      case 'verify':return this.scene.verify(args.criteria);
      case 'thermal':return this.scene.thermalExperiment(args);
      case 'addModel':{
        let model=args.model;
        if(['glb','compiled-code'].includes(model?.asset?.kind)){
          const {bytesBase64,urdfBase64,...rest}=model.asset;
          const assetId=rest.kind==='compiled-code'&&rest.id?.startsWith('pa_')?'asset_'+rest.id.slice(3):rest.id;
          model={...model,asset:{...rest,...(assetId?{id:assetId}:{}),bytes:decode(bytesBase64),...(urdfBase64?{urdfBytes:decode(urdfBase64)}:{})}};
        }
        if(args.mode==='prepare')return this.scene.prepareAsset(model.asset);
        if(args.mode==='screen')return this.scene.screenAsset({...model.asset,
          proposalId:model.proposalId,hypothesisIds:model.hypothesisIds});
        const added=await this.scene.addModel(model);
        if(added.status==='succeeded' && model.asset && typeof model.asset==='object' && this.world.store?.has(model.id))
          this.objectForge.record(model.id,model.asset,this.world.store.get(model.id).assetId,this.world);
        return added;
      }
      case 'objectDefinition':{
        const forge=this.objectForge;
        if(args.operation==='inspect')return forge.inspect(this.world,args.objectId);
        if(args.operation==='preview')return forge.preview(this.world,args.objectId,args.expectedRevision,args.changes);
        if(args.operation==='apply')return forge.apply(this.world,this.scene,args.objectId,args.expectedRevision,args.previewId);
        throw failure('STUDIO_METHOD_FORBIDDEN');
      }
      case 'importProject':return this.scene.importProject(args.bundle);
      case 'setStyle':return this.scene.setStyle(args.style,{fallback:args.fallback});
      case 'save':return this.codeProjects?.session ? this.codeProjects.save() : this.scene.save();
      default:throw failure('STUDIO_METHOD_FORBIDDEN');
    }
  }
  async run(session,signal){
    const credentials=()=>({...session});
    try{
      while(this.session===session&&!signal.aborted){
        const {request}=await this.post('poll',credentials(),signal);
        if(!request)continue;
        if(signal.aborted||this.session!==session)break;
        let reply;
        try{reply={result:await this.execute(request)};}
        catch(error){reply={error:{code:typeof error.code==='string'?error.code:'STUDIO_OPERATION_FAILED'}};}
        if(signal.aborted||this.session!==session)break;
        await this.post('reply',{...credentials(),requestId:request.requestId,...reply},signal);
      }
    }catch(error){
      if(!signal.aborted&&this.session===session)this.disconnect(error.code||'BRIDGE_DISCONNECTED');
    }
  }
  disconnect(reason=null,{retry=true}={}){
    const session=this.session;
    this.session=null;
    this.abort?.abort();
    this.abort=null;
    this.emit({status:'disconnected',worldSessionId:null,error:reason,mode:this.autoEnabled?'automatic':null});
    if(session)void this.post('disconnect',session).catch(()=>{});
    if(retry&&this.autoEnabled)this.scheduleAuto();
  }
  dispose(){
    if(this.disposed)return;
    this.disposed=true;
    this.autoEnabled=false;
    this.clearRetry();
    this.registerAbort?.abort();
    this.disconnect(null,{retry:false});
    for(const stop of this.stopEvents)stop?.();
    this.listeners.clear();
  }
}
