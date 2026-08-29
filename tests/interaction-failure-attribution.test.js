import { expect, it, vi } from 'vitest';
import { InteractionSystem } from '../world/runtime/systems/InteractionSystem.js';

it('deduplicates object blockers at Object/Part level while preserving distinct Environment collider candidates',()=>{
  const contacts=[
    {external:true,target:{kind:'object',objectId:'crate_01',partName:'$root',colliderIndex:0}},
    {external:true,target:{kind:'object',objectId:'crate_01',partName:'$root',colliderIndex:1}},
    {external:true,target:{kind:'environment',environmentId:'monument-hall',colliderIndex:3}},
    {external:true,target:{kind:'environment',environmentId:'monument-hall',colliderIndex:7}}
  ];
  const physics={articulationContacts:vi.fn(()=>contacts)};
  const system=new InteractionSystem({store:{},physics,spatial:{},events:{emit(){}}});
  const result=system.articulationFailureAttribution('cabinet_01','door');
  expect(result).toMatchObject({status:'contact-evidence',evidence:'current-contact-at-failure'});
  expect(result.blockerCandidates).toEqual([
    {kind:'object',objectId:'crate_01',partName:'$root',colliderIndex:0},
    {kind:'environment',environmentId:'monument-hall',colliderIndex:3},
    {kind:'environment',environmentId:'monument-hall',colliderIndex:7}
  ]);
});
