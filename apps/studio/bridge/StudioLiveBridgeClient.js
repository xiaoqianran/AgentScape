const localHost=host=>host==='127.0.0.1'||host==='localhost';
const failure=code=>Object.assign(new Error(code),{code});
const encode=bytes=>Uint8Array.from(atob(bytes),char=>char.charCodeAt(0));

export class StudioLiveBridgeClient {
  constructor({scene,world,serverUrl='http://127.0.0.1:39015',fetchImpl=globalThis.fetch}={}) {
    if(!scene?.observe || !scene?.addModel || !world?.events?.on)throw new TypeError('StudioLiveBridgeClient requires SceneFacade and WorldRuntime');
    const url=new URL(serverUrl);
    if(url.protocol!=='http:'||!localHost(url.hostname)||url.username||url.password||url.pathname!=='/')
      throw failure('BRIDGE_LOCAL_ENDPOINT_REQUIRED');
    this.base=url.origin;
    this.fetch=fetchImpl.bind(globalThis);
    this.scene=scene;
    this.world=world;
    this.session=null;
    this.abort=null;
    this.listeners=new Set();
    this.current=Object.freeze({status:'disconnected',worldSessionId:null,error:null});
    this.stopEvents=[
      world.events.on('environment.replaced',()=>this.disconnect('WORLD_CHANGED')),
      world.events.on('scene.restored',()=>this.disconnect('WORLD_RESTORED')),
      world.events.on('world.disposing',()=>this.disconnect('WORLD_DISPOSED'))
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
  async connect(pairCode) {
    if(this.session||this.current.status==='connecting')throw failure('STUDIO_ALREADY_CONNECTED');
    if(typeof pairCode!=='string'||pairCode.length<32)throw failure('PAIR_CODE_INVALID');
    this.emit({status:'connecting',error:null});
    try{
      const result=await this.post('connect',{pairCode:pairCode.trim()});
      this.session={worldSessionId:result.worldSessionId,studioToken:result.studioToken};
      this.abort=new AbortController();
      this.emit({status:'connected',worldSessionId:result.worldSessionId,error:null});
      void this.run(this.session,this.abort.signal);
      return this.snapshot();
    }catch(error){
      this.emit({status:'disconnected',worldSessionId:null,error:error.code||'BRIDGE_CONNECTION_FAILED'});
      throw error;
    }
  }
  async execute(request){
    const {method,args={}}=request;
    switch(method){
      case 'observe':return args.target?this.scene.inspect(args.target,{actor:args.actor}):this.scene.observe({actor:args.actor});
      case 'apply':return this.scene.apply({requestId:args.requestId,expectedRevision:args.expectedRevision,operations:args.operations});
      case 'interact':return this.scene.interact(args.interaction);
      case 'job':return this.scene.getJob(args.jobId);
      case 'cancel':return this.scene.cancelJob(args.jobId);
      case 'verify':return this.scene.verify(args.criteria);
      case 'addModel':{
        let model=args.model;
        if(model?.asset?.kind==='glb'){
          const {bytesBase64,urdfBase64,...rest}=model.asset;
          model={...model,asset:{...rest,bytes:encode(bytesBase64),...(urdfBase64?{urdfBytes:encode(urdfBase64)}:{})}};
        }
        return args.mode==='prepare'?this.scene.prepareAsset(model.asset):this.scene.addModel(model);
      }
      case 'setStyle':return this.scene.setStyle(args.style,{fallback:args.fallback});
      case 'save':return this.scene.save();
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
  disconnect(reason=null){
    const session=this.session;
    this.session=null;
    this.abort?.abort();
    this.abort=null;
    this.emit({status:'disconnected',worldSessionId:null,error:reason});
    if(session)void this.post('disconnect',session).catch(()=>{});
  }
  dispose(){
    this.disconnect();
    for(const stop of this.stopEvents)stop?.();
    this.listeners.clear();
  }
}
