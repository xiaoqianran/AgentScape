export const assetManifests = {
  cup: {
    id: 'cup',
    type: 'cup',
    source: { kind: 'builtin' },
    actions: ['pickup', 'drop', 'place', 'move'],
    physics: { body: 'dynamic', mass: 0.3, collider: 'cylinder' }
  },
  table: {
    id: 'table',
    type: 'table',
    source: { kind: 'builtin' },
    actions: ['move'],
    physics: { body: 'fixed', collider: 'compound' },
    surfaces: [{ id: 'top', localPosition: [0, 1.1, 0], size: [2.2, 1.05] }]
  },
  cabinet: {
    id: 'cabinet',
    type: 'cabinet',
    source: { kind: 'builtin' },
    actions: ['open', 'close', 'move'],
    physics: { body: 'fixed', collider: 'box' },
    parts: {
      door: {
        node: 'doorHinge',
        actions: ['open', 'close'],
        joint: { type: 'revolute', axis: [0, 1, 0], limits: [-1.35, 0] }
      }
    }
  }
};
