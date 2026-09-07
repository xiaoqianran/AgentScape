const GOOD_STATES=new Set(['verified','accepted']);

const clone=(value)=>value==null?value:structuredClone(value);
const clean=(value)=>String(value||'').trim();

function reasonOf(result,outcome,error=null){
  return error?.code||outcome?.reason||result?.reason||result?.code||error?.message||null;
}

export class AssetAgentVerifier {
  constructor({world,tools,actorId='agent_01',log=()=>{}}={}){
    if(!world?.store?.get||!world?.events?.emit) throw new TypeError('AssetAgentVerifier requires WorldRuntime');
    if(!tools?.call||!tools?.executionPolicy) throw new TypeError('AssetAgentVerifier requires AgentTools');
    this.world=world;
    this.tools=tools;
    this.actorId=clean(actorId)||'agent_01';
    this.log=log;
  }

  supportTargets(){
    return this.world.store.list()
      .map(([id,record])=>({
        id,
        label:record.manifest?.label||record.manifest?.type||record.assetId||id,
        surfaces:(record.manifest?.surfaces||[]).map((surface)=>surface.id).filter(Boolean)
      }))
      .filter((item)=>item.surfaces.length)
      .sort((a,b)=>a.id==='table_01'?-1:b.id==='table_01'?1:a.id.localeCompare(b.id));
  }

