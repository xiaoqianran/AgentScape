export { builtInWorldUrl } from './StudioRoutes.js';

export const PRODUCT_NAVIGATION = Object.freeze([
  { page:'worlds', label:'世界' },
  { page:'build', label:'生成' },
  { page:'assets', label:'资源库' },
  { page:'agent', label:'智能体' },
  { page:'observatory', label:'实验室', href:'/observatory/' }
]);

export const WORLD_EDITOR_UTILITIES = Object.freeze([
  { view:'inspect', label:'属性' }
]);

export function pageForStudioView(view) {
  if (view === 'create') return 'build';
  if (view === 'resources') return 'assets';
  if (view === 'task' || view === 'runs') return 'agent';
  return 'world';
}

export function agentViewForStudioView(view) {
  return view === 'runs' ? 'runs' : 'tasks';
}
