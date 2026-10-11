export const WORKSPACES = Object.freeze([
  { id:'simulation', title:'仿真与验证', defaultLab:'physics-studio', tools:[
    {id:'physics-studio', title:'物理'}, {id:'navigation',title:'导航'}, {id:'spatial',title:'空间查询'}, {id:'interaction',title:'交互'}
  ]},
  { id:'assets', title:'资产检查', defaultLab:'assets', tools:[
    {id:'assets',title:'3D 资产'}, {id:'gaussian',title:'Gaussian Splat'}
  ]},
  { id:'agent', title:'智能体验证', defaultLab:'generation', tools:[
    {id:'generation',title:'构建与集成'}, {id:'agent',title:'工具调用'}, {id:'agent-trace',title:'执行轨迹'}
  ]},
  { id:'rendering', title:'渲染诊断', defaultLab:'physics-studio', tools:[
    {id:'physics-studio',title:'渲染运行场景'}
  ]}
]);
export const LEGACY_LABS = Object.freeze({physics:'physics-studio'});
export function workspaceForLab(labId) {
  return WORKSPACES.find(space=>space.id!=='rendering' && space.tools.some(tool=>tool.id===labId))?.id
    || (labId==='physics'?'simulation':null);
}
export function resolveWorkspace(workspaceId,labId) {
  const desired=WORKSPACES.find(space=>space.id===workspaceId);
  return desired && desired.tools.some(tool=>tool.id===labId) ? desired :
    WORKSPACES.find(space=>space.id===workspaceForLab(labId)) || WORKSPACES[0];
}
