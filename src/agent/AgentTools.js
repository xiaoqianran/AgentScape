import { Errors } from '../core/errors.js';

import { TOOL_CATALOG } from './toolCatalog.js';
export class AgentTools {
  constructor(runtime) { this.runtime = runtime; }
  schema() { return Object.entries(TOOL_CATALOG).map(([name, def]) => `${name}(${def.required.join(', ')})`); }
  validate(name, args) {
    const def = TOOL_CATALOG[name]; if (!def) throw Errors.invalidToolCall(name, { reason: 'unknown tool' });
    const missing = def.required.filter(k => args?.[k] == null); if (missing.length) throw Errors.invalidToolCall(name, { missing });
  }
  async call(name, args = {}) {
    this.validate(name, args); this.runtime.events.emit('tool.called', { name, args });
    switch (name) {
      case 'listObjects': return this.runtime.listObjects();
      case 'spawnAsset': return this.runtime.spawn(args.assetId, { position: args.position, id: args.instanceId });
      case 'moveObject': return this.runtime.interactions.move(args.id, args.position);
      case 'pickup': return this.runtime.interactions.pickup(args.id);
      case 'drop': return this.runtime.interactions.drop(args.id);
      case 'place': return this.runtime.interactions.place(args.id, args.targetId, { surfaceId: args.surfaceId, clearance: args.clearance });
      case 'open': return this.runtime.interactions.setDoor(args.id, true);
      case 'close': return this.runtime.interactions.setDoor(args.id, false);
      case 'duplicateObject': return this.runtime.duplicate(args.id);
      case 'removeObject': return this.runtime.remove(args.id);
      case 'getBounds': return this.runtime.spatial.getBounds(args.id);
      case 'findNearby': return this.runtime.spatial.findNearby(args.id, args.radius ?? 2);
      case 'raycast': return this.runtime.spatial.raycast(args.origin, args.direction, args.maxDistance ?? 100);
      case 'isColliding': return this.runtime.spatial.isColliding(args.id, { ignore: args.ignore ?? [], margin: args.margin ?? 0.01 });
      case 'findSupportSurface': { const s = this.runtime.spatial.getSupportSurface(args.targetId, args.surfaceId); return s ? { ...s, center: s.center.toArray().map(v => Number(v.toFixed(3))) } : null; }
      case 'findFreeSpace': { const p = this.runtime.spatial.findFreeSpace(args.id, args.targetId, { surfaceId: args.surfaceId, clearance: args.clearance }); return p?.toArray().map(v => Number(v.toFixed(3))) ?? null; }
    }
  }
}
