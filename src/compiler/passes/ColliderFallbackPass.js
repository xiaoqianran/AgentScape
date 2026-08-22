export class ColliderFallbackPass {
  async run(context) {
    const [x,y,z] = context.geometry.bounds.size;
    return {
      ...context,
      collision: {
        strategy: 'aabb-fallback',
        quality: 'coarse',
        colliders: [{
          shape: 'box',
          halfExtents: [Math.max(x/2,0.005), Math.max(y/2,0.005), Math.max(z/2,0.005)],
          translation: context.geometry.bounds.center
        }]
      }
    };
  }
}
