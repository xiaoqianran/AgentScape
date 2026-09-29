export const AGENT_RUNTIME_TESTS = Object.freeze([
  { id:'navigation-status', title:'导航状态', detail:'检查 NavMesh 与 locomotion 是否就绪' },
  { id:'walk-to-cup', title:'走到杯子前', detail:'寻找合法交互位并真实行走' },
  { id:'walk-to-cabinet', title:'走到柜子前', detail:'Recast 路径 + Physics locomotion' },
  { id:'pickup-cup', title:'拿起杯子', detail:'Approach → Pickup → Carry verify' },
  { id:'place-cup', title:'杯子放桌上', detail:'Pickup（如需要）→ Place → settle' },
  { id:'open-cabinet', title:'打开柜门', detail:'Approach → Open → live joint verify' },
  { id:'authoring-code-world', title:'代码建世界', detail:'纯 Three.js 代码 → 失败回滚 → 重建草稿 → 晋升真实实体', wide:true },
  { id:'authoring-code-pickup', title:'拿起刚创建的杯子', detail:'走向代码建出的实体并拿起（完整闭环）', wide:true }
]);

// Deterministic demo payload for the authoring-code runtime test. The room is
// built at the world origin, which is clear both in an empty New World draft
// and in woodland-workshop (agent [0,0,3], table [2.5,0,-3], cabinet [-3,0,-5]).
const AUTHORING_ROOM_ORIGIN = [0, 0, 0];

const AUTHORING_BROKEN_CODE = `
const floor = new THREE.Mesh(
  new THREE.BoxGeometry(4, 0.2, 4),
  new THREE.StandarMaterial({ color: '#b8926a' })
);
floor.position.set(0, -0.1, 0);
scene.add(floor);
`;

const AUTHORING_ROOM_CODE = `
const room = new THREE.Group();
room.add(new THREE.AmbientLight(0xffffff, 0.65));
const sun = new THREE.DirectionalLight(0xfff2df, 1.4);
sun.position.set(5, 8, 4);
room.add(sun);
const floor = new THREE.Mesh(
  new THREE.BoxGeometry(4, 0.2, 4),
  new THREE.MeshStandardMaterial({ color: '#b8926a' })
);
floor.position.set(0, -0.1, 0);
room.add(floor);
for (const [x, z, w, d] of [[0, -2, 4.2, 0.2], [0, 2, 4.2, 0.2], [-2, 0, 0.2, 4], [2, 0, 0.2, 4]]) {
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(w, 2.4, d),
    new THREE.MeshStandardMaterial({ color: '#e8e2d4' })
  );
  wall.position.set(x, 1.2, z);
  room.add(wall);
}
const cup = new THREE.Group();
cup.name = 'desk-cup';
cup.userData.authoringId = 'desk-cup';
cup.position.set(0.6, 0.35, 0);
modelRef(cup, { assetRef: { assetId: 'cup' } });
room.add(cup);
room.position.set(${AUTHORING_ROOM_ORIGIN[0]}, 0, ${AUTHORING_ROOM_ORIGIN[2]});
scene.add(room);
`;

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
      case 'authoring-code-world': {
        // The cup asset must exist in the reusable catalog (works in a New World draft too).
        const search=await this.#call('searchAssets',{query:'cup'},(r)=>Array.isArray(r?.results || r));
        const results=search?.results || search || [];
        if(!results.some((asset)=>asset?.id==='cup')) {
          throw new Error('资产目录中没有 cup，无法完成演示。');
        }
        // Step 1: broken code must fail, roll the draft back and report the error verbatim.
        const failed=await this.#call('runAuthoringCode',{code:AUTHORING_BROKEN_CODE,label:'study room (broken)'},(r)=>r?.status==='authoring-code-failed'&&r?.reason==='AUTHORING_CODE_EXECUTION_ERROR');
        // Step 2: fixed code builds the visible draft and commits an agent-code revision.
        const applied=await this.#call('runAuthoringCode',{code:AUTHORING_ROOM_CODE,label:'study room'},(r)=>r?.status==='authoring-code-applied'&&r?.revision?.created===true);
        // Step 3: promote the authored cup into a real physics-backed world entity.
        const promoted=await this.#call('promoteAuthoringNode',{nodeId:'desk-cup',usage:'movable'},(r)=>['authoring-promoted','authoring-provisional'].includes(r?.status));
        // Step 4: verify the entity landed at the authored spot.
        const after=await this.#call('listObjects',{},(r)=>Array.isArray(r)&&r.some((object)=>object.id===promoted.entityId));
        const entity=after.find((object)=>object.id===promoted.entityId);
        if(!entity || Math.abs(entity.position[0]-AUTHORING_ROOM_ORIGIN[0])>1.5 || Math.abs(entity.position[2]-AUTHORING_ROOM_ORIGIN[2])>1.5) {
          throw new Error(`晋升实体位置异常：${JSON.stringify(entity?.position)}`);
        }
        return {status:'completed',failed,applied,promoted,entity:{id:entity.id,asset:entity.asset,position:entity.position}};
      }
      case 'authoring-code-pickup': {
        // Embodied interaction needs a navigation-ready world with an agent body;
        // an empty New World draft has neither.
        const navigation=await this.#call('getNavigationStatus',{},()=>true);
        if(navigation?.state!=='ready') {
          throw new Error('当前世界没有就绪的导航网格；请切换到「林间工坊」并先运行「代码建世界」，再运行本验收。');
        }
        // Find the cup entity created by the authoring-code-world test (not the bootstrap cup_01).
        const objects=await this.#call('listObjects',{},(r)=>Array.isArray(r));
        const target=objects.find((object)=>object.asset==='cup'&&object.id!=='cup_01');
        if(!target) {
          throw new Error('未找到代码创建的杯子，请先运行「代码建世界」验收。');
        }
        const pickup=await this.#call('approachAndPickup',{actorId:this.actorId,targetId:target.id,speed:2},(r)=>r?.status==='held');
        const carry=await this.#call('getCarryStatus',{actorId:this.actorId},(r)=>r?.status==='held'&&r?.targetId===target.id);
        return {status:'completed',targetId:target.id,pickup,carry};
      }
      default: throw new Error(`Unknown Agent Runtime test: ${id}`);
    }
  }
}
