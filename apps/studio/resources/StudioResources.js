const byLabel = (a, b) => String(a.label || a.id).localeCompare(String(b.label || b.id));

export function collectResourceLibrary({
  assetCatalog = null,
  artifactRegistry = null,
  assets = null,
  artifacts = null,
  approvedAssets = [],
  environments = [],
  currentEnvironmentId = null
} = {}) {
  const assetList = assets || assetCatalog?.list?.() || [];
  const artifactList = artifacts || artifactRegistry?.list?.() || [];
  const approvedIds = new Set((approvedAssets || []).map((entry) => entry.assetId));
  const visibleAssets = assetList
    .filter((asset) => asset.source !== 'compiled' || approvedIds.has(asset.id))
    .slice()
    .sort(byLabel);
  const images = artifactList
    .filter((artifact) => String(artifact.mime || '').startsWith('image/'))
    .map((artifact) => ({
      id:artifact.id,
      label:artifact.displayName || artifact.id,
      mime:artifact.mime,
      format:artifact.format,
      bytes:artifact.bytes,
      integrity:artifact.integrity?.state || 'declared',
      provider:artifact.producer?.provider || null,
      jobId:artifact.producer?.jobId || null,
      descriptor:artifact
    }))
    .sort(byLabel);
  const generatedWorlds = artifactList
    .filter((artifact) => artifact.role === 'world-manifest')
    .map((artifact) => ({
      id:artifact.id,
      label:artifact.displayName || artifact.id,
      source:'generated',
      current:false,
      integrity:artifact.integrity?.state || 'declared',
      provider:artifact.producer?.provider || null,
      jobId:artifact.producer?.jobId || null,
      descriptor:artifact
    }))
    .sort(byLabel);
  const worlds = [
    ...(environments || []).map((environment) => ({
      id:environment.id,
      label:environment.title || environment.id,
      description:environment.description || '',
      number:environment.number || '',
      source:'builtin',
      current:environment.id === currentEnvironmentId
    })),
    ...generatedWorlds
  ];
  return { assets:visibleAssets, images, worlds };
}

const RESOURCE_EVENTS = Object.freeze([
  'generation.artifact.imported',
  'assetProduction.registered',
  'asset.compiled',
  'asset.verified',
  'asset.library.changed',
  'environment.replaced'
]);

// Product-facing resource boundary for Studio presentation.
// It hides AssetModule / ArtifactModule persistence and storage details.
export class StudioResources {
  constructor({
    assetModule,
    artifactModule,
    events = null,
    getEnvironment = () => null,
    environments = []
  } = {}) {
    if (!assetModule?.catalog || !artifactModule?.registry) {
      throw new TypeError('StudioResources requires AssetModule and ArtifactModule boundaries');
    }
    this.assetModule = assetModule;
    this.artifacts = artifactModule;
    this.events = events;
    this.getEnvironment = typeof getEnvironment === 'function' ? getEnvironment : () => null;
    this.environments = environments;
  }

  currentEnvironment() {
    const environment = this.getEnvironment() || null;
    if (!environment) return null;
    return {
      id:environment.id || null,
      title:environment.title || environment.label || null,
      label:environment.label || environment.title || null
    };
  }

  artifact(id) {
    return this.artifacts.registry.get(id) || null;
  }

  localArtifact(id) {
    const descriptor = this.artifact(id);
    const location = descriptor?.locations?.find?.((item) =>
      item.kind === 'local-cache' &&
      item.state === 'available' &&
      item.access?.kind === 'cache-key'
    );
    if (!descriptor || !location?.access?.key) return { descriptor, data:null };
    return {
      descriptor,
      data:this.artifacts.byteStore?.get?.(location.access.key)?.data || null
    };
  }

  approvedAssetIds() {
    return new Set((this.assetModule.library?.listSync?.() || []).map((entry) => entry.assetId));
  }

  async approveAsset(assetId, metadata = {}) {
    const result = await this.assetModule.approveAsset(assetId, metadata);
    this.events?.emit?.('asset.library.changed', { assetId, status:result?.status || 'approved' });
    return result;
  }

  snapshot() {
    const environment = this.currentEnvironment();
    return collectResourceLibrary({
      assets:this.assetModule.catalog.list(),
      artifacts:this.artifacts.registry.list(),
      approvedAssets:this.assetModule.library?.listSync?.() || [],
      environments:this.environments,
      currentEnvironmentId:environment?.id || null
    });
  }

  onChange(listener) {
    const unsubscribers = RESOURCE_EVENTS
      .map((type) => this.events?.on?.(type, () => listener(type)))
      .filter(Boolean);
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe?.();
    };
  }

  onEnvironmentChange(listener) {
    return this.events?.on?.('environment.replaced', listener) || (() => {});
  }
}
