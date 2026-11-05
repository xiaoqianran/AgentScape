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
  house_door: {
    id:'house_door',type:'door',label:'House Door',
    tags:['door','house','entrance','门'],aliases:['hinged door'],
    source:{kind:'builtin'},
    requiredNodes:['doorHinge','Door'],
    actions:['open','close'],
    physics:{
      body:'fixed',
      colliders:[{shape:'box',halfExtents:[0.015,0.8,0.018],translation:[-0.8,1.6,0]}]
    },
    parts:{
      door:{
        node:'doorHinge',semantic:'door',
        actions:['open','close'],targets:{open:1.45,close:0},
        physics:{
          body:'dynamic',mass:12,friction:0.65,
          colliders:[{shape:'box',halfExtents:[0.59,1.01,0.0375],translation:[0.59,1.01,0]}]
        },
        joint:{
          type:'revolute',axis:[0,1,0],limits:[0,1.45],
          parentAnchor:[-0.6,0.62,0],childAnchor:[0,0,0],
          motor:{stiffness:80,damping:12}
        }
      }
    }
  },
  industrial_cabinet: {
    id:'industrial_cabinet',type:'cabinet',label:'Industrial Storage Cabinet',
    tags:['cabinet','industrial','storage','drawers','hinged doors','储物柜','工业'],
    aliases:['workshop cabinet','metal locker'],
    source:{kind:'builtin'},
    requiredNodes:['Body','LeftDoorHinge','RightDoorHinge','UpperDrawerSlide','LowerDrawerSlide'],
    actions:['open','close'],
    // Hollow fixed carcass. Moving parts have their own collision bodies and joints.
    physics:{
      body:'fixed',
      colliders:[
        {shape:'box',halfExtents:[0.04,0.94,0.365],translation:[-0.88,1.12,0]},
        {shape:'box',halfExtents:[0.04,0.94,0.365],translation:[0.88,1.12,0]},
        {shape:'box',halfExtents:[0.88,0.94,0.028],translation:[0,1.12,-0.35]},
        {shape:'box',halfExtents:[0.92,0.04,0.365],translation:[0,2.09,0]},
        {shape:'box',halfExtents:[0.92,0.04,0.365],translation:[0,0.18,0]},
        {shape:'box',halfExtents:[0.86,0.04,0.34],translation:[0,1.12,0]},
        {shape:'box',halfExtents:[0.86,0.0225,0.33],translation:[0,1.61,-0.01]},
        ...[-0.74,0.74].flatMap(x=>[-0.25,0.25].map(z=>({shape:'box',halfExtents:[0.08,0.065,0.08],translation:[x,0.065,z]})))
      ]
    },
    parts:{
      left_door:{
        node:'LeftDoorHinge',semantic:'door',actions:['open','close'],
        targets:{open:-1.30,close:0},
        physics:{body:'dynamic',mass:5,friction:0.6,
          colliders:[{shape:'box',halfExtents:[0.387,0.43,0.028],translation:[0.395,0,0]}]},
        joint:{type:'revolute',axis:[0,1,0],limits:[-1.35,0],
          parentAnchor:[-0.81,1.59,0.393],childAnchor:[0,0,0],
          motor:{stiffness:85,damping:13}}
      },
      right_door:{
        node:'RightDoorHinge',semantic:'door',actions:['open','close'],
        targets:{open:1.30,close:0},
        physics:{body:'dynamic',mass:5,friction:0.6,
          colliders:[{shape:'box',halfExtents:[0.387,0.43,0.028],translation:[-0.395,0,0]}]},
        joint:{type:'revolute',axis:[0,1,0],limits:[0,1.35],
          parentAnchor:[0.81,1.59,0.393],childAnchor:[0,0,0],
          motor:{stiffness:85,damping:13}}
      },
      upper_drawer:{
        node:'UpperDrawerSlide',semantic:'drawer',actions:['open','close'],
        targets:{open:0.45,close:0},
        physics:{body:'dynamic',mass:4,friction:0.55,
          colliders:[
            {shape:'box',halfExtents:[0.775,0.16,0.027],translation:[0,0,0.393]},
            {shape:'box',halfExtents:[0.725,0.0175,0.31],translation:[0,-0.137,0.065]},
            {shape:'box',halfExtents:[0.725,0.125,0.0175],translation:[0,0,-0.245]},
            {shape:'box',halfExtents:[0.018,0.125,0.305],translation:[-0.716,0,0.065]},
            {shape:'box',halfExtents:[0.018,0.125,0.305],translation:[0.716,0,0.065]}
          ]},
        joint:{type:'prismatic',axis:[0,0,1],limits:[0,0.48],
          parentAnchor:[0,0.81,0],childAnchor:[0,0,0],
          motor:{stiffness:85,damping:13}}
      },
      lower_drawer:{
        node:'LowerDrawerSlide',semantic:'drawer',actions:['open','close'],
        targets:{open:0.45,close:0},
        physics:{body:'dynamic',mass:4,friction:0.55,
          colliders:[
            {shape:'box',halfExtents:[0.775,0.16,0.027],translation:[0,0,0.393]},
            {shape:'box',halfExtents:[0.725,0.0175,0.31],translation:[0,-0.137,0.065]},
            {shape:'box',halfExtents:[0.725,0.125,0.0175],translation:[0,0,-0.245]},
            {shape:'box',halfExtents:[0.018,0.125,0.305],translation:[-0.716,0,0.065]},
            {shape:'box',halfExtents:[0.018,0.125,0.305],translation:[0.716,0,0.065]}
          ]},
        joint:{type:'prismatic',axis:[0,0,1],limits:[0,0.48],
          parentAnchor:[0,0.41,0],childAnchor:[0,0,0],
          motor:{stiffness:85,damping:13}}
      }
    }
  },
  cabinet: {
    id: 'cabinet', type: 'cabinet', label: 'Cabinet', tags: ['cabinet', 'storage', 'furniture', '柜子'], aliases: ['cupboard'], source: { kind: 'glb', url: 'assets/cabinet.glb' },
    requiredNodes: ['Body', 'doorHinge', 'Door'],
    actions: ['open', 'close', 'move'],
    physics: {
      body: 'fixed',
      // A cabinet is a shell, not a solid block. The open front is closed by the articulated Door part.
      colliders: [
        { shape:'box', halfExtents:[0.05,1,0.36], translation:[-0.80,1,0] },
        { shape:'box', halfExtents:[0.05,1,0.36], translation:[0.80,1,0] },
        { shape:'box', halfExtents:[0.75,0.05,0.32], translation:[0,0.05,0] },
        { shape:'box', halfExtents:[0.75,0.05,0.32], translation:[0,1.95,0] },
        { shape:'box', halfExtents:[0.75,0.90,0.04], translation:[0,1,-0.32] }
      ]
    },
    // Interior begins on the physical bottom shelf (0.05 + 0.05), so settled contents remain inside.
    receptacles: [{ id:'interior', localPosition:[0,0.95,-0.01], size:[1.40,1.70,0.46] }],
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
          motor: { stiffness: 80, damping: 12 }
        }
      }
    }
  }
};
