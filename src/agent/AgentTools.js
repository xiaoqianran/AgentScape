export class AgentTools {
  constructor(world) {
    this.world = world;
  }

  schema() {
    return [
      'listObjects()',
      'spawnAsset(assetId, position, instanceId?)',
      'moveObject(id, position)',
      'pickup(id)',
      'drop(id?)',
      'place(id, targetId)',
      'open(id)',
      'close(id)'
    ];
  }

  async call(name, args = {}) {
    switch (name) {
      case 'listObjects': return this.world.listObjects();
      case 'spawnAsset': return this.world.spawnAsset(args.assetId, args.position, args.instanceId);
      case 'moveObject': return this.world.moveObject(args.id, args.position);
      case 'pickup': return this.world.pickup(args.id);
      case 'drop': return this.world.drop(args.id);
      case 'place': return this.world.place(args.id, args.targetId);
      case 'open': return this.world.open(args.id);
      case 'close': return this.world.close(args.id);
      default: throw new Error(`Unknown tool: ${name}`);
    }
  }
}
