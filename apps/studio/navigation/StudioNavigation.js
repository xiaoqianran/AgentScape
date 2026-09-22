export { builtInWorldUrl } from './StudioRoutes.js';

export const PRODUCT_NAVIGATION = Object.freeze([
  { page:'worlds', label:'Worlds' },
  { page:'build', label:'Build' },
  { page:'assets', label:'Assets' },
  { page:'agent', label:'Agent' },
  { page:'observatory', label:'Observatory', href:'/observatory/' }
]);

export const WORLD_EDITOR_UTILITIES = Object.freeze([
  { view:'inspect', label:'Inspect' }
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
