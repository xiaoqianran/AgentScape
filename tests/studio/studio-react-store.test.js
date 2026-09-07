import { beforeEach, describe, expect, it } from 'vitest';
import { useStudioStore } from '../../studio/react/state/studioStore.ts';

const initial = {
  selectedObjectId:null,
  activeContextView:'create',
  contextRevision:0,
  buildOutputs:[],
  selectedBuildOutputKey:null,
  buildWorkflowIntent:null,
  buildWorkflowSequence:0
};

describe('studio React store build outputs', () => {
  beforeEach(() => useStudioStore.setState(initial));

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

    expect(useStudioStore.getState().buildOutputs).toEqual([
      expect.objectContaining({key:'asset:chair_01',kind:'asset'}),
      expect.objectContaining({key:'image:artifact_image',kind:'image'})
    ]);
    expect(useStudioStore.getState().selectedBuildOutputKey).toBe('asset:chair_01');
  });

  it('deduplicates the same output identity while preserving the latest record', () => {
    const first={key:'world:manifest_01',kind:'world',primaryId:'manifest_01',artifactIds:['manifest_01'],prompt:'garden',status:'ready',createdAt:1};
    useStudioStore.getState().recordBuildOutput(first);
    useStudioStore.getState().recordBuildOutput({...first,prompt:'garden revised',createdAt:2});

    expect(useStudioStore.getState().buildOutputs).toHaveLength(1);
    expect(useStudioStore.getState().buildOutputs[0]).toMatchObject({prompt:'garden revised',createdAt:2});
  });

  it('queues and consumes an Image to 3D workflow without copying Artifact truth', () => {
    useStudioStore.getState().recordBuildOutput({
      key:'image:artifact_image',kind:'image',primaryId:'artifact_image',artifactIds:['artifact_image'],
      prompt:'reference chair',status:'ready',createdAt:1
    });
    useStudioStore.getState().requestBuildWorkflow('asset-from-image','image:artifact_image');

    const intent=useStudioStore.getState().buildWorkflowIntent;
    expect(intent).toEqual({id:1,action:'asset-from-image',outputKey:'image:artifact_image'});
    expect(useStudioStore.getState().selectedBuildOutputKey).toBe('image:artifact_image');
    expect(useStudioStore.getState().buildOutputs[0]).not.toHaveProperty('hash');

    useStudioStore.getState().consumeBuildWorkflow(intent.id);
    expect(useStudioStore.getState().buildWorkflowIntent).toBeNull();
  });
});
