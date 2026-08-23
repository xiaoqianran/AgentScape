export const assetManifests = {

  agent: {
    id: 'agent', type: 'agent', label: 'Embodied Agent', tags: ['agent', 'character', 'navigator', '智能体'], aliases: ['robot', 'avatar'], source: { kind: 'builtin' },
    actions: ['navigate'],
    embodiment: { holdAnchor: { translation:[0,0.95,-0.62], rotation:[0,0,0,1] } },
    physics: {
      body: 'kinematic', navigationObstacle: false,
      colliders: [{ shape: 'capsule', halfHeight: 0.53, radius: 0.32, translation: [0, 0.85, 0] }]
    }
  },
  chair: {
    id: 'chair', type: 'chair', label: 'Chair', tags: ['chair', 'seat', 'furniture', '椅子'], aliases: ['seat'], source: { kind: 'builtin' },
    actions: ['move'],
    physics: {
      body: 'fixed',
      colliders: [
        { shape: 'box', halfExtents: [0.38, 0.05, 0.38], translation: [0, 0.72, 0] },
        { shape: 'box', halfExtents: [0.38, 0.48, 0.05], translation: [0, 1.16, -0.33] }
      ]
    },
    surfaces: [{ id: 'seat', localPosition: [0, 0.78, 0], size: [0.7, 0.7] }]
  },
  cup: {
    id: 'cup', type: 'cup', label: 'Cup', tags: ['cup', 'mug', 'drinkware', '杯子'], aliases: ['mug', 'coffee cup'], source: { kind: 'builtin' },
    actions: ['pickup', 'drop', 'place', 'move'],
    physics: {
      body: 'dynamic', mass: 0.3,
      colliders: [{ shape: 'cylinder', halfHeight: 0.16, radius: 0.15, translation: [0, 0.16, 0] }]
    }
  },
  table: {
    id: 'table', type: 'table', label: 'Table', tags: ['table', 'furniture', 'surface', '桌子'], aliases: ['desk'], source: { kind: 'builtin' }, actions: ['move'],
    physics: {
      body: 'fixed',
      colliders: [
        { shape: 'box', halfExtents: [1.2, 0.08, 0.625], translation: [0, 1, 0] },
        ...[-1.02, 1.02].flatMap(x => [-0.46, 0.46].map(z => ({ shape: 'box', halfExtents: [0.07, 0.47, 0.07], translation: [x, 0.47, z] })))
      ]
    },
    surfaces: [{ id: 'top', localPosition: [0, 1.1, 0], size: [2.2, 1.05] }]
  },
  cabinet: {
    id: 'cabinet', type: 'cabinet', label: 'Cabinet', tags: ['cabinet', 'storage', 'furniture', '柜子'], aliases: ['cupboard'], source: { kind: 'glb', url: 'assets/cabinet.glb' },
    requiredNodes: ['Body', 'doorHinge', 'Door'],
    actions: ['open', 'close', 'move'],
    physics: {
      body: 'fixed',
      colliders: [{ shape: 'box', halfExtents: [0.85, 1, 0.32], translation: [0, 1, -0.04] }]
    },
    parts: {
      door: {
        node: 'doorHinge', semantic: 'door', actions: ['open', 'close'], targets: { open: -1.35, close: 0 },
        physics: {
          body: 'dynamic', mass: 8,
          colliders: [{ shape: 'box', halfExtents: [0.81, 0.95, 0.04], translation: [0.81, 0, 0] }]
        },
        joint: {
          type: 'revolute', axis: [0, 1, 0], limits: [-1.35, 0],
          parentAnchor: [-0.82, 1, 0.39], childAnchor: [0, 0, 0],
          motor: { stiffness: 45, damping: 9 }
        }
      }
    }
  }
};
