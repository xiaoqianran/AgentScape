import { findEnvironment } from '../../../../modules/world/content/environments.js';

// Human-facing copy only; all registered builtin worlds use the same preview convention.
const presentations:Record<string,{ title:string; description:string; category:string }> = {
  'magic-cabin': { title:'魔女小屋', description:'探索两层小屋、旋转楼梯与可以互动的日常物件。', category:'室内 · 物件交互' },
  'woodland-workshop': { title:'林间工坊', description:'在开放工坊与林间庭院中放置物体、编辑空间。', category:'户外 · 自由创作' },
  'monument-hall': { title:'纪念大厅', description:'在开阔大厅中体验物理放置、路径规划和智能体任务。', category:'室内 · 智能体入门' },
  'ruined-courtyard': { title:'遗迹庭院', description:'穿行拱廊与错层露台，探索有高低变化的空间。', category:'户外 · 多层空间' },
  'grand-urban-block': { title:'城市街区', description:'沿街道、广场与建筑群探索更大尺度的世界。', category:'城市 · 大尺度场景' }
};
export function worldPresentation(world:{ id:string; title?:string; description?:string }) {
  const entry=presentations[world.id];
  return { title:entry?.title || world.title || world.id, description:entry?.description || world.description || '', category:entry?.category || '自定义世界', preview:findEnvironment(world.id) ? '/previews/worlds/' + world.id + '.webp' : null };
}
