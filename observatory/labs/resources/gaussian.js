import { ResourceLab } from './ResourceLab.js';

const scenario=Object.freeze({id:'resources.gaussian-splat',title:'Gaussian Splat',subtitle:'PLY / SPZ 转换与预览',description:'Gaussian PLY 转换为 SPZ，并通过 AgentScape 现有 Runtime Loader 进入中央 WebGPU 视口。',setup(){}});
export const labDefinition=Object.freeze({
  id:'gaussian',title:'高斯泼溅',resourceLab:true,scenarios:[scenario],
  backends:[Object.freeze({id:'spark-spz',title:'Spark → SPZ Runtime'})],debugLayers:['grid'],defaultDebugLayers:['grid'],
  normalizeBackend:()=> 'spark-spz',create:(options)=>new ResourceLab({...options,mode:'gaussian'})
});
