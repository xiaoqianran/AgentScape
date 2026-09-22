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
    expect(html).toContain('RUNTIME ENTITY');
    expect(html).toContain('cup_01');
    expect(html).toContain('附近 1 个对象');
    expect(relations).not.toHaveBeenCalled();
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
    expect(html).toContain('AUTHORING NODE');
    expect(html).toContain('尚未成为 Runtime Entity');
    expect(html).toContain('AuthoringDocument');
  });
});
