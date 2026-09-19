import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const { studioState } = vi.hoisted(()=>({
  studioState:{ selectedObjectId:'cup_01', contextRevision:0 }
}));

vi.mock('../../apps/studio/react/state/studioStore.ts',()=>({
  useStudioStore:(selector)=>selector(studioState)
}));

import { ObjectInspectorView } from '../../apps/studio/react/inspect/ObjectInspector.tsx';

describe('ObjectInspectorView contract', () => {
  it('keeps relation graph refresh out of the React render phase', () => {
    const describeObjectRelations=vi.fn(() => ({
      outgoing:[{ predicate:'ON', object:'table_01' }]
    }));
    const world={
      queries:{
        hasObject:vi.fn(() => true),
        getObjectInfo:vi.fn(() => ({
          id:'cup_01',
          asset:'cup',
          type:'cup',
          position:[0,1,0],
          rotation:[0,0,0],
          scale:1,
          actions:['pickup','drop']
        })),
        getBounds:vi.fn(() => ({ size:[0.3,0.3,0.3] })),
        findNearby:vi.fn(() => ['table_01']),
        describeObjectRelations
      }
    };

    const html=renderToStaticMarkup(createElement(ObjectInspectorView,{
      world,
      tools:{ call:vi.fn(async()=>null) },
      log:vi.fn()
    }));

    expect(html).toContain('cup_01');
    expect(html).toContain('附近 1 个对象');
    expect(describeObjectRelations).not.toHaveBeenCalled();
  });
});