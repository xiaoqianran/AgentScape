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
  /** Update the advertised world without dropping pending MCP calls or rotating the session ID. */
  syncWorld() {
    if(!this.session||this.disposed)return Promise.resolve(null);
    const active=this.session;
    const worldId=String(this.world.environment?.id||'studio-world');
    this.worldSync=(this.worldSync||Promise.resolve()).catch(()=>{}).then(()=>{
      if(this.session!==active)return null;
      return this.post('world-change',{...active,worldId:String(this.world.environment?.id||worldId)},this.abort?.signal);
    });
    return this.worldSync;
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
  // UI and MCP share the same session-scoped Forge and revision checks.
  recipeMaterial(id){
    try{
      const entry=this.objectForge.get(this.world,id);
      if(entry.definition.schema!=='agentscape.asset-recipe')return null;
      const parts=entry.definition.parts.filter(part=>part.geometry).map(part=>({
        id:part.id,material:structuredClone(part.material||{color:'#aaaaaa',roughness:.7,metalness:0})
      }));
      return parts.length?{assetId:entry.assetId,revision:entry.revision,parts}:null;
    }catch(error){
      if(error.code==='OBJECT_DEFINITION_UNAVAILABLE')return null;
      throw error;
    }
  }
  async applyRecipeMaterial({id,assetId,revision,partId,material}){
    const world=this.world,scene=this.scene;
    const entry=this.objectForge.get(world,id);
    if(entry.assetId!==assetId||entry.revision!==revision)throw failure('OBJECT_REVISION_CONFLICT');
    if(entry.definition.schema!=='agentscape.asset-recipe'||!entry.definition.parts.some(part=>part.id===partId&&part.geometry))
      throw failure('OBJECT_MATERIAL_PART_UNAVAILABLE');
    const preview=this.objectForge.preview(world,id,revision,[{path:'/parts/@'+partId+'/material',value:material}]);
    return this.applyObjectDefinition(world,scene,id,revision,preview.previewId);
  }
  async applyObjectDefinition(world,scene,id,revision,previewId){
    const result=await this.objectForge.apply(world,scene,id,revision,previewId);
    this.emit({});
    return result;
  }
  async execute(request){
    const {method,args={}}=request;
    const { expectedProjectId, ...inputArgs } = args;
    if (expectedProjectId && this.codeProjects?.draft?.id !== expectedProjectId)
      throw failure('TASK_PROJECT_CHANGED');
    if (expectedProjectId && method === 'verify' &&
        (!this.codeProjects.session || this.codeProjects.runningRevision !== this.codeProjects.revision))
      throw failure('RUN_DRAFT_BEFORE_VERIFY');
    if (method === 'project') {
      if (!this.codeProjects) throw failure('STUDIO_PROJECTS_UNAVAILABLE');
      const { operation, ...input } = inputArgs;
      if (operation === 'create_world') return this.codeProjects.createForTask(input);
      if (operation === 'read') {
        // Local authoring must not depend on a shared repository round trip.
        await this.codeProjects.refresh({shared:false});
        if (expectedProjectId && this.codeProjects.draft?.id !== expectedProjectId)
          throw failure('TASK_PROJECT_CHANGED');
        return this.codeProjects.read();
      }
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
      if (operation === 'inspect') return this.codeProjects.inspect(input);
      if (operation === 'search') return this.codeProjects.search(input);
      if (operation === 'physics_candidate') return this.codeProjects.physicsCandidate(input);
      if (operation === 'inspect_batch') return this.codeProjects.inspectBatch(input);
      if (operation === 'suggest_views') return this.codeProjects.suggestViews(input);
      if (operation === 'timeline') return this.codeProjects.timeline(input);
      if (operation === 'capture') return this.codeProjects.captureWhenReady(input);
      if (operation === 'save') return this.codeProjects.save();
      if (operation === 'open') return this.codeProjects.load(input.id);
      if (operation === 'close') return this.codeProjects.close();
      throw failure('STUDIO_METHOD_FORBIDDEN');
    }
    if (this.codeProjects?.busy) throw failure('PROJECT_BUSY');
    switch(method){
      case 'observe':{
        if(args.target)return this.scene.inspect(args.target,{actor:args.actor});
        const result=this.scene.observe({actor:args.actor,...(args.limit!=null?{limit:args.limit,offset:args.offset||0}:{})});
        const project=this.codeProjects;
        if(args.limit!=null&&project?.session?.scene===this.scene&&project.draft){
          return {...result,projectBinding:{projectId:project.draft.id,projectRevision:project.revision,
            runningRevision:project.runningRevision,runtimeId:project.runtimeId}};
        }
        return result;
      }
      case 'navigation':return this.scene.diagnoseNavigation({actor:args.actor,position:args.position});
      case 'apply':return this.scene.apply({requestId:args.requestId,expectedRevision:args.expectedRevision,operations:args.operations});
      case 'history':return this.scene.history(args);
      case 'interact':
        if(this.codeProjects?.session?.playback?.status().paused)throw failure('PROJECT_PLAYBACK_PAUSED');
        return this.scene.interact(args.interaction);
      case 'job':return this.scene.getJob(args.jobId);
      case 'cancel':return this.scene.cancelJob(args.jobId);
      case 'verify': {
        const verify=criteria=>{
          if(!args.snapshot)return this.scene.verify(criteria);
          if(this.codeProjects?.session?.scene!==this.scene)throw failure('PROJECT_SNAPSHOT_UNAVAILABLE');
          return this.codeProjects.verifySnapshotWhenReady(criteria,args.snapshot);
        };
        if (!expectedProjectId) return verify(args.criteria);
        const existing = new Set(args.criteria.filter(check=>check.kind==='object-exists').map(check=>check.targetId));
        const ids = new Set(args.criteria.map(check=>check.id));
        const additional = [];
        for (const entity of this.scene.observe().project?.entities || []) {
          if (existing.has(entity.id)) continue;
          let index = ids.size;
          while (ids.has('task-entity-'+index)) index++;
          const id = 'task-entity-'+index;
          ids.add(id);
          additional.push({id,kind:'object-exists',targetId:entity.id});
        }
        return verify([...args.criteria,...additional]);
      }
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
          {this.objectForge.record(model.id,model.asset,this.world.store.get(model.id).assetId,this.world);this.emit({});}
        return added;
      }
      case 'objectDefinition':{
        const forge=this.objectForge;
        if(args.operation==='inspect')return forge.inspect(this.world,args.objectId);
        if(args.operation==='preview')return forge.preview(this.world,args.objectId,args.expectedRevision,args.changes);
        if(args.operation==='apply')return this.applyObjectDefinition(this.world,this.scene,args.objectId,args.expectedRevision,args.previewId);
        throw failure('STUDIO_METHOD_FORBIDDEN');
      }
      case 'importProject':{
        const imported=await this.scene.importProject(args.bundle);
        this.objectForge.restore(this.world,imported.value.editable||[]);
        this.emit({});
        return {...imported,value:{...imported.value,editableRestored:imported.value.editable?.length||0,editable:undefined}};
      }
      case 'setStyle':return this.scene.setStyle(args.style,{fallback:args.fallback});
      case 'save':return this.codeProjects?.session ? this.codeProjects.save() : this.scene.save({editable:this.objectForge.export(this.world)});
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
