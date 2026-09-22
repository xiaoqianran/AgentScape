import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const { studioState } = vi.hoisted(()=>({
  studioState:{
    build:{outputs:[],selectedOutputKey:null},
    selectBuildOutput:vi.fn(),
    clearBuildOutputs:vi.fn(),
    requestBuildWorkflow:vi.fn()
  }
}));

vi.mock('../../apps/studio/react/state/studioStore.ts',()=>({
  useStudioStore:(selector)=>selector(studioState)
}));

import { ArtifactTrayView } from '../../apps/studio/react/artifacts/ArtifactTray.tsx';

const resources={
  localArtifact:()=>({descriptor:null,data:null}),
  approvedAssetIds:()=>new Set(['asset_saved']),
  approveAsset:vi.fn(async()=>null),
  onChange:()=>()=>{}
};

const controller={
  placeAsset:vi.fn(async()=>({id:'placed_01'})),
  openWorld:vi.fn(async()=>null)
};

const agentVerifier={
  supportTargets:()=>[{id:'table_01',label:'Table',surfaces:['top']}],
  run:vi.fn(async()=>({status:'verified',targetId:'placed_01',supportId:'table_01',steps:[]}))
};

describe('ArtifactTrayView contract',()=>{
  it('projects image, asset and world outputs with the correct user actions',()=>{
    studioState.build.outputs=[
      {key:'image:1',kind:'image',primaryId:'image_01',artifactIds:['image_01'],prompt:'red chair',status:'ready',routeLabel:'Modal 2D',createdAt:1},
      {key:'asset:1',kind:'asset',primaryId:'asset_saved',artifactIds:['asset_saved'],prompt:'chair mesh',status:'asset-ready',routeLabel:'Modal 3D',createdAt:2},
      {key:'world:1',kind:'world',primaryId:'world_01',artifactIds:['world_01'],prompt:'garden',status:'world-ready',routeLabel:'Modal World',createdAt:3}
    ];
    studioState.build.selectedOutputKey='asset:1';
    const html=renderToStaticMarkup(createElement(ArtifactTrayView,{
      resources,controller,agentVerifier,openBuild:vi.fn(),log:vi.fn()
    }));
    expect(html).toContain('RECENT OUTPUTS');
    expect(html).toContain('red chair');
    expect(html).toContain('继续 → 3D');
    expect(html).toContain('chair mesh');
    expect(html).toContain('放入世界');
    expect(html).toContain('已保存到 Library');
    expect(html).toContain('garden');
    expect(html).toContain('打开世界');
    expect(html).toContain('artifact-tray-item active');
  });

  it('renders the collapsed empty tray contract when no outputs exist',()=>{
    studioState.build.outputs=[];
    studioState.build.selectedOutputKey=null;
    const html=renderToStaticMarkup(createElement(ArtifactTrayView,{
      resources,controller,agentVerifier,openBuild:vi.fn(),log:vi.fn()
    }));
    expect(html).toContain('RECENT OUTPUTS');
    expect(html).toContain('artifact-tray is-collapsed');
    expect(html).toContain('aria-label="展开 Artifact Tray"');
  });
});
