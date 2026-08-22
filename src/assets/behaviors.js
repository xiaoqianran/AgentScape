export const behaviors = {
  cup: {
    type: 'cup',
    actions: ['pickup', 'drop', 'place', 'move'],
    physics: { body: 'dynamic', mass: 0.3 }
  },
  table: {
    type: 'table',
    actions: ['move'],
    physics: { body: 'fixed' },
    surfaces: [{ id: 'top', localY: 1.05 }]
  },
  cabinet: {
    type: 'cabinet',
    actions: ['open', 'close', 'move'],
    physics: { body: 'fixed' },
    parts: {
      door: {
        action: 'open',
        joint: 'revolute',
        axis: [0, 1, 0],
        limit: [0, 1.45]
      }
    }
  }
};
