import {RenderingLab} from './RenderingLab.js';
export const renderingScenarios=Object.freeze([
 {id:'rendering.scene.reference',title:'渲染参考场景',subtitle:'几何 / 光照 / RendererProbe',description:'独立的渲染诊断场景：对比基础材质并检查 GPU 后端。',setup(){}}
]);
export const labDefinition=Object.freeze({id:'rendering',title:'渲染诊断',scenarios:renderingScenarios,
 backends:[{id:'renderer',title:'当前渲染器'}],debugLayers:['grid'],defaultDebugLayers:['grid'],
 normalizeBackend:()=> 'renderer',create:options=>new RenderingLab(options)});
