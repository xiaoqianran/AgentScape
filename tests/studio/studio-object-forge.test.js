import { it, expect } from 'vitest';
import { createSession } from '../../application/createSession.js';
import { createBlankWorld } from '../../modules/world/content/blankWorld.js';
import { StudioLiveBridgeClient } from '../../apps/studio/bridge/StudioLiveBridgeClient.js';

it('Studio bridge inspects and patches only one declared object',async()=>{
  const session=createSession(null,{environmentFactory:()=>createBlankWorld({id:'industrial-cabinet-lab'})});
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
    const saved=await bridge.execute({method:'save'});
    expect(saved.value.editable).toHaveLength(2);
    expect(saved.value.editable.find(item=>item.id==='box_a')).toMatchObject({
      revision:2,definition:{parts:[{geometry:{size:[1,.3,1]}}]}
    });
  }finally{
    bridge.dispose();
    session.scene.close();
    session.world.dispose();
  }
},30000);

it('uses one revision and write path for Studio material editing and MCP, rejects concurrent edits',async()=>{
  const session=createSession(null,{environmentFactory:()=>createBlankWorld({id:'industrial-cabinet-lab'})});
  await session.world.init();
  const bridge=new StudioLiveBridgeClient({scene:session.scene,world:session.world,instance:'a8b53160-85a2-42ec-89fb-f9bc0cf147bb'});
  const recipe={schema:'agentscape.asset-recipe',schemaVersion:1,id:'forge/material-box',
    parts:[{id:'body',geometry:{type:'box',size:[1,.2,1]},position:[0,.1,0]}]};
  try{
    await bridge.execute({method:'addModel',args:{model:{id:'box_a',asset:recipe,level:'visual',position:[0,0,0]}}});
    await bridge.execute({method:'addModel',args:{model:{id:'box_b',asset:recipe,level:'visual',position:[3,0,0]}}});
    const source=bridge.recipeMaterial('box_a');
    expect(source).toMatchObject({revision:1,parts:[{id:'body',material:{color:'#aaaaaa',roughness:.7,metalness:0}}]});
    const input={id:'box_a',partId:'body',assetId:source.assetId,revision:source.revision,material:{color:'#aa6633',roughness:.4,metalness:.2}};
    const pending=bridge.applyRecipeMaterial(input);
    await expect(bridge.applyRecipeMaterial({...input,material:{color:'#ffffff'}})).rejects.toMatchObject({code:'OBJECT_PATCH_BUSY'});
    await expect(pending).resolves.toMatchObject({status:'object-patch-applied',revision:2});
    const inspected=await bridge.execute({method:'objectDefinition',args:{operation:'inspect',objectId:'box_a'}});
    expect(inspected.definition.parts[0].material).toEqual(input.material);
    expect(bridge.recipeMaterial('box_b').assetId).toBe(source.assetId);
    await expect(bridge.applyRecipeMaterial(input)).rejects.toMatchObject({code:'OBJECT_REVISION_CONFLICT'});
    expect(bridge.recipeMaterial('not_found')).toBeNull();
    const preview=await bridge.execute({method:'objectDefinition',args:{operation:'preview',objectId:'box_a',expectedRevision:2,changes:[{path:'/parts/@body/material/color',value:'#334455'}]}});
    await bridge.execute({method:'objectDefinition',args:{operation:'apply',objectId:'box_a',expectedRevision:2,previewId:preview.previewId}});
    expect(bridge.recipeMaterial('box_a')).toMatchObject({revision:3,parts:[{material:{color:'#334455'}}]});
  }finally{bridge.dispose();session.scene.close();session.world.dispose();}
},30000);
