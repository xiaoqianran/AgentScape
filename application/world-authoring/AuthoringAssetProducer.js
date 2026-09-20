import { sha256ArtifactHash } from '../../modules/artifact/IncrementalSha256.js';
import { exportPromotionGLB } from './AuthoringPromotionSource.js';

export function createAuthoringAssetProducer({ assets, artifacts, exportGLB = exportPromotionGLB }) {
  return async (source, { usage }) => {
    const data = await exportGLB(source);
    const hash = sha256ArtifactHash([data]);
    const suffix = hash.slice(7);
    const artifactId = `authored_${suffix}`;
    const assetId = `authored_${suffix}_${usage}`;
    const cacheKey = `cache_${artifactId}`;
    const now = new Date().toISOString();
    if (!artifacts.registry.get(artifactId)) {
      artifacts.registry.register({
        id:artifactId, role:'primary-glb', type:'asset-bundle',
        schema:{ id:'agentscape.artifact', version:'1' }, displayName:'Authored object',
        mime:'model/gltf-binary', format:'glb', bytes:data.byteLength, hash,
        producer:{ provider:'authoring', jobId:`export_${suffix}`, operation:'authoring.export.glb.v1', stage:'authoring' },
        lineage:{ parents:[] }, createdAt:now, retention:{ class:'project' }, locations:[]
      });
    }
    if (!artifacts.byteStore.get(cacheKey)) {
      const writer = artifacts.byteStore.begin({ artifactId, maxBytes:data.byteLength });
      try {
        await writer.write(data);
        await writer.commit({ key:cacheKey, hash, mime:'model/gltf-binary', bytes:data.byteLength });
      } catch (error) {
        if (writer.state === 'open') await writer.abort();
        throw error;
      }
    }
    artifacts.registry.updateLocation(artifactId, {
      id:`local_${artifactId}`, kind:'local-cache', scope:'application', state:'available',
      verifiedAt:now, access:{ kind:'cache-key', key:cacheKey }
    });
    artifacts.registry.verifyIntegrity(artifactId, {
      hash, bytes:data.byteLength, mime:'model/gltf-binary', verifiedAt:now, method:'authoring-sha256-v1'
    });
    await artifacts.persistArtifact(artifactId, cacheKey);
    return assets.produceAsset({ artifactId, assetId, label:'Authored object', authoringIntent:{ usage } });
  };
}
