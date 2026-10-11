// Presentation profiles are selected by Lab, never inferred from telemetry values.
const profile = (title, description, metrics, options = {}) => Object.freeze({
  title, description, metrics, gpu: false, defaultTab: 'run', ...options
});

export const INSPECTOR_PROFILES = Object.freeze({
  'physics-studio': profile('物理诊断', '刚体、碰撞体、约束与求解器状态。', '物理测量'),
  physics: profile('物理诊断', '兼容物理场景的运行时诊断。', '物理测量'),
  navigation: profile('导航诊断', 'NavMesh、路径、障碍与可达性。', '导航指标'),
  spatial: profile('空间查询', '射线、重叠检测与查询结果。', '空间指标'),
  interaction: profile('交互诊断', '交互状态、可见性与工具结果。', '交互指标'),
  assets: profile('3D 资产检视', '资源结构、预览与校验。', '资源指标', {defaultTab:'resources'}),
  gaussian: profile('Gaussian Splat 检视', '点云转换、加载与渲染状态。', '资源指标', {defaultTab:'resources'}),
  generation: profile('构建与集成', '生成任务、资产编译和集成验证。', '构建指标'),
  agent: profile('工具调用', '工具定义、参数和调用结果。', '工具指标', {defaultTab:'tools'}),
  'agent-trace': profile('执行轨迹', '规划步骤与执行状态。', '轨迹指标'),
  rendering: profile('渲染诊断', 'Renderer、GPU 后端与 WebGPU 诊断。', '渲染指标', {gpu:true,defaultTab:'inspect'})
});

export const inspectorProfileForLab = (labId) => INSPECTOR_PROFILES[labId] || profile('运行时检视', '当前 Lab 的运行时状态。', '测量数据');
