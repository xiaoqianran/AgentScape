export class ColliderFallbackPass {
  async run(context) {
    const [x,y,z] = context.geometry.bounds.size;
    const translation = context.geometry.bounds.center;
    if (context.semantics?.tags?.includes('round')) {
      const radius = Math.max(Math.min(x / 2, z / 2, Math.max(y / 2 - 0.005, 0.005)), 0.005);
      const halfHeight = Math.max(y / 2 - radius, 0.005);
      return {
        ...context,
        collision: {
          strategy: 'capsule-fit',
          quality: 'primitive',
          colliders: [{ shape:'capsule', halfHeight, radius, translation }]
        }
      };
    }
    return {
      ...context,
      collision: {
        strategy: 'aabb-fallback',
        quality: 'coarse',
        colliders: [{
          shape: 'box',
          halfExtents: [Math.max(x/2,0.005), Math.max(y/2,0.005), Math.max(z/2,0.005)],
          translation
        }]
      }
    };
  }
}
