export type ArtifactTrayActionOutput = {
  key: string;
  kind: 'image' | 'asset' | 'world';
  primaryId: string;
};

export type ArtifactTrayActionController = {
  placeAsset: (assetId: string) => Promise<unknown>;
  openWorld: (manifestArtifactId: string) => Promise<unknown>;
};

type ExecuteArtifactTrayActionOptions = {
  output: ArtifactTrayActionOutput;
  controller: ArtifactTrayActionController;
  requestBuildWorkflow: (action: 'asset-from-image', outputKey: string) => void;
  openBuild: () => void;
};

export async function executeArtifactTrayAction({
  output,
  controller,
  requestBuildWorkflow,
  openBuild
}: ExecuteArtifactTrayActionOptions) {
  if (output.kind === 'image') {
    requestBuildWorkflow('asset-from-image', output.key);
    openBuild();
    return { status:'workflow-prepared', kind:output.kind, id:output.primaryId } as const;
  }

  if (output.kind === 'asset') {
    const placement = await controller.placeAsset(output.primaryId) as { id?: string | null; status?: string } | string | null;
    const instanceId = typeof placement === 'string' ? placement : placement?.id || null;
    if (!instanceId) {
      const status = typeof placement === 'object' ? placement?.status || 'PLACEMENT_FAILED' : 'PLACEMENT_FAILED';
      throw new Error(`Asset 未成功进入 Runtime：${status}`);
    }
    return { status:'asset-placed', kind:output.kind, id:output.primaryId, instanceId, placement } as const;
  }

  await controller.openWorld(output.primaryId);
  return { status:'world-opened', kind:output.kind, id:output.primaryId } as const;
}
