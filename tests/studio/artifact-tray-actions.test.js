import { describe, expect, it, vi } from 'vitest';
import { executeArtifactTrayAction } from '../../apps/studio/react/artifacts/ArtifactTray.tsx';

const output=(kind,primaryId)=>({
  key:`${kind}:${primaryId}`,
  kind,
  primaryId,
  artifactIds:kind==='asset'?['artifact_glb']:[primaryId],
  prompt:'test output',
  status:'ready',
  createdAt:1
});

describe('Artifact Tray workflow actions', () => {
  it('prepares Image to 3D without calling placement or world replacement', async () => {
    const controller={placeAsset:vi.fn(),openWorld:vi.fn()};
    const requestBuildWorkflow=vi.fn();
    const openBuild=vi.fn();

    await expect(executeArtifactTrayAction({
      output:output('image','artifact_image'),controller,requestBuildWorkflow,openBuild
    })).resolves.toMatchObject({status:'workflow-prepared',id:'artifact_image'});

    expect(requestBuildWorkflow).toHaveBeenCalledWith('asset-from-image','image:artifact_image');
    expect(openBuild).toHaveBeenCalledOnce();
    expect(controller.placeAsset).not.toHaveBeenCalled();
    expect(controller.openWorld).not.toHaveBeenCalled();
  });

  it('places an Asset through the existing controller seam', async () => {
    const controller={placeAsset:vi.fn(async()=>({id:'instance_01'})),openWorld:vi.fn()};
    const result=await executeArtifactTrayAction({
      output:output('asset','chair_01'),controller,requestBuildWorkflow:vi.fn(),openBuild:vi.fn()
    });

    expect(result).toMatchObject({status:'asset-placed',id:'chair_01',instanceId:'instance_01'});
    expect(controller.placeAsset).toHaveBeenCalledWith('chair_01');
    expect(controller.openWorld).not.toHaveBeenCalled();
  });

  it('opens a World through the existing controller seam', async () => {
    const controller={placeAsset:vi.fn(),openWorld:vi.fn(async()=>({status:'replaced'}))};
    const result=await executeArtifactTrayAction({
      output:output('world','manifest_01'),controller,requestBuildWorkflow:vi.fn(),openBuild:vi.fn()
    });

    expect(result).toMatchObject({status:'world-opened',id:'manifest_01'});
    expect(controller.openWorld).toHaveBeenCalledWith('manifest_01');
    expect(controller.placeAsset).not.toHaveBeenCalled();
  });
});
