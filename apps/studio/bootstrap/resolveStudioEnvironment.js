import { resolveEnvironment } from '../../../modules/world/content/environments.js';
import { loadGeneratedWorld, loadGeneratedWorldManifest } from '../../../modules/world/generated/GeneratedWorldLoader.js';

export function resolveStudioEnvironment(params) {
  const generatedWorldManifest = params.get('worldManifest');
  if (generatedWorldManifest) {
    return {
      id:'generated-world',
      number:'GENERATED',
      title:'生成世界',
      headline:'运行外部生成世界。',
      description:'从统一 Runtime Manifest 加载外部生成世界。',
      facts:['WORLD MANIFEST','RAPIER','RECAST / DETOUR'],
      bootstrap:{agent:[0,0,0]},
      coffeeCorner:{},
      load:async()=>async()=>loadGeneratedWorldManifest(generatedWorldManifest)
    };
  }

  const generatedMesh = params.get('mesh');
  if (generatedMesh) {
    return {
      id:'generated-world',
      number:'GENERATED',
      title:'生成世界',
      headline:'运行外部生成世界。',
      description:'外部生成文件直接进入 AgentScape 现有渲染、物理与导航运行时。',
      facts:['GENERATED MESH','RAPIER','RECAST / DETOUR'],
      bootstrap:{agent:[0,0,0]},
      coffeeCorner:{},
      load:async()=>async()=>loadGeneratedWorld({
        mesh:generatedMesh,
        visual:params.get('visual'),
        semantics:params.get('semantics'),
        coordinateSystem:params.get('up') === 'z' ? 'z-up' : 'y-up'
      })
    };
  }

  return resolveEnvironment(params.get('world'));
}
