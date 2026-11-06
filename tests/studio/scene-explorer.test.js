import { describe, expect, it } from 'vitest';
import {
  collectSceneObjects,
  collectStudioSceneProjection
} from '../../apps/studio/scene/SceneObjectProjection.js';

describe('StudioSceneProjection', () => {
  it('projects native environment interaction identities without mistaking meshes for Runtime entities', () => {
    const projection=collectStudioSceneProjection({
      runtimeObjects:[{id:'door',asset:'door',label:'Runtime door'}],
      environment:{id:'cabin',title:'Cabin',interactions:[
        {id:'hinge',contractId:'cabin:door',label:'Front door',object:{name:'doorMesh'}},
        {id:'duplicate-hinge',contractId:'cabin:door',object:{name:'anotherMesh'}},
        {id:'lamp',object:{name:'Table lamp'}},
        {id:'visual-only',label:'Sky'}
      ]},
      selection:{source:'environment',id:'cabin:door'}
    });
    expect(projection.runtimeRows).toHaveLength(1);
    expect(projection.environmentRows.map(row=>row.id)).toEqual(['cabin','cabin:door','lamp']);
    expect(projection.environmentRows[1]).toMatchObject({
      source:'environment',kind:'environment-interaction',
      parentKey:'environment:cabin',selected:true,label:'Front door'
    });
    expect(projection.environmentRows[2].selected).toBe(false);
  });
  it('keeps the legacy runtime projection stable for non-React callers', () => {
    const store={list:()=>[
      ['table_01',{assetId:'table',manifest:{label:'Table',type:'table'}}],
      ['agent_01',{assetId:'agent',manifest:{label:'Embodied Agent',type:'agent'}}],
      ['cup_01',{assetId:'cup',manifest:{label:'Cup',type:'cup'}}]
    ]};

    expect(collectSceneObjects(store,'cup_01')).toEqual([
      {id:'agent_01',assetId:'agent',type:'agent',label:'Embodied Agent',selected:false},
      {id:'cup_01',assetId:'cup',type:'cup',label:'Cup',selected:true},
      {id:'table_01',assetId:'table',type:'table',label:'Table',selected:false}
    ]);
  });

  it('projects Runtime and Authoring identities into one tagged Studio read model without collapsing ids', () => {
    const projection=collectStudioSceneProjection({
      runtimeObjects:[
        {id:'shared_01',asset:'chair',type:'prop',label:'Runtime Chair'}
      ],
      authoringDocument:{
        root:{
          id:'root',
          children:[
            {
              id:'shared_01',
              name:'Draft Chair',
              components:{mesh:{type:'Mesh'}},
              children:[{id:'child_01',name:'Draft Child',components:{},children:[]}]
            }
          ]
        }
      },
      environment:{id:'garden-v1',title:'Garden'},
      selection:{source:'authoring',id:'shared_01'}
    });

    expect(projection.environmentRows[0]).toMatchObject({
      key:'environment:garden-v1',source:'environment',kind:'environment'
    });
    expect(projection.runtimeRows[0]).toMatchObject({
      key:'runtime:shared_01',source:'runtime',id:'shared_01',selected:false
    });
    expect(projection.authoringRows[0]).toMatchObject({
      key:'authoring:shared_01',source:'authoring',id:'shared_01',selected:true,parentKey:'authoring-root'
    });
    expect(projection.authoringRows[1]).toMatchObject({
      key:'authoring:child_01',parentKey:'authoring:shared_01'
    });
  });
});
