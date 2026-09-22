import { beforeEach, describe, expect, it } from 'vitest';
import { useStudioStore } from '../../apps/studio/react/state/studioStore.ts';

const reset = () => {
  const state=useStudioStore.getState();
  useStudioStore.setState({
    product:{ activePage:'world', agentView:'tasks' },
    layout:{
      ...state.layout,
      activeContextView:'inspect',
      contextOpen:false,
      buildAdvancedOpen:false,
      cinematic:false,
      sceneCollapsed:false
    },
    editor:{ selection:null, revision:0 },
    view:{ worldPresentation:null },
    build:{ outputs:[], selectedOutputKey:null, workflowIntent:null, workflowSequence:0 }
  });
};

describe('studio React store', () => {
  beforeEach(reset);

  it('keeps product pages separate from World Editor contextual state', () => {
    const store=()=>useStudioStore.getState();

    store().openPage('build');
    expect(store().product).toMatchObject({activePage:'build'});
    expect(store().layout.contextOpen).toBe(false);

    store().openView('resources');
    expect(store().product).toMatchObject({activePage:'assets'});

    store().openView('task');
    expect(store().product).toMatchObject({activePage:'agent',agentView:'tasks'});
    store().openView('runs');
    expect(store().product).toMatchObject({activePage:'agent',agentView:'runs'});

    store().openView('inspect');
    expect(store().product).toMatchObject({activePage:'world'});
    expect(store().layout).toMatchObject({activeContextView:'inspect',contextOpen:true});
    store().closeContext();
    expect(store().layout.contextOpen).toBe(false);

    store().setCinematic(true);
    store().openPage('build');
    expect(store().layout.cinematic).toBe(false);
  });

  it('keeps editor selection tagged by source instead of copying runtime ids into shell state', () => {
    useStudioStore.getState().selectRuntimeObject('cup_01');
    expect(useStudioStore.getState().editor.selection).toEqual({source:'runtime',id:'cup_01'});

    useStudioStore.getState().setSelection({source:'authoring',id:'wall_01'});
    expect(useStudioStore.getState().editor.selection).toEqual({source:'authoring',id:'wall_01'});

    useStudioStore.getState().selectRuntimeObject(null);
    expect(useStudioStore.getState().editor.selection).toBeNull();
  });

  it('keeps layout-only state out of editor and build state', () => {
    useStudioStore.getState().setCinematic(true);
    useStudioStore.getState().setSceneCollapsed(true);
    useStudioStore.getState().setBuildAdvancedOpen(true);
    const state=useStudioStore.getState();
    expect(state.layout).toMatchObject({cinematic:true,sceneCollapsed:true,buildAdvancedOpen:true});
    expect(state.editor.selection).toBeNull();
    expect(state.build.outputs).toEqual([]);
  });

  it('keeps earlier Build outputs when a new kind is recorded', () => {
    const store = useStudioStore.getState();
    store.recordBuildOutput({
      key:'image:artifact_image',kind:'image',primaryId:'artifact_image',artifactIds:['artifact_image'],
      prompt:'reference chair',status:'ready',createdAt:1
    });
    useStudioStore.getState().recordBuildOutput({
      key:'asset:chair_01',kind:'asset',primaryId:'chair_01',artifactIds:['artifact_glb'],
      prompt:'reference chair',status:'asset-provisional',createdAt:2
    });

    expect(useStudioStore.getState().build.outputs).toEqual([
      expect.objectContaining({key:'asset:chair_01',kind:'asset'}),
      expect.objectContaining({key:'image:artifact_image',kind:'image'})
    ]);
    expect(useStudioStore.getState().build.selectedOutputKey).toBe('asset:chair_01');
  });

  it('deduplicates the same output identity while preserving the latest record', () => {
    const first={key:'world:manifest_01',kind:'world',primaryId:'manifest_01',artifactIds:['manifest_01'],prompt:'garden',status:'ready',createdAt:1};
    useStudioStore.getState().recordBuildOutput(first);
    useStudioStore.getState().recordBuildOutput({...first,prompt:'garden revised',createdAt:2});

    expect(useStudioStore.getState().build.outputs).toHaveLength(1);
    expect(useStudioStore.getState().build.outputs[0]).toMatchObject({prompt:'garden revised',createdAt:2});
  });

  it('queues and consumes an Image to 3D workflow without copying Artifact truth', () => {
    useStudioStore.getState().recordBuildOutput({
      key:'image:artifact_image',kind:'image',primaryId:'artifact_image',artifactIds:['artifact_image'],
      prompt:'reference chair',status:'ready',createdAt:1
    });
    useStudioStore.getState().requestBuildWorkflow('asset-from-image','image:artifact_image');

    const intent=useStudioStore.getState().build.workflowIntent;
    expect(intent).toEqual({id:1,action:'asset-from-image',outputKey:'image:artifact_image'});
    expect(useStudioStore.getState().build.selectedOutputKey).toBe('image:artifact_image');
    expect(useStudioStore.getState().build.outputs[0]).not.toHaveProperty('hash');

    useStudioStore.getState().consumeBuildWorkflow(intent.id);
    expect(useStudioStore.getState().build.workflowIntent).toBeNull();
  });
});
