import { describe, expect, it } from 'vitest';
import { collectSceneObjects } from '../../apps/studio/ui/scene/SceneExplorer.js';

describe('collectSceneObjects', () => {
  it('projects runtime objects into stable sorted scene rows and preserves selection', () => {
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
});
