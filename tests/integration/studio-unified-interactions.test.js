import { describe, expect, it, vi } from 'vitest';
import { createSession } from '../../application/createSession.js';
import { createMonumentHall } from '../../modules/world/content/monumentHall.js';
import { EditorCommandQueue } from '../../apps/studio/editor/EditorCommandQueue.js';
import { InspectorProjection } from '../../apps/studio/inspect/InspectorProjection.js';

const crate=()=>({
  schema:'agentscape.asset-recipe',schemaVersion:1,id:'studio/unseen_crate',
  parts:[{id:'box',position:[0,.2,0],geometry:{type:'box',size:[.4,.4,.4]}}],
  capabilities:{level:'physical',physics:{body:'dynamic',mass:1,friction:.5,colliders:[{shape:'box',halfExtents:[.2,.2,.2],translation:[0,.2,0]}]}}
});

async function setup(){
  const session=createSession(null,{environmentFactory:()=>createMonumentHall({loadAssets:false})});
  await session.world.init();
  const {world,scene}=session;
  await scene.addModel({id:'agent',asset:'builtin://agent',position:[0,0,0]});
  await scene.addModel({id:'unseen_crate',asset:crate(),position:[.65,0,0]});
  for(let i=0;i<30;i++)scene.step();
  const tools={call:vi.fn(()=>{throw new Error('Legacy action tool must not run');})};
  const commands=new EditorCommandQueue({scene,tools});
  const projection=new InspectorProjection({scene,world});
  return {...session,tools,commands,projection};
}

async function advance(scene,promise){
  let ended=false;
  promise.then(()=>{ended=true;},()=>{ended=true;});
  for(let i=0;i<1200&&!ended;i++){
    scene.step();
    if(i%12===0)await new Promise(resolve=>setTimeout(resolve,0));
    else await Promise.resolve();
  }
  expect(ended,'Interaction must reach a terminal SceneFacade job').toBe(true);
  return promise;
}

describe('Studio shares SceneFacade action discovery and verification with SDK and MCP',()=>{
  it('pushes a previously unknown dynamic object through the actual SceneFacade; legacy tools stay unused',async()=>{
    const {scene,world,tools,commands,projection}=await setup();
    try{
      const selected=projection.project({source:'runtime',id:'unseen_crate'});
      expect(selected).toMatchObject({actor:'agent',affordances:{source:'asset'}});
      expect(selected.affordances.actions.find(a=>a.action==='push')).toMatchObject({available:true,execution:'interaction'});
      const pushed=await advance(scene,commands.executeAffordance({actor:'agent',target:'unseen_crate',action:'push',args:{direction:[1,0,0],distance:.4}}));
      expect(pushed).toMatchObject({verification:{status:'verified'},value:{physicsVerified:true,evidenceKind:'rigid-body-force'}});
      expect(world.physics.getPosition('unseen_crate')[0]).toBeGreaterThan(.95);
      expect(tools.call).not.toHaveBeenCalled();
      expect(commands.snapshot()).toMatchObject({pending:0,revision:1,lastError:null});
    }finally{scene.close();world.dispose();}
  });

  it('keeps a blocked fixed-object action unverified instead of creating a successful editor command',async()=>{
    const {scene,world,tools,commands,projection}=await setup();
    try{
      await scene.addModel({id:'fixed_chair',asset:'builtin://chair',position:[1,0,0]});
      const selected=projection.project({source:'runtime',id:'fixed_chair'});
      expect(selected.affordances.actions.find(a=>a.action==='push')).toMatchObject({available:false,reason:'TARGET_NOT_DYNAMIC'});
      await expect(advance(scene,commands.executeAffordance({actor:'agent',target:'fixed_chair',action:'push',args:{direction:[1,0,0],distance:.3}}))).rejects.toThrow('TARGET_NOT_DYNAMIC');
      expect(tools.call).not.toHaveBeenCalled();
      expect(commands.snapshot()).toMatchObject({revision:0,pending:0});
    }finally{scene.close();world.dispose();}
  });

  it('discovers an environment contract and verifies device state through the same SceneFacade job',async()=>{
    const {scene,world,tools,commands,projection}=await setup();
    let enabled=false;
    try{
      world.environment.affordances=[{
        id:'test:lamp',label:'Lamp',kind:'switch',position:[0,1.2,.5],actions:['turn_on','turn_off'],
        read:()=>({on:enabled}),request:action=>{enabled=action==='turn_on';},
        verify:action=>enabled===(action==='turn_on'),evidenceKind:'device-state'
      }];
      const environment=projection.project({source:'environment',id:'test:lamp'});
      expect(environment).toMatchObject({actor:'agent',affordances:{source:'environment'}});
      expect(environment.affordances.actions.find(action=>action.action==='turn_on')).toMatchObject({execution:'world-action',available:true});
      const result=await advance(scene,commands.executeAffordance({actor:'agent',target:'test:lamp',action:'turn_on'}));
      expect(result).toMatchObject({verification:{status:'verified'},value:{status:'world-action-completed',physicsVerified:false}});
      expect(enabled).toBe(true);
      expect(tools.call).not.toHaveBeenCalled();
      expect(()=>scene.interact({actor:'agent',target:'test:lamp',action:'pickup'})).toThrow('ACTION_UNSUPPORTED');
    }finally{scene.close();world.dispose();}
  });
});
