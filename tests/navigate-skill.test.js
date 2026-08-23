import { expect, it, vi } from 'vitest';
import { SkillRegistry } from '../src/skills/SkillRegistry.js';
import { registerCoreSkills } from '../src/skills/registerCoreSkills.js';

it('keeps navigateTo inside the mutation transaction until locomotion resolves', async () => {
  let finish;
  const deferred=new Promise((resolve)=>{finish=resolve;});
  const order=[];
  const runtime={
    locomotion:{navigate:vi.fn(()=>deferred),status:vi.fn(()=>({status:'moving'}))},
    mutate:vi.fn(async(_label,operation)=>{order.push('begin');const result=await operation();order.push('commit');return result;})
  };
  const registry=registerCoreSkills(new SkillRegistry({runtime}),runtime);
  const pending=registry.invoke('navigateTo',{id:'agent_01',end:[3,0,0]},{profile:'builder'});
  await Promise.resolve(); await Promise.resolve();
  expect(order).toEqual(['begin']);
  finish({status:'arrived',id:'agent_01'});
  const result=await pending;
  expect(result).toMatchObject({success:true,result:{status:'arrived',id:'agent_01'}});
  expect(order).toEqual(['begin','commit']);
  expect(runtime.locomotion.navigate).toHaveBeenCalledWith('agent_01',[3,0,0],{speed:undefined});
});
