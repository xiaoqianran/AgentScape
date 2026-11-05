import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const { studioState } = vi.hoisted(()=>({
  studioState:{
    editor:{ selection:{source:'runtime',id:'cup_01'}, revision:0 }
  }
}));

vi.mock('../../apps/studio/react/state/studioStore.ts',()=>({
  useStudioStore:(selector)=>selector(studioState)
}));

import { ObjectInspectorView } from '../../apps/studio/react/inspect/ObjectInspector.tsx';

const commands={
  runtimeAction:vi.fn(async()=>null),
  scaleRuntime:vi.fn(async()=>null),
  renameAuthoringNode:vi.fn(async()=>null),
  transformAuthoringNode:vi.fn(async()=>null)
};

describe('ObjectInspectorView contract', () => {
  it('renders Runtime projection without reading semantic relations during render', () => {
    const relations=vi.fn(()=>[{predicate:'ON',object:'table_01'}]);
    const projection={
      project:vi.fn(()=>({
        source:'runtime',
        kind:'entity',
        id:'cup_01',
        title:'cup_01',
        subtitle:'cup instance',
        asset:'cup',
        type:'cup',
        transform:{position:[0,1,0],rotation:[0,0,0],scale:1},
        spatial:{size:[0.3,0.3,0.3],nearbyCount:1},
        actions:['pickup','drop']
      })),
      relations
    };

    const html=renderToStaticMarkup(createElement(ObjectInspectorView,{
      projection,
      commands,
      log:vi.fn()
    }));

    expect(html).toContain('data-inspector-source="runtime"');
    expect(html).toContain('可交互对象');
    expect(html).toContain('cup_01');
    expect(html).toContain('附近 1 个对象');
    expect(relations).not.toHaveBeenCalled();
  });

  it('shows live physical affordances, blocks unavailable actions and does not present editor transforms as physics', () => {
    studioState.editor.selection={source:'runtime',id:'crate_01'};
    const projection={project:()=>({
      source:'runtime',kind:'entity',id:'crate_01',title:'Crate',subtitle:'crate instance',asset:'crate',type:'crate',
      transform:{position:[0,0,0],rotation:[0,0,0],scale:1},spatial:{size:[1,1,1],nearbyCount:0},actions:[],actor:'agent_01',
      affordances:{source:'asset',label:'Crate',evidenceKind:'physics-state',physicsVerified:false,actions:[
        {action:'inspect',execution:'query',available:true,parameters:{}},
        {action:'setTransform',execution:'editor',available:true,parameters:{}},
        {action:'push',execution:'interaction',available:true,parameters:{direction:{type:'array'},distance:{type:'number'}}},
        {action:'drag',execution:'interaction',available:false,reason:'TARGET_NOT_DYNAMIC',parameters:{}}
      ]}
    }),relations:()=>[]};
    const html=renderToStaticMarkup(createElement(ObjectInspectorView,{projection,commands,log:vi.fn()}));
    expect(html).toContain('id="affordance-choice"');
    expect(html).toContain('id="execute-affordance"');
    expect(html).toContain('物理交互');
    expect(html).toContain('推动');
    expect(html).toContain('拖动');
    expect(html).not.toContain('value="setTransform:"');
  });

  it('renders an environment affordance using the same control while keeping non-physical verification explicit', () => {
    studioState.editor.selection={source:'environment',id:'cabin:lamp'};
    const projection={project:()=>({source:'environment',kind:'environment',id:'cabin:lamp',title:'Lamp',subtitle:'Environment',actor:'agent_01',
      affordances:{source:'environment',label:'Lamp',evidenceKind:'device-state',physicsVerified:false,actions:[
        {action:'turn_on',execution:'world-action',available:false,reason:'OUT_OF_REACH',parameters:{}}
      ]}
    }),relations:()=>[]};
    const html=renderToStaticMarkup(createElement(ObjectInspectorView,{projection,commands,log:vi.fn()}));
    expect(html).toContain('data-inspector-source="environment"');
    expect(html).toContain('当前距离过远');
    expect(html).toContain('id="execute-affordance"');
    expect(html).toContain('disabled=""');
  });

  it('routes Authoring selection to a distinct Authoring inspector surface', () => {
    studioState.editor.selection={source:'authoring',id:'wall_01'};
    const projection={
      project:vi.fn(()=>({
        source:'authoring',
        kind:'mesh',
        id:'wall_01',
        title:'Wall',
        subtitle:'Authoring mesh',
        name:'Wall',
        visible:true,
        transform:{position:[1,2,3],quaternion:[0,0,0,1],scale:[1,1,1]},
        childCount:0,
        modelRef:null,
        metadata:null
      })),
      relations:vi.fn(()=>[])
    };

    const html=renderToStaticMarkup(createElement(ObjectInspectorView,{
      projection,
      commands,
      log:vi.fn()
    }));

    expect(html).toContain('data-inspector-source="authoring"');
    expect(html).toContain('创作对象');
    expect(html).toContain('尚未加入可交互世界');
    expect(html).toContain('AuthoringDocument');
  });
});
