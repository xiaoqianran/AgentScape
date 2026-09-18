import { bootstrapWorld } from '../../../modules/agent/bootstrapWorld.js';
import { replaceStudioEnvironment } from './replaceStudioEnvironment.js';
import { resolveStudioWorldIdentity, studioSceneStoreKey } from './StudioWorldIdentity.js';

const asMessage=(error)=>error?.message || String(error);

export class WorldSession {
  constructor({
    world,
    tools,
    store,
    autosave,
    builtins=[],
    fallback=null,
    onIdentityChange=()=>{},
    onEnvironmentChange=()=>{},
    log=()=>{}
  }={}) {
    if(!world?.snapshot || !world?.restore || !world?.clearObjects || !world?.replaceEnvironment) {
      throw new TypeError('WorldSession requires WorldRuntime');
    }
    if(!tools?.call) throw new TypeError('WorldSession requires AgentTools');
    if(!store?.setKey || !store?.save || !store?.load || !store?.has || !store?.clear) {
      throw new TypeError('WorldSession requires a scene store');
    }
    if(!autosave?.flush || !autosave?.cancelPending) {
      throw new TypeError('WorldSession requires AutosaveController');
    }

    Object.assign(this,{world,tools,store,autosave,builtins,fallback,onIdentityChange,onEnvironmentChange,log});
    this.busy=false;
    this.disposed=false;
    this.current=this.#resolveIdentity();
    this.#applyIdentity(this.current);
    this.stopEnvironmentListener=world.events?.on?.('environment.replaced',()=>this.#adoptExternalEnvironment()) || null;
  }

  async open(source=null,{reason='world-session-open'}={}) {
    this.#assertReady();
    if(source==null) return this.#runTransition(async()=>{
      const identity=this.#syncIdentity();
      const restoration=await this.#restoreOrBootstrap(identity);
      this.world.history?.clear?.();
      return {status:'world-ready',identity,restoration};
    });

