import { ProgrammaticAssetBuilder } from './ProgrammaticAssetBuilder.js';
import { assetDigest, canonicalAssetJson } from '../../modules/asset/model/AssetInputContracts.js';
import { createAssetModule } from '../../modules/asset/AssetModule.js';
import { ArticulationVerifier } from '../../modules/world/verification/ArticulationVerifier.js';

// Published bytes cross the Studio bridge; compile and verify them locally before
// the existing Scene mutation, never accept a remote physics verdict as evidence.
export async function prepareEmbeddedCodeAsset(assets, input, { gltfLoader } = {}) {
  const asset=`asset://sha256/${input.id.replace(/^(pa_|asset_)/,'')}`;
  const sourceHash=await assetDigest(input.bytes);
  const definitionHash=await assetDigest(new TextEncoder().encode(canonicalAssetJson(input.definition)));
  if(assets.hasAsset(input.id)) {
    const existing=assets.getManifest(input.id);
    if(existing.provenance?.codeTransport?.sourceHash!==sourceHash || existing.provenance?.codeTransport?.definitionHash!==definitionHash)throw new Error('ASSET_ID_CONFLICT');
    return {asset,install:operation=>operation()};
  }
  const scratch=createAssetModule({volatile:true,manifests:{},manifestStore:null,libraryStore:null,gltfLoader});
  scratch.configureVerification({articulationVerifier:new ArticulationVerifier({assetRegistry:scratch.registry,assetLoader:scratch.loader})});
  const {manifest}=await scratch.importPackageAsset({id:input.id,bytes:input.bytes,definition:input.definition});
  manifest.provenance={...manifest.provenance,codeTransport:{sourceHash,definitionHash}};
  const bytes=(await scratch.compiledStore.get(manifest.source.key)).bytes;
  const expectedSourceHash=await assetDigest(bytes);
  return {asset,install:operation=>assets.installPreparedAssets([{manifest,bytes,expectedDefinition:manifest,expectedSourceHash}],operation)};
}

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
