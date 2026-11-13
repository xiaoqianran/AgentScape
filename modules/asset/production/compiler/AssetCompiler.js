import { validateAssetManifest } from '../../model/schema.js';
import { createAssetGLTFIO } from './gltfIO.js';
import { GLTFInspectPass } from './passes/GLTFInspectPass.js';
import { JointFramePass } from './passes/JointFramePass.js';
import { SegmentMaterializePass } from './passes/SegmentMaterializePass.js';
import { SegmentationEvidencePass } from './passes/SegmentationEvidencePass.js';
import { PartColliderPass } from './passes/PartColliderPass.js';
import { PartProposalPass } from './passes/PartProposalPass.js';
import { PartGeometryEnrichmentPass } from './passes/PartGeometryEnrichmentPass.js';
import { ArticulatedCollisionPass } from './passes/ArticulatedCollisionPass.js';
import { OptimizeGLBPass } from './passes/OptimizeGLBPass.js';
import { StructurePass } from './passes/StructurePass.js';
import { NormalizeTransformPass } from './passes/NormalizeTransformPass.js';
import { GeometryPass } from './passes/GeometryPass.js';
import { SemanticHeuristicPass } from './passes/SemanticHeuristicPass.js';
import { ArticulationCandidatePass } from './passes/ArticulationCandidatePass.js';
import { ColliderFallbackPass } from './passes/ColliderFallbackPass.js';
import { RemoteEnrichmentPass } from './passes/RemoteEnrichmentPass.js';
import { ResourceBudgetPass } from './passes/ResourceBudgetPass.js';
import { RESOURCE_BUDGET } from '../../model/resourceBudget.js';
import { CompileQualityPass } from './passes/CompileQualityPass.js';
import { ManifestPass } from './passes/ManifestPass.js';
import { AuthoringIntentPass } from './passes/AuthoringIntentPass.js';
import { ExplicitDefinitionPass } from './passes/ExplicitDefinitionPass.js';
import { assertEmbeddedGLB, interactionReviewSchema, assetDigest, canonicalAssetJson } from '../../model/AssetInputContracts.js';

export class AssetCompiler {
  async compileVisual({ bytes, assetId, label = 'Imported model', persist = true }) {
    assertEmbeddedGLB(bytes);
    let context = { bytes, assetId, authoringIntent: { usage: 'static' }, compilerVersion: this.version };
    for (const pass of [new GLTFInspectPass({ io: this.io }), new StructurePass(), new GeometryPass(), new OptimizeGLBPass({ io: this.io }), new ResourceBudgetPass()]) context = await pass.run(context);
    const hard = [...context.geometry.warnings.filter(w => w.severity === 'hard'), ...context.resources.hard];
    const advisory = [...context.geometry.warnings.filter(w => w.severity !== 'hard'), ...context.resources.advisory];
    const quality = { status: hard.length ? 'rejected' : advisory.length ? 'provisional' : 'ready', hard, advisory };
    if (hard.length) throw Object.assign(new Error('Visual asset rejected'), { code: 'ASSET_COMPILE_REJECTED', details: quality });
    const manifest = { id: assetId, type: 'visual', label, capabilityLevel: 'visual', actions: [], source: { kind: 'compiled', key: assetId }, compiler: { version: this.version, quality, resources: context.resources } };
    validateAssetManifest(manifest);
    if (persist) await this.store.put(assetId, context.optimizedBytes, { manifestId: assetId, quality: quality.status });
    return { manifest, quality, resources: context.resources, optimizedBytes: context.optimizedBytes };
  }
  constructor({ store, provider = null, events = null, version = 'dev' } = {}) {
    this.store = store; this.provider = provider; this.events = events; this.version = version;
    this.io = createAssetGLTFIO();
    this.passes = [
      new GLTFInspectPass({ io: this.io }),
      new StructurePass(),
      new NormalizeTransformPass(),
      new GeometryPass(),
      new SemanticHeuristicPass(),
      new AuthoringIntentPass(),
      new ArticulationCandidatePass(),
      new ColliderFallbackPass(),
      new RemoteEnrichmentPass({ provider }),
      new SegmentMaterializePass(),
      new SegmentationEvidencePass(),
      new JointFramePass(),
      new PartColliderPass(),
      new PartProposalPass(),
      new PartGeometryEnrichmentPass({ provider, io:this.io }),
      new ArticulatedCollisionPass(),
      new OptimizeGLBPass({ io: this.io }),
      new ExplicitDefinitionPass(),
      new ResourceBudgetPass(),
      new CompileQualityPass(),
      new ManifestPass()
    ];
  }