    return this.#runTransition(async()=>{
      this.autosave.flush();
      const nextEnvironment=typeof source==='function' ? await source() : source;
      return this.#replace(nextEnvironment,{reason,flush:false});
    });
  }

  async replace(nextEnvironment,{reason='world-session-replace'}={}) {
    this.#assertReady();
    return this.#runTransition(()=>this.#replace(nextEnvironment,{reason,flush:true}));
  }

  async reset() {
    this.#assertReady();
    return this.#runTransition(async()=>{
      const sceneBefore=this.world.snapshot();
      const storedBefore=this.store.has() ? this.store.load() : null;
      this.autosave.cancelPending();
      this.store.clear();

      try {
        await this.world.clearObjects();
        await bootstrapWorld(this.tools,this.current?.bootstrap || {});
        this.world.history?.clear?.();
        this.autosave.flush();
        this.world.events?.emit?.('world.session.reset',{id:this.current?.id || null});
        return {
          status:'world-reset',
          identity:this.current,
          objects:this.world.queries?.listObjects?.().length ?? 0
        };
      } catch(error) {
        try {
          this.autosave.cancelPending();
          await this.world.clearObjects({silent:true});
          await this.world.restore(sceneBefore);
          if(storedBefore) this.store.save(storedBefore); else this.store.clear();
          this.world.history?.clear?.();
        } catch(rollbackError) {
          const failure=new AggregateError([error,rollbackError],'WorldSession reset rollback failed',{cause:error});
          failure.code='WORLD_SESSION_RESET_ROLLBACK_FAILED';
          failure.rollbackError=rollbackError;
          throw failure;
        }
        throw error;
      }
    });
  }

  dispose() {
    if(this.disposed) return;
    this.disposed=true;
    this.autosave.cancelPending();
    this.autosave.dispose?.();
    this.stopEnvironmentListener?.();
    this.stopEnvironmentListener=null;
  }

  async #replace(nextEnvironment,{reason,flush=true}) {
    if(!nextEnvironment) throw new TypeError('WorldSession replace requires nextEnvironment');
    if(nextEnvironment===this.world.environment) {
      const identity=this.#syncIdentity();
      const restoration=await this.#restoreOrBootstrap(identity);
      this.world.history?.clear?.();
      return {status:'world-ready',identity,restoration,reused:true};
    }

    const previousEnvironment=this.world.environment;
    const previousIdentity=this.current;
    const previousStoreKey=this.store.key;
    const previousScene=this.world.snapshot();
    let replaced=false;
    let replacementStarted=false;

    try {
      if(flush) this.autosave.flush();
      replacementStarted=true;
      const result=await replaceStudioEnvironment(this.world,nextEnvironment,{
        reason,
        disposePrevious:false
      });
      replaced=true;

      const identity=this.#syncIdentity();
      const restoration=await this.#restoreOrBootstrap(identity);
      this.world.history?.clear?.();
      this.autosave.flush();

      await this.onEnvironmentChange({
        phase:'commit',
        reason,
        previousEnvironment,
        environment:nextEnvironment,
        previousIdentity,
        identity
      });

      let warning=result.warning || null;
      try { previousEnvironment?.dispose?.(); }
      catch(error) {
        warning={code:'PREVIOUS_ENVIRONMENT_DISPOSE_FAILED',message:asMessage(error)};
      }

      const committed={
        ...result,
        identity,
        restoration,
        ...(warning?{warning}:{})
      };
      this.world.events?.emit?.('world.session.changed',{
        id:identity.id,
        previousId:previousIdentity?.id || null,
        reason
      });
      return committed;
    } catch(error) {
      if(!replacementStarted) {
        try { nextEnvironment?.dispose?.(); } catch { /* Preserve the persistence failure. */ }
        throw error;
      }
      if(!replaced) throw error;
      await this.#rollbackReplacement({
        error,
        reason,
        previousEnvironment,
        previousIdentity,
        previousStoreKey,
        previousScene,
        nextEnvironment
      });
      throw error;
    }
  }

  async #rollbackReplacement({
    error,
    reason,
    previousEnvironment,
    previousIdentity,
    previousStoreKey,
    previousScene,
    nextEnvironment
  }) {
    let rollbackError=null;
    try {
      this.autosave.cancelPending();
      this.store.setKey(previousStoreKey);
      await this.world.clearObjects({silent:true});
      if(this.world.environment!==previousEnvironment) {
        await this.world.replaceEnvironment(previousEnvironment,{
          disposePrevious:false,
          reason:`${reason}:rollback`
        });
      }
      await this.world.restore(previousScene);
      this.current=previousIdentity;
      this.onIdentityChange(previousIdentity);
      this.world.history?.clear?.();
      await this.onEnvironmentChange({
        phase:'rollback',
        reason,
        previousEnvironment:nextEnvironment,
        environment:previousEnvironment,
        previousIdentity:this.#resolveIdentity(nextEnvironment),
        identity:previousIdentity,
        error
      });
    } catch(cause) {
      rollbackError=cause;
    }

    try { nextEnvironment?.dispose?.(); }
    catch(disposeError) {
      rollbackError ||= disposeError;
    }

    if(rollbackError) {
      const failure=new AggregateError([error,rollbackError],'WorldSession replacement rollback failed',{cause:error});
      failure.code='WORLD_SESSION_ROLLBACK_FAILED';
      failure.rollbackError=rollbackError;
      throw failure;
    }
  }

  async #restoreOrBootstrap(identity) {
    if(!this.store.has()) {
      await bootstrapWorld(this.tools,identity?.bootstrap || {});
      return {mode:'bootstrapped'};
    }

    try {
      const scene=this.store.load();
      await this.world.restore(scene);
      this.log('已恢复自动保存','result');
      const hasAgent=this.world.queries?.listObjects?.().some((record)=>record.type==='agent') ?? true;
      if(!hasAgent && identity?.bootstrap?.agent) {
        await this.tools.call('spawnAsset',{
          assetId:'agent',
          position:identity.bootstrap.agent,
          instanceId:'agent_01'
        });
        this.log('旧版自动保存已升级 · 已加入 agent_01','result');
      }
      return {mode:'restored'};
    } catch(error) {
      this.log(`恢复自动保存失败：${asMessage(error)}`,'error');
      try {
        await this.world.clearObjects({silent:true});
        await bootstrapWorld(this.tools,identity?.bootstrap || {});
        return {
          mode:'bootstrapped',
          warning:{code:'WORLD_SESSION_RESTORE_FAILED',message:asMessage(error)}
        };
      } catch(bootstrapError) {
        const failure=new AggregateError([error,bootstrapError],'WorldSession restore and bootstrap failed',{cause:error});
        failure.code='WORLD_SESSION_RESTORE_FAILED';
        failure.restoreError=error;
        failure.bootstrapError=bootstrapError;
        throw failure;
      }
    }
  }

  #resolveIdentity(environment=this.world.environment) {
    return resolveStudioWorldIdentity(environment,{
      builtins:this.builtins,
      fallback:this.fallback
    });
  }

  #applyIdentity(identity) {
    this.autosave.cancelPending();
    this.store.setKey(studioSceneStoreKey(identity));
    this.current=identity;
    this.onIdentityChange(identity);
    return identity;
  }

  #syncIdentity() {
    return this.#applyIdentity(this.#resolveIdentity());
  }

  #adoptExternalEnvironment() {
    if(this.busy || this.disposed) return;
    try {
      const previousIdentity=this.current;
      const identity=this.#syncIdentity();
      Promise.resolve(this.onEnvironmentChange({
        phase:'external',
        reason:'environment.replaced',
        previousEnvironment:null,
        environment:this.world.environment,
        previousIdentity,
        identity
      })).catch((error)=>this.log(`世界界面重绑定失败：${asMessage(error)}`,'error'));
    } catch(error) {
      this.log(`世界会话同步失败：${asMessage(error)}`,'error');
    }
  }

  async #runTransition(operation) {
    if(this.busy) {
      const error=new Error('WorldSession transition already in progress');
      error.code='WORLD_SESSION_BUSY';
      throw error;
    }
    this.busy=true;
    try { return await operation(); }
    finally { this.busy=false; }
  }

  #assertReady() {
    if(!this.disposed) return;
    const error=new Error('WorldSession has been disposed');
    error.code='WORLD_SESSION_DISPOSED';
    throw error;
  }
}
