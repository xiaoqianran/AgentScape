export const AGENT_RUNTIME_TESTS = Object.freeze([
  { id:'navigation-status', title:'导航状态', detail:'检查 NavMesh 与 locomotion 是否就绪' },
  { id:'walk-to-cup', title:'走到杯子前', detail:'寻找合法交互位并真实行走' },
  { id:'walk-to-cabinet', title:'走到柜子前', detail:'Recast 路径 + Physics locomotion' },
  { id:'pickup-cup', title:'拿起杯子', detail:'Approach → Pickup → Carry verify' },
  { id:'place-cup', title:'杯子放桌上', detail:'Pickup（如需要）→ Place → settle' },
  { id:'open-cabinet', title:'打开柜门', detail:'Approach → Open → live joint verify' }
]);

const accepted = (result, statuses) => statuses.includes(result?.status);

export class AgentRuntimeTestRunner {
  constructor({ tools, actorId='agent_01', log=()=>{} }={}) {
    if (!tools?.call) throw new TypeError('AgentRuntimeTestRunner requires AgentTools');
    this.tools=tools;
    this.actorId=actorId;
    this.log=log;
  }
  async #call(tool,args,accept=()=>true) {
    this.log(`Runtime · ${tool}`,'');
    const result=await this.tools.call(tool,args);
    if(!accept(result)) {
      const failedPhase=result?.transfer?.phases?.find((phase)=>phase?.clear===false||phase?.sweep?.clear===false||phase?.pose?.clear===false);
      const blocked=result?.transfer?.blockedBy||failedPhase?.blockedBy||failedPhase?.sweep?.blockedBy||failedPhase?.pose?.blockedBy||result?.blockedBy||result?.transfer?.direct?.blockedBy||[];
      const detail=[result?.status,result?.reason,result?.transfer?.reason,failedPhase?.phase?`phase=${failedPhase.phase}`:null,blocked.length?`blockedBy=${blocked.join(',')}`:null].filter(Boolean).join(' · ');
      throw new Error(`${tool} 未通过：${detail || 'unknown'}`);
    }
    return result;
  }
  async #walkTo(targetId) {
    const pose=await this.#call('findInteractionPose',{actorId:this.actorId,targetId},(r)=>Array.isArray(r?.position));
    const navigation=await this.#call('navigateTo',{id:this.actorId,end:pose.position,speed:2},(r)=>accepted(r,['arrived']));
    const locomotion=await this.#call('getLocomotionStatus',{id:this.actorId});
    return {status:'completed',targetId,pose,navigation,locomotion};
  }
  async run(id) {
    switch(id) {
      case 'navigation-status': {
        const navigation=await this.#call('getNavigationStatus',{},(r)=>r?.state==='ready');
        const locomotion=await this.#call('getLocomotionStatus',{id:this.actorId},(r)=>Boolean(r?.status)&&r.status!=='missing');
        return {status:'completed',navigation,locomotion};
      }
      case 'walk-to-cup': return this.#walkTo('cup_01');
      case 'walk-to-cabinet': return this.#walkTo('cabinet_01');
      case 'pickup-cup': {
        const pickup=await this.#call('approachAndPickup',{actorId:this.actorId,targetId:'cup_01',speed:2},(r)=>r?.status==='held');
        const carry=await this.#call('getCarryStatus',{actorId:this.actorId},(r)=>r?.status==='held'&&r?.targetId==='cup_01');
        return {status:'completed',pickup,carry};
      }
      case 'place-cup': {
        let carry=await this.#call('getCarryStatus',{actorId:this.actorId});
        if(carry?.status!=='held'||carry?.targetId!=='cup_01') {
          await this.#call('approachAndPickup',{actorId:this.actorId,targetId:'cup_01',speed:2},(r)=>r?.status==='held');
          carry=await this.#call('getCarryStatus',{actorId:this.actorId},(r)=>r?.status==='held'&&r?.targetId==='cup_01');
        }
        const place=await this.#call('approachAndPlace',{actorId:this.actorId,supportId:'table_01',surfaceId:'top',speed:2},(r)=>r?.status==='placed'&&r?.supportVerified===true&&r?.settled===true);
        const after=await this.#call('getCarryStatus',{actorId:this.actorId},(r)=>r?.status==='empty');
        return {status:'completed',carry,place,after};
      }
      case 'open-cabinet': {
        const interaction=await this.#call('approachAndInteract',{actorId:this.actorId,targetId:'cabinet_01',action:'open',speed:2},(r)=>r?.status==='action-completed'&&r?.targetReached===true&&r?.settled===true);
        const articulation=await this.#call('getArticulationStatus',{id:'cabinet_01'},(r)=>Array.isArray(r?.parts)&&r.parts.some((part)=>part?.verifiedAction==='open'&&part?.status==='action-completed'));
        return {status:'completed',interaction,articulation};
      }
      default: throw new Error(`Unknown Agent Runtime test: ${id}`);
    }
  }
}
