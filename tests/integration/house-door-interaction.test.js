import { expect, it } from 'vitest';
import { createSession } from '../../application/createSession.js';
import { AgentTools } from '../../application/AgentTools.js';
import { bootstrapWorld } from '../../modules/agent/bootstrapWorld.js';
import { createBlankWorld } from '../../modules/world/content/blankWorld.js';
import { ENVIRONMENTS } from '../../modules/world/content/environments.js';

async function finish(scene, job, limit=2500) {
  for(let n=0;n<limit && scene.getJob(job.id).status==='running';n++) {
    scene.step();
    if(n%12===0) await new Promise(resolve=>setTimeout(resolve,0));
    else await Promise.resolve();
  }
  expect(scene.getJob(job.id).status).not.toBe('running');
  return scene.waitJob(job.id);
}

it('Agent 自主开门并进入房屋',async()=>{
  const definition=ENVIRONMENTS.find(value=>value.id==='house-door-world');
  const session=createSession(null,{environmentFactory:()=>createBlankWorld({id:'house-door-world'})});
  await session.world.init();
  const {world,scene}=session;
  try {
    await bootstrapWorld(new AgentTools(world,{actor:'agent_01',profile:'builder',source:'test'}),definition.bootstrap);
    const action=scene.inspect('house_door_01',{actor:'agent_01'}).actions.find(value=>value.action==='open');
    expect(action).toMatchObject({canApproach:true,partName:'door'});
    const result=await finish(scene,scene.interact({actor:'agent_01',target:'house_door_01',action:'open',partName:'door'}));
    expect(result).toMatchObject({status:'succeeded',result:{verification:{status:'verified'},value:{targetReached:true,settled:true,locomotion:{status:'arrived'}}}});
    expect(world.physics.getArticulationState('house_door_01','door').coordinate).toBeCloseTo(1.45,1);
    expect(world.physics.articulationPenetrations('house_door_01','door',{refresh:true})).toEqual([]);

    const entry=await finish(scene,scene.interact({actor:'agent_01',action:'navigate',position:[4,0,-4]}));
    expect(entry).toMatchObject({status:'succeeded',result:{verification:{status:'verified'},value:{status:'arrived'}}});
    expect(world.physics.getPosition('agent_01')[2]).toBeLessThan(-3.2);
  }finally{scene.close();world.dispose();}
},30000);