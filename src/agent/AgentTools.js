import { Errors } from '../core/errors.js';

export const TOOL_DEFINITIONS = {
  listObjects: { required: [] },
  spawnAsset: { required: ['assetId', 'position'] },
  moveObject: { required: ['id', 'position'] },
  pickup: { required: ['id'] },
  drop: { required: [] },
  place: { required: ['id', 'targetId'] },
  open: { required: ['id'] },
  close: { required: ['id'] }
};

export class AgentTools {
  constructor(runtime) { this.runtime = runtime; }
  schema() { return Object.entries(TOOL_DEFINITIONS).map(([name, def]) => `${name}(${def.required.join(', ')})`); }
  validate(name, args) {
    const def = TOOL_DEFINITIONS[name]; if (!def) throw Errors.invalidToolCall(name, { reason: 'unknown tool' });
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
      case 'place': return this.runtime.interactions.place(args.id, args.targetId);
      case 'open': return this.runtime.interactions.setDoor(args.id, true);
      case 'close': return this.runtime.interactions.setDoor(args.id, false);
    }
  }
}
