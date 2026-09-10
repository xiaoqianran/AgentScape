import { ResourceLab } from './ResourceLab.js';

const scenario=Object.freeze({id:'resources.asset-catalog',title:'资产预览',subtitle:'AssetCatalog 浏览与预览',description:'从 AssetCatalog 选择资产并在真实 Runtime Loader 中预览；GLB 需经过 AssetCompiler 和 Admission 后才会注册。',setup(){}});
export const labDefinition=Object.freeze({
  id:'assets',title:'资产目录',resourceLab:true,scenarios:[scenario],
  backends:[Object.freeze({id:'runtime',title:'Asset Runtime'})],debugLayers:['grid'],defaultDebugLayers:['grid'],
  normalizeBackend:()=> 'runtime',create:(options)=>new ResourceLab({...options,mode:'assets'})
});
