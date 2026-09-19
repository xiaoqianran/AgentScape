import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const { studioState } = vi.hoisted(()=>({
  studioState:{
    activeWorkspace:'agent',
    activeContextView:'runs',
    contextOpen:true,
    buildAdvancedOpen:false,
    selectedObjectId:'cup_01',
    worldPresentation:null,
    openView:vi.fn(),
    closeContext:vi.fn(),
    setBuildAdvancedOpen:vi.fn()
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

import { StudioApp } from '../../apps/studio/react/StudioApp.tsx';

function bridge(snapshot) {
  return {
    subscribe:()=>()=>{},
    getSnapshot:()=>snapshot,
    notifyLayout:vi.fn(),
    openWorld:vi.fn(async()=>null)
  };
}

describe('StudioApp contract',()=>{
  it('projects workspace/context selection, runtime status and selected-object dock state',()=>{
    const html=renderToStaticMarkup(createElement(StudioApp,{
      bridge:bridge({
        runtimeStatus:{state:'ready',label:'就绪 · WebGPU',recoveryAction:null},
        sceneControls:null,
        authoring:null,
        content:null,
        agent:null,
        commandDraft:null,
        dockActions:[]
      }),
      environmentDefinition:{id:'monument-hall',title:'纪念大厅',number:'WORLD 01',headline:'Hall',description:'Demo world',facts:['4 Objects']},
      environments:[{id:'monument-hall',title:'纪念大厅',number:'WORLD 01'}]
    }));
    expect(html).toContain('data-workspace="agent"');
    expect(html).toContain('data-context-view="runs"');
    expect(html).toContain('就绪 · WebGPU');
    expect(html).toContain('data-dock-view="task"');
    expect(html).toMatch(/data-dock-view="task"[^>]*aria-pressed="true"/);
    expect(html).toMatch(/data-dock-view="runs"[^>]*aria-pressed="true"/);
    expect(html).toMatch(/data-dock-view="inspect"[^>]*class="has-selection"/);
    expect(html).toContain('4 Objects');
  });

  it('projects generated-world identity without exposing it as a built-in world switch target',()=>{
    studioState.activeWorkspace='world';
    studioState.activeContextView='create';
    studioState.contextOpen=false;
    studioState.selectedObjectId=null;
    studioState.worldPresentation={id:'runtime_world',title:'Generated Garden',generated:true,persistenceSource:'artifact_world_01'};
    const html=renderToStaticMarkup(createElement(StudioApp,{
      bridge:bridge({
        runtimeStatus:{state:'ready',label:'就绪',recoveryAction:null},
        sceneControls:null,
        authoring:null,
        content:null,
        agent:null,
        commandDraft:null,
        dockActions:[]
      }),
      environmentDefinition:{id:'monument-hall',title:'纪念大厅'},
      environments:[{id:'monument-hall',title:'纪念大厅',number:'WORLD 01'}]
    }));
    expect(html).toContain('data-world="runtime_world"');
    expect(html).toContain('GENERATED · Generated Garden');
    expect(html).toContain('value="runtime:artifact_world_01"');
    expect(html).toMatch(/data-dock-view="world"[^>]*aria-pressed="true"/);
  });
});
