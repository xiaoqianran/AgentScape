import { describe, expect, it, vi } from 'vitest';
import { InspectorProjection } from '../../apps/studio/inspect/InspectorProjection.js';

describe('InspectorProjection',()=>{
  it('projects Runtime Entity facts through WorldQueries without leaking the World object',()=>{
    const world={
      environment:{id:'garden'},
      queries:{
        hasObject:vi.fn(()=>true),
        getObjectInfo:vi.fn(()=>({
          id:'cup_01',asset:'cup',type:'cup',
          position:[0,1,0],rotation:[0,0,0],scale:1,
          actions:['pickup']
        })),
        getBounds:vi.fn(()=>({size:[0.3,0.3,0.3]})),
        findNearby:vi.fn(()=>['table_01']),
        describeObjectRelations:vi.fn(()=>({outgoing:[
          {predicate:'ON',object:'table_01'},
          {predicate:'LEFT_OF',object:'agent_01'}
        ]}))
      }
    };
    const projection=new InspectorProjection({world});

    expect(projection.project({source:'runtime',id:'cup_01'})).toMatchObject({
      source:'runtime',
      kind:'entity',
      id:'cup_01',
      asset:'cup',
      spatial:{nearbyCount:1}
    });
    expect(world.queries.describeObjectRelations).not.toHaveBeenCalled();
    expect(projection.relations({source:'runtime',id:'cup_01'})).toEqual([
      {predicate:'ON',object:'table_01'}
    ]);
  });

  it('projects canonical AuthoringDocument nodes separately from Runtime identity',()=>{
    const world={
      queries:{
        hasObject:()=>false,
        getObjectInfo:vi.fn(),
        getBounds:vi.fn(),
        findNearby:vi.fn(),
        describeObjectRelations:vi.fn()
      }
    };
    const authoring={
      export:()=>({
        root:{
          id:'root',
          children:[{
            id:'shared_01',
            name:'Draft Chair',
            visible:true,
            components:{
              transform:{type:'Transform',properties:{position:[1,2,3],quaternion:[0,0,0,1],scale:[2,2,2]}},
              mesh:{type:'Mesh'}
            },
            children:[]
          }]
        }
      })
    };
    const projection=new InspectorProjection({world,authoring});

    expect(projection.project({source:'authoring',id:'shared_01'})).toMatchObject({
      source:'authoring',
      kind:'mesh',
      id:'shared_01',
      name:'Draft Chair',
      transform:{position:[1,2,3],scale:[2,2,2]}
    });
    expect(projection.project({source:'runtime',id:'shared_01'})).toEqual({
      source:'runtime',kind:'missing',id:'shared_01'
    });
  });
});
