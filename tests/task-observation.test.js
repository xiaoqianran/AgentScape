import { describe, expect, it, vi } from 'vitest';
import { buildTaskObservation } from '../src/agent/buildTaskObservation.js';

const record=(id,type='prop')=>({
  id,assetId:id.replace(/_\d+$/,''),object:{position:{toArray:()=>[0,0,0]}},
  manifest:{type,parts:{}}
});

function runtimeFixture(){
  const records=new Map();
  records.set('agent_01',record('agent_01','agent'));
  const cabinet=record('cabinet_01','cabinet');
  cabinet.manifest.parts={door:{joint:{type:'revolute'},physics:{body:'dynamic'},targets:{open:-1,close:0}}};
  records.set('cabinet_01',cabinet);
  records.set('cup_01',record('cup_01','cup'));
  records.set('table_01',record('table_01','table'));
  for(let i=0;i<120;i++) records.set(`junk_${i}`,record(`junk_${i}`));
  const positions=new Map([
    ['agent_01',[0,0,2]],['cabinet_01',[-2,0,0]],['cup_01',[0,0,0]],['table_01',[2,0,0]]
  ]);
  const runtime={
    store:{has:(id)=>records.has(id),get:(id)=>records.get(id),list:()=>[...records.entries()]},
    physics:{getPosition:(id)=>positions.get(id) || [50,0,50]},
    locomotion:{status:vi.fn(()=>({status:'arrived',target:[-1,0,0]}))},
    interactions:{
      carryStatus:vi.fn(()=>({status:'empty',actorId:'agent_01'})),
      articulationStatus:vi.fn(()=>({
        id:'cabinet_01',parts:[{
          partName:'door',status:'action-failed',requestedAction:null,verifiedAction:'close',
          live:{coordinate:-.42,target:-1,error:.58,tolerance:.08,coordinateReference:'rest-zero-pose'},
          last:{
            status:'action-failed',reason:'STALL',targetReached:false,settled:false,progress:.41,elapsed:.8,
            attribution:{
              status:'contact-evidence',evidence:'current-contact-at-failure',
              blockerCandidates:[{kind:'object',objectId:'blocker_01',partName:'$root',colliderIndex:0}],
              contactEvidence:[{
                source:{kind:'object',objectId:'cabinet_01',partName:'door',colliderIndex:0},
                target:{kind:'object',objectId:'blocker_01',partName:'$root',colliderIndex:0},
                external:true,contactCount:2,activeContactCount:2,minDistance:-.004321,totalImpulse:3.14159,normal:[1,0,0]
              }]
            }
          }
        }]
      }))
    },
    sceneGraph:{
      update:vi.fn(),
      list:vi.fn(()=>[
        {subject:'agent_01',predicate:'NEAR',object:'cabinet_01',meta:{distance:1.23456}},
        {subject:'junk_1',predicate:'NEAR',object:'junk_2',meta:{distance:.5}},
        {subject:'cabinet_01',predicate:'NEAR',object:'cup_01',meta:{distance:1.7}}
      ])
    }
  };
  return runtime;
}

describe('compact task observation',()=>{
  it('keeps only actor and mutation-relevant objects even when the world contains many unrelated objects',()=>{
    const runtime=runtimeFixture();
    const lastMutation={
      tool:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'open'},
      outcome:{state:'failed',status:'action-failed',reason:'STALL'}
    };
    const observation=buildTaskObservation(runtime,{actor:'agent_01',lastMutation,unresolvedMutations:[lastMutation]});
    expect(observation.schema).toBe('agentscape.task-observation.v1');
    expect(observation.objects.map((item)=>item.id).sort()).toEqual(['agent_01','cabinet_01']);
    expect(observation.relations).toEqual([
      {subject:'agent_01',predicate:'NEAR',object:'cabinet_01',distance:1.235},
      {subject:'cabinet_01',predicate:'NEAR',object:'cup_01',distance:1.7}
    ]);
    expect(observation.actor).toMatchObject({id:'agent_01',position:[0,0,2],navigation:{status:'arrived'},carry:{status:'empty'}});
    expect(observation.articulation[0]).toMatchObject({
      id:'cabinet_01',parts:[{
        partName:'door',status:'action-failed',verifiedAction:'close',live:{coordinate:-.42,error:.58,tolerance:.08},
        last:{
          reason:'STALL',
          attribution:{
            status:'contact-evidence',evidence:'current-contact-at-failure',
            blockerCandidates:[{kind:'object',objectId:'blocker_01',partName:'$root',colliderIndex:0}],
            contactEvidence:[{contactCount:2,activeContactCount:2,minDistance:-.004,totalImpulse:3.142,normal:[1,0,0]}]
          }
        }
      }]
    });
    expect(observation.articulation[0].parts[0].last).not.toHaveProperty('progress');
    expect(observation.recoveryHints).toEqual([
      expect.objectContaining({action:'report-incomplete-or-retry-after-world-change',status:'provisional',basedOn:'STALL'})
    ]);
    expect(JSON.stringify(observation).length).toBeLessThan(3500);
  });

  it('focuses recovery hints on an unresolved adverse mutation when the most recent mutation already verified',()=>{
    const runtime=runtimeFixture();
    const unresolved={
      tool:'approachAndPlace',args:{actorId:'agent_01',supportId:'table_01'},
      outcome:{state:'failed',status:'place-failed',reason:'SUPPORT_NOT_REACHED'}
    };
    const last={
      tool:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'close'},
      outcome:{state:'verified',status:'action-completed',verified:true}
    };
    const observation=buildTaskObservation(runtime,{actor:'agent_01',lastMutation:last,unresolvedMutations:[unresolved]});
    expect(observation.objects.map((item)=>item.id).sort()).toEqual(['agent_01','cabinet_01','table_01']);
    expect(observation.recoveryHints[0]).toMatchObject({action:'report-unverified-or-retry-place',status:'provisional',basedOn:'SUPPORT_NOT_REACHED'});
  });
});