  async fetchBytes(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch GLB: HTTP ${response.status}`);
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > RESOURCE_BUDGET.maxInputBytes) throw Object.assign(new Error(`GLB exceeds input limit: ${declared}`), { code: 'ASSET_INPUT_TOO_LARGE' });
    if (!response.body) return new Uint8Array(await response.arrayBuffer());

    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > RESOURCE_BUDGET.maxInputBytes) {
        await reader.cancel();
        throw Object.assign(new Error(`GLB exceeds input limit: ${total}`), { code: 'ASSET_INPUT_TOO_LARGE' });
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  }

  async proposeInteraction({bytes,sourceName='import.glb',label,partProposal=null,urdfHash=null}={}) {
    assertEmbeddedGLB(bytes);
    const output=await this.compile({bytes,sourceName,label,assetId:'interaction_candidate',partProposal,interactionProposal:true,
      authoringIntent:{usage:'static'},persist:false});
    const sourceHash=await assetDigest(bytes);
    const parts=(output.partProposal?.parts || []).map(part=>({ ...part, executable:false, physicsVerified:false,
      missing:['mass','friction',...['axis','parentAnchor','childAnchor','limits'].filter(field=>part.joint?.[field]==null).map(field=>`joint.${field}`),'review-confirmation','runtime-verification'] }));
    const proposal={schema:'agentscape.capability-proposal',schemaVersion:1,sourceHash,urdfHash,compilerVersion:this.version,
      physics:{body:null,mass:null,friction:null,colliders:output.manifest.physics.colliders},parts,
      operations:[
        ...(output.geometry.bounds.size.every(size=>Number.isFinite(size)&&size>0&&size<=1.25)
          ? ['pickup','drop','place'].map(action=>({action,executable:false,physicsVerified:false,requires:'reviewed-dynamic-body-mass-and-carry-geometry'})) : []),
        ...['push','drag','rotate'].map(action=>({action,executable:false,physicsVerified:false,requires:'reviewed-dynamic-body'})),
        ...parts.filter(part=>['prismatic','revolute'].includes(part.joint?.type)).map(part=>({action:part.joint.type==='prismatic'?'slide':'rotateJoint',part:part.id,executable:false,physicsVerified:false,requires:'reviewed-and-verified-joint'})),
        ...(output.articulation.candidates||[]).flatMap(candidate=>(candidate.suggestedActions||[])
          .filter(action=>!['slide','rotateJoint'].includes(action))
          .map(action=>({action,part:candidate.partId||candidate.node,executable:false,physicsVerified:false,
            requires:'semantic-review-and-verified-joint-target'})))
      ],
      missing:['physics.body','physics.mass','physics.friction','review-confirmation','runtime-verification'],
      evidence:{geometry:output.geometry.bounds,collisionStrategy:output.collision.strategy,articulationSource:output.partProposal?.source || output.articulation.source,
        confidenceScope:'name-or-source-metadata-only; not physical verification',
        semanticConfidence:output.manifest.compiler.semanticConfidence,jointFrame:output.partProposal?.jointFrame || null,
        issues:output.partProposal?.issues || [],passes:['SemanticHeuristicPass','ArticulationCandidatePass','PartColliderPass','JointFramePass']}};
    return {...proposal,proposalId:await assetDigest(new TextEncoder().encode(canonicalAssetJson(proposal)))};
  }

  async compile({ url, bytes, sourceName, assetId, label, partProposal = null, partSegmentation = null, providerEvidence = null, authoringIntent = null, definition = null,
    interactionProposal=false,interactionReview=null,persist=true } = {}) {
    if(interactionReview) interactionReview=interactionReviewSchema.parse(interactionReview);
    if (!bytes && !url) throw new Error('AssetCompiler requires url or bytes');
    const inputBytes = bytes instanceof Uint8Array ? bytes : bytes ? new Uint8Array(bytes) : await this.fetchBytes(url);
    if (inputBytes.byteLength > RESOURCE_BUDGET.maxInputBytes) {
      const error = new Error(`GLB exceeds input limit: ${inputBytes.byteLength} > ${RESOURCE_BUDGET.maxInputBytes}`);
      error.code = 'ASSET_INPUT_TOO_LARGE';
      throw error;
    }
    const name = sourceName || (url ? new URL(url, globalThis.location?.href || 'http://localhost').pathname.split('/').pop() : 'asset.glb');
    let context = { bytes:inputBytes, sourceUrl:url || null, sourceName:name, assetId, label, partProposal, partSegmentation, providerEvidence, authoringIntent, definition, interactionProposal,interactionReview, compilerVersion:this.version };
    for (const pass of this.passes) {
      const started = performance.now();
      this.events?.emit('assetCompiler.pass.started', { pass: pass.constructor.name, sourceName: name });
      context = await pass.run(context);
      this.events?.emit('assetCompiler.pass.completed', { pass: pass.constructor.name, elapsedMs: Math.round(performance.now()-started) });
    }
    validateAssetManifest(context.manifest);
    if (context.quality.status === 'rejected') {
      const error = new Error('Asset compilation rejected by quality gate');
      error.code = 'ASSET_COMPILE_REJECTED';
      error.details = context.quality;
      throw error;
    }
    const storageKey = context.manifest.source.key;
    if(persist) await this.store.put(storageKey, context.optimizedBytes, { sourceName: name, manifestId: context.manifest.id, quality: context.quality.status });
    return {
      manifest: context.manifest,
      optimizedBytes: context.optimizedBytes,
      inspection: context.inspection,
      structure: context.structure,
      normalization: context.normalization,
      geometry: context.geometry,
      optimization: context.optimization,
      articulation: context.articulation,
      collision: context.collision,
      enrichment: context.enrichment,
      meshQuality: context.meshQuality || null,
      partProposal: context.partProposal || null,
      partSegmentation: context.partSegmentation || null,
      partCollision: context.partCollision || null,
      partGeometry: context.partGeometry || null,
      resources: context.resources,
      quality: context.quality
    };
  }
}
