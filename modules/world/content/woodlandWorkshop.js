import * as THREE from 'three';

const NOTICE_DEFAULT = '林间工坊\n点一下牌子就能改字';
const SIGN_DEFAULT = '工坊入口';

// A canvas surface keeps editable text inside the world instead of in a second page layer.
// Without a document (headless tests) the surface is simply absent and geometry still loads.
function createTextSurface({ documentRef, width, height, font, color, background, border = null }) {
  const canvas = documentRef?.createElement?.('canvas');
  const context = canvas?.getContext?.('2d');
  if (!canvas || !context) return null;
  canvas.width = width; canvas.height = height;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const paint = (text) => {
    context.fillStyle = background;
    context.fillRect(0,0,width,height);
    if (border) {
      context.strokeStyle = border;
      context.lineWidth = 6;
      context.strokeRect(10,10,width-20,height-20);
    }
    context.fillStyle = color;
    context.font = font;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const lines = String(text ?? '').split('\n').slice(0,3);
    const step = height/(lines.length+1);
    lines.forEach((line,index)=>context.fillText(line,width/2,step*(index+1),width-56));
    texture.needsUpdate = true;
    return texture;
  };
  return { texture, paint };
}

// A cutaway workshop: the open front keeps both the work surface and courtyard readable.
export function createWoodlandWorkshop(options = {}) {
  const { editorHost = null, document: documentRef = globalThis.document } = options;
  const root = new THREE.Group();
  root.name = 'WoodlandWorkshop';
  root.userData.environment = 'woodland-workshop';
  const colliders = [];
  const materials = new Map();
  const material = (color) => {
    if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.88 }));
    return materials.get(color);
  };
  const box = (name, size, position, color, solid = true) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material(color));
    mesh.name = name;
    mesh.position.set(...position);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.navigationIgnore = !solid;
    root.add(mesh);
    if (solid) colliders.push({ shape: 'box', halfExtents: size.map(v => v / 2), translation: position });
    const lines = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: 0x514b3d, transparent: true, opacity: 0.28 }));
    lines.userData.navigationIgnore = true;
    mesh.add(lines);
    return mesh;
  };
  const outline = (mesh) => {
    const lines = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color:0x514b3d, transparent:true, opacity:0.28 }));
    lines.userData.navigationIgnore = true;
    mesh.add(lines);
    return mesh;
  };
  const floor = box('Meadow', [26, 0.3, 24], [0, -0.15, 0], 0xa6b593);
  box('Workshop floor', [12, 0.12, 9], [0, -0.06, -3.5], 0xe4d3b5);
  box('Back wall', [12, 3.8, 0.22], [0, 1.9, -8], 0xe8dcc3);
  box('West wall', [0.22, 2.7, 9], [-6, 1.35, -3.5], 0xd4c3a4);
  for (const x of [-5.8, 5.8]) {
    for (const z of [-7.7, 0.7]) box('Timber post', [0.24, 3.9, 0.24], [x, 1.95, z], 0x766148);
    box('Open roof beam', [0.26, 0.3, 9], [x, 3.9, -3.5], 0x766148);
  }
  box('Lintel', [12, 0.3, 0.26], [0, 3.9, 0.7], 0x766148);
  for (let i = 0; i < 7; i++) box('Garden stepping stone', [1.8, 0.04, 0.85], [0, 0.02, 1.7 + i * 1.3], 0xd8cfb9);
  for (const x of [-4.5, 4.5]) {
    box('Garden planter', [2.6, 0.45, 1.5], [x, 0.225, 4], 0xa88263);
    box('Herb bed', [2.3, 0.12, 1.2], [x, 0.51, 4], 0x728567, false);
  }
  for (const [x, z, h] of [[-10,-8,5],[-10,-2,4.5],[-11,5,3.5],[10,-8,5.6],[11,-2,3.6],[-5,-10,4],[5,-10,4.5]]) {
    box('Tree trunk', [0.45,h,0.45], [x,h/2,z], 0x847058);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(2, 1), material(0x718b6a));
    crown.position.set(x,h,z);
    crown.scale.set(1,1.25,1);
    crown.castShadow = true;
    crown.userData.navigationIgnore = true;
    root.add(crown);
  }
  box('Notice board frame', [3,1.35,0.12], [0,2,-7.8], 0x857055);
  // Editable surfaces: the board faces the courtyard, the sign faces the stepping-stone path.
  const noticeSurface = createTextSurface({
    documentRef, width:640, height:288,
    font:'700 56px Inter, "Microsoft YaHei", sans-serif', color:'#3d3a2f', background:'#f4ead4', border:'#b9ad90'
  });
  const noticeFace = new THREE.MeshStandardMaterial({ color:0xf4ead4, roughness:0.9 });
  if (noticeSurface) noticeFace.map = noticeSurface.texture;
  const noticeBorder = material(0xc9b891);
  const noticeBoard = new THREE.Mesh(new THREE.BoxGeometry(2.8,1.15,0.04), [noticeBorder,noticeBorder,noticeBorder,noticeBorder,noticeFace,noticeBorder]);
  noticeBoard.name = 'Notice board';
  noticeBoard.position.set(0,2,-7.71);
  noticeBoard.castShadow = noticeBoard.receiveShadow = true;
  outline(noticeBoard);
  root.add(noticeBoard);
  colliders.push({ shape:'box', halfExtents:[1.4,0.575,0.02], translation:[0,2,-7.71] });
  const signSurface = createTextSurface({
    documentRef, width:320, height:160,
    font:'700 52px Inter, "Microsoft YaHei", sans-serif', color:'#3b3226', background:'#e7d6b4', border:'#8a7455'
  });
  const signFace = new THREE.MeshStandardMaterial({ color:0xe7d6b4, roughness:0.92 });
  if (signSurface) signFace.map = signSurface.texture;
  const signEdge = material(0x6f5c45);
  const signBoard = new THREE.Mesh(new THREE.BoxGeometry(1.5,0.75,0.06), [signEdge,signEdge,signEdge,signEdge,signFace,signEdge]);
  signBoard.name = 'Workshop sign';
  signBoard.position.set(3.1,1.55,2.6);
  signBoard.castShadow = true;
  outline(signBoard);
  root.add(signBoard);
  box('Sign post', [0.16,1.2,0.16], [3.1,0.6,2.6], 0x6f5c45);
  root.add(new THREE.HemisphereLight(0xfff6df, 0x6a7861, 2.5));
  const sun = new THREE.DirectionalLight(0xffe5b8, 3);
  sun.position.set(-6,14,9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048,2048);
  Object.assign(sun.shadow.camera, { left:-17,right:17,top:17,bottom:-17,near:1,far:50 });
  root.add(sun);
  let noticeText = NOTICE_DEFAULT;
  let signText = SIGN_DEFAULT;
  const paint = () => {
    noticeSurface?.paint(noticeText);
    signSurface?.paint(signText);
  };
  paint();
  const openEditor = (id, value) => {
    const form = editorHost?.querySelector?.(`#${id}Editor`);
    const input = editorHost?.querySelector?.(`#${id}Input`);
    if (!form || !input) return false;
    input.value = value;
    form.classList.add('show');
    input.focus?.();
    input.select?.();
    return true;
  };
  const bindEditor = (id, read) => {
    const save = editorHost?.querySelector?.(`#${id}Ok`);
    if (!save) return false;
    save.addEventListener('click', () => {
      const input = editorHost.querySelector(`#${id}Input`);
      const next = String(input.value ?? '').trim() || read();
      env.setText(id === 'board' ? { board:next } : { sign:next });
      editorHost.querySelector(`#${id}Editor`)?.classList?.remove?.('show');
    });
    return true;
  };
  const env = {
    id:'woodland-workshop', root, floor, colliders,
    layout:{bounds:{min:[-12,-11],max:[12,11]},groundY:0,margin:1},
    camera:{position:[12,11,17],target:[0,1,-2]},
    rendering:{background:0xe8e5d7,fog:{color:0xe8e5d7,near:32,far:65},exposure:1},
    views:[
      { label:'全景', position:[12,11,17], target:[0,1,-2] },
      { label:'工坊', position:[-0.6,2.4,3.2], target:[0.2,1.7,-7.4] },
      { label:'庭院', position:[0.4,3.4,11.5], target:[0,1,2.5] }
    ],
    storageKey:'agentscape.woodland.text.v1',
    setText(next = {}) {
      if (next.board !== undefined) noticeText = String(next.board);
      if (next.sign !== undefined) signText = String(next.sign);
      paint();
      return { board:noticeText, sign:signText };
    },
    snapshot() { return { schemaVersion:1, text:{ board:noticeText, sign:signText } }; },
    restore(state) {
      if (state?.schemaVersion !== 1) return false;
      env.setText({ board:state.text?.board ?? noticeText, sign:state.text?.sign ?? signText });
      return true;
    },
    interactions:[
      { id:'workshop:notice', label:'告示板文字', object:noticeBoard, activate:()=>openEditor('board', noticeText) },
      { id:'workshop:sign', label:'木牌文字', object:signBoard, activate:()=>openEditor('sign', signText) }
    ],
    dispose() {
      noticeSurface?.texture.dispose();
      signSurface?.texture.dispose();
      noticeFace.dispose();
      signFace.dispose();
    }
  };
  bindEditor('board', () => NOTICE_DEFAULT);
  bindEditor('sign', () => SIGN_DEFAULT);
  return env;
}
