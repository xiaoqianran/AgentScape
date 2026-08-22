import { WebIO } from '@gltf-transform/core';
import { validateAssetManifest } from '../assets/schema.js';
import { GLTFInspectPass } from './passes/GLTFInspectPass.js';
import { OptimizeGLBPass } from './passes/OptimizeGLBPass.js';
import { GeometryPass } from './passes/GeometryPass.js';
import { SemanticHeuristicPass } from './passes/SemanticHeuristicPass.js';
import { ArticulationCandidatePass } from './passes/ArticulationCandidatePass.js';
import { ColliderFallbackPass } from './passes/ColliderFallbackPass.js';
import { RemoteEnrichmentPass } from './passes/RemoteEnrichmentPass.js';
import { CompileQualityPass } from './passes/CompileQualityPass.js';
import { ManifestPass } from './passes/ManifestPass.js';

export class AssetCompiler {
  constructor({ store, provider = null, events = null, version = '1.1.0' } = {}) {
    this.store = store; this.provider = provider; this.events = events; this.version = version;
    this.io = new WebIO();
    this.passes = [
      new GLTFInspectPass({ io: this.io }),
      new GeometryPass(),
      new SemanticHeuristicPass(),
      new ArticulationCandidatePass(),
      new ColliderFallbackPass(),
      new RemoteEnrichmentPass({ provider }),
      new OptimizeGLBPass({ io: this.io }),
      new CompileQualityPass(),
      new ManifestPass()
    ];
  }

  async fetchBytes(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch GLB: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async compile({ url, bytes, sourceName, assetId, label } = {}) {
    if (!bytes && !url) throw new Error('AssetCompiler requires url or bytes');
    const inputBytes = bytes instanceof Uint8Array ? bytes : bytes ? new Uint8Array(bytes) : await this.fetchBytes(url);
    const name = sourceName || (url ? new URL(url, globalThis.location?.href || 'http://localhost').pathname.split('/').pop() : 'asset.glb');
    let context = { bytes: inputBytes, sourceUrl: url || null, sourceName: name, assetId, label, compilerVersion: this.version };
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
      geometry: context.geometry,
      optimization: context.optimization,
      articulation: context.articulation,
      collision: context.collision,
      enrichment: context.enrichment,
      quality: context.quality
    };
  }
}
