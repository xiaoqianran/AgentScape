import { WebIO } from '@gltf-transform/core';
import { validateAssetManifest } from '../assets/schema.js';
import { GLTFInspectPass } from './passes/GLTFInspectPass.js';
import { JointFramePass } from './passes/JointFramePass.js';
import { SegmentMaterializePass } from './passes/SegmentMaterializePass.js';
import { SegmentationEvidencePass } from './passes/SegmentationEvidencePass.js';
import { PartProposalPass } from './passes/PartProposalPass.js';
import { OptimizeGLBPass } from './passes/OptimizeGLBPass.js';
import { StructurePass } from './passes/StructurePass.js';
import { NormalizeTransformPass } from './passes/NormalizeTransformPass.js';
import { GeometryPass } from './passes/GeometryPass.js';
import { SemanticHeuristicPass } from './passes/SemanticHeuristicPass.js';
import { ArticulationCandidatePass } from './passes/ArticulationCandidatePass.js';
import { ColliderFallbackPass } from './passes/ColliderFallbackPass.js';
import { RemoteEnrichmentPass } from './passes/RemoteEnrichmentPass.js';
import { ResourceBudgetPass } from './passes/ResourceBudgetPass.js';
import { RESOURCE_BUDGET } from './resourceBudget.js';
import { CompileQualityPass } from './passes/CompileQualityPass.js';
import { ManifestPass } from './passes/ManifestPass.js';

export class AssetCompiler {
  constructor({ store, provider = null, events = null, version = 'dev' } = {}) {
    this.store = store; this.provider = provider; this.events = events; this.version = version;
    this.io = new WebIO();
    this.passes = [
      new GLTFInspectPass({ io: this.io }),
      new StructurePass(),
      new NormalizeTransformPass(),
      new GeometryPass(),
      new SemanticHeuristicPass(),
      new ArticulationCandidatePass(),
      new ColliderFallbackPass(),
      new RemoteEnrichmentPass({ provider }),
      new SegmentMaterializePass(),
      new SegmentationEvidencePass(),
      new JointFramePass(),
      new PartProposalPass(),
      new OptimizeGLBPass({ io: this.io }),
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

  async compile({ url, bytes, sourceName, assetId, label, partProposal = null, partSegmentation = null } = {}) {
    if (!bytes && !url) throw new Error('AssetCompiler requires url or bytes');
    const inputBytes = bytes instanceof Uint8Array ? bytes : bytes ? new Uint8Array(bytes) : await this.fetchBytes(url);
    if (inputBytes.byteLength > RESOURCE_BUDGET.maxInputBytes) {
      const error = new Error(`GLB exceeds input limit: ${inputBytes.byteLength} > ${RESOURCE_BUDGET.maxInputBytes}`);
      error.code = 'ASSET_INPUT_TOO_LARGE';
      throw error;
    }
    const name = sourceName || (url ? new URL(url, globalThis.location?.href || 'http://localhost').pathname.split('/').pop() : 'asset.glb');
    let context = { bytes:inputBytes, sourceUrl:url || null, sourceName:name, assetId, label, partProposal, partSegmentation, compilerVersion:this.version };
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
    await this.store.put(storageKey, context.optimizedBytes, { sourceName: name, manifestId: context.manifest.id, quality: context.quality.status });
    return {
      manifest: context.manifest,
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
      resources: context.resources,
      quality: context.quality
    };
  }
}
