import { it, expect } from 'vitest';
import { createSession } from '../../application/createSession.js';
import { createBlankWorld } from '../../modules/world/content/blankWorld.js';
import { StudioLiveBridgeClient } from '../../apps/studio/bridge/StudioLiveBridgeClient.js';

it('Studio bridge inspects and patches only one declared object',async()=>{
  const session=createSession(null,{environmentFactory:()=>createBlankWorld({id:'forge-studio-test'})});
  await session.world.init();
  const bridge=new StudioLiveBridgeClient({
    scene:session.scene,world:session.world,instance:'a8b53160-85a2-42ec-89fb-f9bc0cf147bb'
  });
  const recipe={schema:'agentscape.asset-recipe',schemaVersion:1,id:'forge/studio-box',
    parts:[{id:'body',geometry:{type:'box',size:[1,.2,1]},position:[0,.1,0]}]};
  try{
    await bridge.execute({method:'addModel',args:{mode:'add',model:{
      id:'box_a',asset:recipe,level:'visual',position:[0,0,0]
    }}});
    await bridge.execute({method:'addModel',args:{mode:'add',model:{
      id:'box_b',asset:recipe,level:'visual',position:[3,0,0]
    }}});
    const before=await bridge.execute({method:'objectDefinition',
      args:{operation:'inspect',objectId:'box_a'}});
    expect(before.revision).toBe(1);
    expect(before.analysis.observed.nodes.some(node=>node.name==='body' && node.mesh)).toBe(true);
    const preview=await bridge.execute({method:'objectDefinition',args:{
      operation:'preview',objectId:'box_a',expectedRevision:1,
      changes:[{path:'/parts/@body/geometry/size',value:[1,.3,1]}]
    }});
    expect(preview.status).toBe('object-patch-preview');
    const applied=await bridge.execute({method:'objectDefinition',args:{
      operation:'apply',objectId:'box_a',expectedRevision:1,previewId:preview.previewId
    }});
    expect(applied.status).toBe('object-patch-applied');
    const first=await bridge.execute({method:'objectDefinition',args:{
      operation:'inspect',objectId:'box_a'
    }});
    const second=await bridge.execute({method:'objectDefinition',args:{
      operation:'inspect',objectId:'box_b'
    }});
    expect(first.definition.parts[0].geometry.size).toEqual([1,.3,1]);
    expect(second.definition.parts[0].geometry.size).toEqual([1,.2,1]);
  }finally{
    bridge.dispose();
    session.scene.close();
    session.world.dispose();
  }
},30000);