  async run({targetId,supportId=null,surfaceId=null,speed=2.5,onStep=()=>{}}={}){
    const target=clean(targetId);
    if(!target) throw new Error('缺少待验证的 Asset Instance ID');
    if(!this.world.store.has(target)) throw Object.assign(new Error(`世界中不存在对象：${target}`),{code:'AGENT_TEST_TARGET_MISSING'});
    if(!this.world.store.has(this.actorId)) throw Object.assign(new Error(`世界中不存在 Agent：${this.actorId}`),{code:'AGENT_TEST_ACTOR_MISSING'});

    const supports=this.supportTargets().filter((item)=>item.id!==target);
    const chosen=supports.find((item)=>item.id===supportId)||supports[0]||null;
    if(!chosen) throw Object.assign(new Error('当前世界没有可用于 Place 验证的支撑面对象'),{code:'AGENT_TEST_SUPPORT_MISSING'});
    const chosenSurface=chosen.surfaces.includes(surfaceId)?surfaceId:chosen.surfaces[0];
    const steps=[];
    const emit=(entry)=>{
      const value={...entry,index:steps.length};
      steps.push(value);
      onStep(clone(value),clone(steps));
      this.world.events.emit('studio.agent-asset-verification-step',clone(value));
      return value;
    };
    const replaceLast=(patch)=>{
      steps[steps.length-1]={...steps[steps.length-1],...patch};
      onStep(clone(steps[steps.length-1]),clone(steps));
      this.world.events.emit('studio.agent-asset-verification-step',clone(steps[steps.length-1]));
      return steps[steps.length-1];
    };
    const call=async({id,label,tool,args,accept=null})=>{
      emit({id,label,tool,state:'running',status:'running',result:null,reason:null});
      try{
        const result=await this.tools.call(tool,args);
        const outcome=this.tools.executionPolicy(tool,result)?.outcome||{state:'accepted',verified:false,status:result?.status||null};
        const accepted=accept?Boolean(accept(result,outcome)):GOOD_STATES.has(outcome.state);
        replaceLast({state:accepted?outcome.state:(GOOD_STATES.has(outcome.state)?'failed':outcome.state),status:outcome.status||result?.status||null,result:clone(result),reason:accepted?null:reasonOf(result,outcome)});
        if(!accepted){
          const error=new Error(`${label} 未通过验证${reasonOf(result,outcome)?`：${reasonOf(result,outcome)}`:''}`);
          error.code=reasonOf(result,outcome)||'AGENT_TEST_STEP_FAILED';
          error.step=id;
          error.result=result;
          throw error;
        }
        return result;
      }catch(error){
        if(steps.at(-1)?.state==='running') replaceLast({state:'error',status:'error',reason:reasonOf(null,null,error),error:{code:error.code||null,message:error.message}});
        throw error;
      }
    };

    const startedAt=Date.now();
    this.world.events.emit('studio.agent-asset-verification-started',{actorId:this.actorId,targetId:target,supportId:chosen.id,surfaceId:chosenSurface});
    this.log(`Agent Asset Test 开始：${this.actorId} → ${target} → ${chosen.id}`,'plan');
    try{
      const pickupPose=await call({
        id:'navigate-plan',label:'寻找目标交互位',tool:'findInteractionPose',args:{actorId:this.actorId,targetId:target},
        accept:(result)=>Boolean(result?.position)&&['current-pose','approach-pose'].includes(result?.status)
      });
      await call({
        id:'navigate',label:'Navigate 到 Asset',tool:'navigateTo',args:{id:this.actorId,end:pickupPose.position,speed},
        accept:(result,outcome)=>result?.status==='arrived'&&outcome?.state==='verified'
      });
      await call({
        id:'pickup',label:'Pickup Asset',tool:'approachAndPickup',args:{actorId:this.actorId,targetId:target,speed},
        accept:(result,outcome)=>result?.status==='held'&&outcome?.state==='verified'
      });
      await call({
        id:'carry-check',label:'验证 Carry ownership',tool:'getCarryStatus',args:{actorId:this.actorId},
        accept:(result)=>result?.status==='held'&&result?.targetId===target
      });
      const placePose=await call({
        id:'carry-plan',label:'寻找支撑面交互位',tool:'findInteractionPose',args:{actorId:this.actorId,targetId:chosen.id},
        accept:(result)=>Boolean(result?.position)&&['current-pose','approach-pose'].includes(result?.status)
      });
      await call({
        id:'carry',label:'Carry 到支撑面',tool:'navigateTo',args:{id:this.actorId,end:placePose.position,speed},
        accept:(result,outcome)=>result?.status==='arrived'&&outcome?.state==='verified'
      });
      const placed=await call({
        id:'place',label:'Place + Physics settle',tool:'approachAndPlace',args:{actorId:this.actorId,supportId:chosen.id,surfaceId:chosenSurface,speed},
        accept:(result,outcome)=>result?.status==='placed'&&result?.supportVerified===true&&result?.settled===true&&outcome?.state==='verified'
      });
      const relations=await call({
        id:'verify',label:'验证 ON relation',tool:'listRelations',args:{subject:target,predicate:'ON',object:chosen.id},
        accept:(result)=>Array.isArray(result)&&result.some((edge)=>!chosenSurface||!edge?.meta?.surfaceId||edge.meta.surfaceId===chosenSurface)
      });
      const result={
        status:'verified',actorId:this.actorId,targetId:target,supportId:chosen.id,surfaceId:chosenSurface,
        startedAt,completedAt:Date.now(),durationMs:Date.now()-startedAt,steps:clone(steps),placed:clone(placed),relations:clone(relations)
      };
      this.world.events.emit('studio.agent-asset-verification-completed',clone(result));
      this.log(`Agent Asset Test VERIFIED：${target} → ${chosen.id}`,'result');
      return result;
    }catch(error){
      const result={
        status:'failed',actorId:this.actorId,targetId:target,supportId:chosen.id,surfaceId:chosenSurface,
        startedAt,completedAt:Date.now(),durationMs:Date.now()-startedAt,failedStep:error.step||steps.at(-1)?.id||null,
        reason:error.code||error.message,steps:clone(steps)
      };
      this.world.events.emit('studio.agent-asset-verification-failed',clone(result));
      this.log(`Agent Asset Test FAILED：${target} · ${result.reason}`,'error');
      return result;
    }
  }
}
