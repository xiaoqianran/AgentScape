import { validatePhysics } from '../../schema.js';

export class PartGeometryEnrichmentPass {
  constructor({ provider, io } = {}) { this.provider = provider; this.io = io; }

  async run(context) {
    const parts = context.articulation.parts || {};
    const requested = Object.entries(parts).map(([id, part]) => ({ id, node:part.node, parent:part.parent || '$root' }));
    if (!requested.length || !this.provider?.isConfigured?.() || typeof this.provider.runPartGeometry !== 'function') {
      return { ...context, partGeometry:{ skipped:true } };
    }

    try {
      const bytes = await this.io.writeBinary(context.document);
      const response = await this.provider.runPartGeometry(bytes, requested);
      const returned = response?.parts || {};
      const nextParts = structuredClone(parts);
      const upgraded = [];
      const missing = [];
      const issues = [];
      const reports = {};
      const requestedIds = new Set(requested.map((part) => part.id));

      for (const id of Object.keys(returned)) if (!requestedIds.has(id)) issues.push({ code:'PART_GEOMETRY_UNKNOWN_PART', part:id });
      for (const { id } of requested) {
        const result = returned[id];
        if (!result?.collision?.colliders?.length) { missing.push(id); continue; }
        const physics = {
          ...nextParts[id].physics,
          ...(Number.isFinite(result.physics?.mass) && result.physics.mass > 0 ? { mass:result.physics.mass } : {}),
          ...(Number.isFinite(result.physics?.friction) ? { friction:result.physics.friction } : {}),
          colliders:structuredClone(result.collision.colliders),
          collider:{
            strategy:result.collision.strategy || 'provider',
            quality:result.collision.quality || 'provider',
            generated:false,
            provider:this.provider.endpoint
          }
        };
        try { validatePhysics(physics, { part:id }); }
        catch (error) { issues.push({ code:'PART_GEOMETRY_INVALID_COLLIDER', part:id, message:error.message }); continue; }
        nextParts[id].physics = physics;
        reports[id] = {
          collision:{ strategy:physics.collider.strategy, quality:physics.collider.quality, hulls:result.collision.colliders.length },
          ...(result.geometry ? { geometry:structuredClone(result.geometry) } : {}),
          ...(Number.isFinite(result.physics?.mass) ? { mass:result.physics.mass } : {})
        };
        upgraded.push(id);
      }

      return {
        ...context,
        articulation:{ ...context.articulation, parts:nextParts },
        partGeometry:{ skipped:false, provider:this.provider.endpoint, upgraded, missing, issues, reports }
      };
    } catch (error) {
      return { ...context, partGeometry:{ skipped:true, provider:this.provider.endpoint, error:error.message } };
    }
  }
}
