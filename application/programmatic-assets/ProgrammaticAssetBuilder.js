import * as THREE from 'three';
import { createAssetModule } from '../../modules/asset/AssetModule.js';
import { createArtifactModule } from '../../modules/artifact/ArtifactModule.js';
import { assetAdmission } from '../../modules/asset/model/admission.js';
import { ArticulationVerifier } from '../../modules/world/verification/ArticulationVerifier.js';
import { createWorldAuthoringContext } from '../createWorldAuthoringContext.js';
import { createAuthoringAssetProducer } from '../world-authoring/AuthoringAssetProducer.js';
import { capturePromotionSource } from '../world-authoring/AuthoringPromotionSource.js';
import { disposeObject3D } from '../../modules/rendering/disposeObject3D.js';
import { parseDefinition } from './ProgrammaticAssetContract.js';

export class ProgrammaticAssetBuilder {
 constructor({runner,gltfLoader}) {Object.assign(this,{runner,gltfLoader});}
 async build({source,definition,assetId},{signal}={}) {
  const draft=parseDefinition(definition);
  const result=await this.runner.run({mode:'procedural',source},{signal});
  if(signal?.aborted)throw new Error('BUILD_CANCELLED');
  const authoring=createWorldAuthoringContext({events:{emit(){}}},{executeCode:()=>{throw Error('SOURCE_EXECUTION_FORBIDDEN');}});
  const assets=createAssetModule({manifests:{},manifestStore:null,libraryStore:null,gltfLoader:this.gltfLoader});
  const artifacts=createArtifactModule({persistentStore:null});assets.configureProduction({artifacts});
  assets.configureVerification({articulationVerifier:new ArticulationVerifier({assetRegistry:assets.registry,assetLoader:assets.loader})});
  try {
   authoring.load(result.document);
   const object=authoring.get('asset-root');
   const names=new Map();object.traverse(n=>{if(n.name)names.set(n.name,(names.get(n.name)||0)+1);});
   const required=[...(draft.requiredNodes||[]),...Object.values(draft.parts||{}).map(p=>p.node)];
   if(required.some(name=>names.get(name)!==1))throw Object.assign(new Error('PROCEDURAL_REQUIRED_NODE_INVALID'),{details:{invalidNodes:required.filter(name=>names.get(name)!==1)}});
   const box=new THREE.Box3().setFromObject(object),size=box.getSize(new THREE.Vector3());
   if(![size.x,size.y,size.z].every(v=>Number.isFinite(v)&&v>0&&v<=100))throw new Error('PROCEDURAL_DIMENSIONS_INVALID');
   const resolved={...draft,id:assetId};
   if(resolved.interactionContract)resolved.interactionContract={...resolved.interactionContract,entityId:assetId};
   const produced=await createAuthoringAssetProducer({assets,artifacts})(capturePromotionSource(authoring,'asset-root'),{usage:'interactive',definition:resolved,assetId});
   if(produced.status==='asset-rejected')throw new Error('PROCEDURAL_ASSET_REJECTED');
   const runtime=await assets.verifyAndUpdateArticulation(assetId,{requireRegistration:true});
   if(!runtime.ok||!runtime.physicsRegistered)throw Object.assign(new Error('PROCEDURAL_RUNTIME_VERIFICATION_FAILED'),{details:runtime});
   const manifest=assets.getManifest(assetId);
   const loaded=await assets.instantiate(assetId);disposeObject3D(loaded.object);
   const compiled=await assets.compiledStore.get(manifest.source.key);
   if(!compiled?.bytes||compiled.bytes.byteLength>4194304)throw new Error('BUILD_OUTPUT_LIMIT');
   return {bytes:compiled.bytes,manifest,environment:result.environment,security:result.security,validation:{nodes:[...names.keys()],bounds:{min:box.min.toArray(),max:box.max.toArray()},runtime},admission:assetAdmission(manifest)};
  } finally {authoring.dispose();}
 }
}
