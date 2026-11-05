import { ProgrammaticAssetBuilder } from './ProgrammaticAssetBuilder.js';
import { assetDigest, canonicalAssetJson } from '../../modules/asset/model/AssetInputContracts.js';

export async function prepareThreeCodeAsset(assets, executor, input, { signal, gltfLoader } = {}) {
  if (!executor) throw new Error('CODE_EXECUTION_DISABLED');
  const environment = await executor.environment();
  const version = await assetDigest(new TextEncoder().encode(canonicalAssetJson({ source: input.source, definition: input.definition || null, environment, contract: 'three-code-v1' })));
  const id = `asset_${version}`, asset = `asset://sha256/${version}`;
  if (signal?.aborted) throw new Error('BUILD_CANCELLED');
  if (assets.hasAsset(id)) return { asset, manifest: assets.getManifest(id), install: operation => operation() };
  const built = await new ProgrammaticAssetBuilder({ runner: executor, gltfLoader }).build({ ...input, assetId: id }, { signal });
  if (signal?.aborted) throw new Error('BUILD_CANCELLED');
  built.manifest.contentHash = version;
  const bytesHash = await assetDigest(built.bytes);
  return { asset, manifest: built.manifest, validation: built.validation,
    install: operation => assets.installPreparedAssets([{manifest:built.manifest,bytes:built.bytes,
      expectedDefinition:built.manifest,expectedSourceHash:bytesHash}],operation) };
}
