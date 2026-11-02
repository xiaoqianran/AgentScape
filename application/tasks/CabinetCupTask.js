import { ENVIRONMENTS } from '../../modules/world/content/environments.js';

// These are task layouts, not a claim that every default bootstrap supports this task.
export const CABINET_CUP_TASK_WORLDS = Object.freeze(['monument-hall', 'woodland-workshop', 'magic-cabin']);
export const CABINET_CUP_TASK_REFS = Object.freeze({ actorId:'agent_01', cabinetId:'cabinet_01', cupId:'cup_01', supportId:'table_01', surfaceId:'top' });
export const CABINET_CUP_TASK_CRITERIA = Object.freeze([
  {id:'world-valid',kind:'world-valid'},
  {id:'cabinet-open',kind:'interaction-verified',targetId:'cabinet_01',capability:'OPEN'},
  {id:'cup-picked-up',kind:'interaction-verified',targetId:'cup_01',capability:'PICKUP'},
  {id:'cup-placed',kind:'interaction-verified',targetId:'table_01',capability:'PLACE'},
  {id:'cup-on-table',kind:'relation-exists',subject:'cup_01',predicate:'ON',object:'table_01',surfaceId:'top'},
  {id:'no-unresolved',kind:'no-unresolved'}
]);

export function createCabinetCupTaskWorldIR(worldId, { revisionId = `cabinet-cup-${worldId}` } = {}) {
  if (!CABINET_CUP_TASK_WORLDS.includes(worldId)) {
    const error = new Error('此世界尚未验收柜内取杯任务，请选择纪念大厅、林间工坊或魔女小屋。');
    error.code = 'TASK_WORLD_UNSUPPORTED';
    throw error;
  }
  const boot = ENVIRONMENTS.find((world) => world.id === worldId).bootstrap;
  // Woodland's declared spawn intersects scenery. Reuse the existing composer for all its poses.
  const pose = (id) => worldId === 'woodland-workshop' ? {} : {transform:{position:[...boot[id]]}};
  return {
    schema:'agentscape.world-ir',schemaVersion:1,
    revision:{id:revisionId,reason:'内置资产标准任务：柜内杯子放桌面'},
    provenance:{source:'cabinet-cup-task',createdBy:'AgentScape',evidenceRefs:[]},
    intent:{name:'柜内取杯',description:'打开柜门，取出柜内杯子，搬运并放在桌面，验证放置稳定。'},
    policy:{generation:{generate:false},physics:{fallbackPolicy:'deny'}},
    entities:[
      {id:'agent_01',asset:{assetId:'agent'},...pose('agent'),capabilityIntent:[],initialState:{}},
      {id:'cabinet_01',asset:{assetId:'cabinet'},...pose('cabinet'),capabilityIntent:['OPEN'],initialState:{}},
      {id:'cup_01',asset:{assetId:'cup'},capabilityIntent:['PICKUP'],initialState:{}},
      {id:'table_01',asset:{assetId:'table'},...pose('table'),capabilityIntent:[],initialState:{}}
    ],
    spatial:{relations:[{subject:'cup_01',predicate:'INSIDE',object:'cabinet_01',receptacleId:'interior'}],constraints:[]},
    interactions:[
      {id:'open-cabinet',actorId:'agent_01',targetId:'cabinet_01',capability:'OPEN'},
      {id:'pickup-cup',actorId:'agent_01',targetId:'cup_01',capability:'PICKUP'},
      {id:'place-cup',actorId:'agent_01',supportId:'table_01',capability:'PLACE'}
    ],rules:[],acceptance:[]
  };
}

// Read-only initial-state gate. Retries use fresh observations instead of rebuilding this scene.
export async function inspectCabinetCupTask(runtime) {
  const refs = {...CABINET_CUP_TASK_REFS};
  const stages = [], reasons = [];
  const check = (stage, ok, code, message) => {
    stages.push({stage,ok,code:ok ? null : code});
    if (!ok) reasons.push({code,message});
    return ok;
  };
  for (const [key,label] of [['actorId','智能体'],['cabinetId','柜子'],['cupId','杯子'],['supportId','桌子']]) {
    check(`exists:${key}`,runtime.store.has(refs[key]),'TASK_OBJECT_MISSING',`缺少${label}（${refs[key]}），请准备标准任务场景。`);
  }
  if (reasons.length) return {supported:false,refs,stages,reasons};
  const cup = runtime.store.get(refs.cupId);
  const cabinet = runtime.store.get(refs.cabinetId);
  const table = runtime.store.get(refs.supportId);
  check('cabinet-receptacle',cabinet.manifest.receptacles?.some((item)=>item.id === 'interior'),'TASK_RECEPTACLE_MISSING','柜子缺少可用的内部容器。');
  check('support-surface',table.manifest.surfaces?.some((item)=>item.id === refs.surfaceId),'TASK_SURFACE_MISSING','桌子缺少可用的支撑面。');
  check('cabinet-open-action',cabinet.manifest.actions?.includes('open'),'TASK_ACTION_UNSUPPORTED','此柜子没有开门能力。');
  check('cup-actions',['pickup','place'].every((action)=>cup.manifest.actions?.includes(action)),'TASK_ACTION_UNSUPPORTED','此杯子没有拿取和放置能力。');
  if (reasons.length) return {supported:false,refs,stages,reasons};
  check('cup-in-cabinet',!cup.state?.heldBy && runtime.spatial.containmentGeometry(refs.cupId,refs.cabinetId,{receptacleId:'interior'}).inside === true,'TASK_CUP_NOT_IN_CABINET','杯子当前不在柜内；请准备标准任务场景，或针对当前杯子发起其他任务。');
  for (const targetId of [refs.cabinetId,refs.supportId]) {
    try {
      const pose = await runtime.interactions.findInteractionPose(refs.actorId,targetId,targetId === refs.cabinetId ? {action:'open'} : {});
      check(`reachable:${targetId}`,Boolean(pose.position),'TASK_PATH_UNREACHABLE',`智能体无法到达${targetId}，请检查门和障碍物。`);
    } catch (error) {
      check(`reachable:${targetId}`,false,error.reason || error.code || 'TASK_PATH_UNREACHABLE',`智能体没有可达的交互位置（${targetId}），请检查门和障碍物。`);
    }
  }
  return {supported:reasons.length === 0,refs,stages,reasons};
}
