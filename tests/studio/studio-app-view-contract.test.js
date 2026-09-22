import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const { studioState } = vi.hoisted(()=>({
  studioState:{
    product:{activePage:'agent',agentView:'runs'},
    layout:{
      activeContextView:'inspect',
      contextOpen:false,
      buildAdvancedOpen:false,
      cinematic:false,
      sceneCollapsed:false
    },
    editor:{selection:{source:'runtime',id:'cup_01'},revision:0},
    view:{worldPresentation:null},
    openPage:vi.fn(),
    openAgentView:vi.fn(),
    openView:vi.fn(),
    closeContext:vi.fn(),
    setBuildAdvancedOpen:vi.fn(),
    setCinematic:vi.fn(),
    setSceneCollapsed:vi.fn()
  }
}));

vi.mock('../../apps/studio/react/state/studioStore.ts',()=>({
  useStudioStore:(selector)=>selector(studioState)
}));
vi.mock('../../apps/studio/react/generation/GenerationJobCenterView.tsx',()=>({GenerationJobCenterView:()=>null}));
vi.mock('../../apps/studio/react/developer/DeveloperSettingsView.tsx',()=>({DeveloperSettingsView:()=>null}));
vi.mock('../../apps/studio/react/scene/SceneExplorer.tsx',()=>({SceneExplorerView:()=>null}));
vi.mock('../../apps/studio/react/inspect/ObjectInspector.tsx',()=>({ObjectInspectorView:()=>null}));
vi.mock('../../apps/studio/react/build/BuildWorkbench.tsx',()=>({BuildWorkbenchView:()=>null}));
vi.mock('../../apps/studio/react/artifacts/ArtifactTray.tsx',()=>({ArtifactTrayView:()=>null}));
vi.mock('../../apps/studio/react/agent/TaskPanelView.tsx',()=>({TaskPanelView:()=>null}));
vi.mock('../../apps/studio/react/runs/RunsPanelView.tsx',()=>({RunsPanelView:()=>null}));
vi.mock('../../apps/studio/react/resources/ResourceLibraryView.tsx',()=>({ResourceLibraryView:()=>null}));
vi.mock('../../apps/studio/react/authoring/AuthoringPromotionView.tsx',()=>({AuthoringPromotionView:()=>null}));

import { StudioApp } from '../../apps/studio/react/StudioApp.tsx';

function bridge(snapshot) {
  return {
    subscribe:()=>()=>{},
    getSnapshot:()=>snapshot,
    notifyLayout:vi.fn(),
    openWorld:vi.fn(async()=>null)
  };
}

const snapshot = () => ({
  runtimeStatus:{state:'ready',label:'就绪 · WebGPU',recoveryAction:null},
  sceneControls:null,
  authoring:null,
  content:null,
  agent:null,
  commandDraft:null,
  dockActions:[]
});

describe('StudioApp contract',()=>{
  it('projects product-page navigation while keeping the World Editor mounted in the background',()=>{
    const html=renderToStaticMarkup(createElement(StudioApp,{
      bridge:bridge(snapshot()),
      environmentDefinition:{id:'monument-hall',title:'纪念大厅',number:'WORLD 01',headline:'Hall',description:'Demo world',facts:['4 Objects']},
      environments:[{id:'monument-hall',title:'纪念大厅',number:'WORLD 01'}]
    }));
    expect(html).toContain('data-page="agent"');
    expect(html).toContain('data-agent-view="runs"');
    expect(html).toContain('就绪 · WebGPU');
    expect(html).toContain('aria-label="AgentScape product"');
    expect(html).toMatch(/data-product-nav="agent"[^>]*aria-pressed="true"/);
    expect(html).toContain('href="/observatory/"');
    expect(html).toContain('aria-label="World Editor"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('id="viewport"');
    expect(html).toMatch(/data-dock-view="inspect"[^>]*class="has-selection"/);
    expect(html).toContain('data-product-page="agent"');
  });

  it('projects generated-world identity on the active World page without exposing it as a built-in switch target',()=>{
    studioState.product.activePage='world';
    studioState.product.agentView='tasks';
    studioState.layout.contextOpen=false;
    studioState.editor.selection=null;
    studioState.view.worldPresentation={id:'runtime_world',title:'Generated Garden',generated:true,persistenceSource:'artifact_world_01'};
    const html=renderToStaticMarkup(createElement(StudioApp,{
      bridge:bridge({...snapshot(),runtimeStatus:{state:'ready',label:'就绪',recoveryAction:null}}),
      environmentDefinition:{id:'monument-hall',title:'纪念大厅'},
      environments:[{id:'monument-hall',title:'纪念大厅',number:'WORLD 01'}]
    }));
    expect(html).toContain('data-world="runtime_world"');
    expect(html).toContain('data-page="world"');
    expect(html).toContain('GENERATED · Generated Garden');
    expect(html).toContain('value="runtime:artifact_world_01"');
    expect(html).toMatch(/data-product-nav="worlds"[^>]*aria-pressed="true"/);
    expect(html).toContain('aria-label="World Editor"');
    expect(html).toContain('aria-hidden="false"');
  });
});
