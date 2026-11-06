/* 吴苑澄观 · 地形、园路、植被花木与远景借景
 * 高度场地形（顶点色草土湿岸）、花街园路、松柳竹桂银杏玉兰梅枫芭蕉、
 * 荷叶荷花芦苇书带草苔、远景林带与灵岩山山脊。植被全部 GPU Instancing。
 */
import * as THREE from 'three';
import {
  boxGeo, transform, tube, clamp, smooth, fbm, mulberry32, rr,
  WORLD, QUALITY, waterSDF, terrainHeight, POOLS, ISLES,
} from './core.js';
import { put, addPavingPatch } from './arch.js';

/* 建筑占地避让（与 buildings.js 布点一致） */
const FOOTPRINTS = [
  [0, 104, 34, 20], [0, 92, 18, 6], [0, 80, 23, 11], [0, 68, 32, 18],
  [0, 58, 31, 15], [0, 46, 28, 12], [0, 30, 27, 13], [0, 22, 26, 7],
  [-30, 18, 14, 9], [58, 26, 12, 9], [20, -60, 22, 14], [68, -54, 10, 10],
  [-82, 34, 9, 9], [44, 6, 10, 10], [38, -34, 21, 7], [-64, -40, 34, 30],
  [-48, 10, 18, 18], [-80, 44, 14, 5], [-84, 58, 8, 36], [-100, 48, 6, 40],
  [44, 12, 22, 22], [0, -12, 26, 18], [-34, -24, 16, 13], [28, -18, 16, 13],
];
function freeLand(x, z, pad = 1.2) {
  if (Math.abs(x) > 106 || Math.abs(z) > 91) return false;
  if (waterSDF(x, z) < pad) return false;
  for (const [bx, bz, bw, bd] of FOOTPRINTS) {
    if (Math.abs(x - bx) < bw / 2 + pad && Math.abs(z - bz) < bd / 2 + pad) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * 1. 地形（高度场 + 顶点色）
 * ------------------------------------------------------------------ */
function buildTerrain(scene, M) {
  const [W, D] = WORLD.ground;
  const segX = 168, segZ = 148;
  const geo = new THREE.PlaneGeometry(W, D, segX, segZ);
  geo.rotateX(-Math.PI / 2);
  const p = geo.getAttribute('position');
  const colors = new Float32Array(p.count * 3);
  const grass = new THREE.Color(0x6d7c4c), dry = new THREE.Color(0x9a9464);
  const moss = new THREE.Color(0x4c6840), wet = new THREE.Color(0x5c6046);
  const outer = new THREE.Color(0x71805a);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, terrainHeight(x, z));
    const n = fbm(x * 0.02 + 5, z * 0.02 + 9, 61, 4);
    const w = waterSDF(x, z);
    c.copy(grass).lerp(dry, clamp((n - 0.42) * 1.5, 0, 0.55));
    c.lerp(moss, smooth(0.58, 0.82, fbm(x * 0.05, z * 0.05, 73, 3)) * 0.45);
    if (w < 2.6) c.lerp(wet, 1 - smooth(-0.4, 2.6, w));
    // 西北叠石山地：混入石灰/苔色，避免大片土黄与湖石脱节
    const rocky = Math.exp(-((x + 64) ** 2 / 1900 + (z + 40) ** 2 / 1500));
    if (rocky > 0.02) c.lerp(new THREE.Color(0x7f8776), rocky * 0.62);
    const inGarden = Math.abs(x) < 112 && Math.abs(z) < 97;
    if (!inGarden) c.lerp(outer, 0.42);
    const shade = 0.88 + n * 0.24;
    colors[i * 3] = c.r * shade; colors[i * 3 + 1] = c.g * shade; colors[i * 3 + 2] = c.b * shade;
  }
  p.needsUpdate = true;
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 26, uv.getY(i) * 23);
  const mesh = new THREE.Mesh(geo, M.ground);
  mesh.name = '地形';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  scene.add(mesh);
  return mesh;
}

/* ------------------------------------------------------------------ *
 * 2. 园路网（花街铺地贴片）
 * ------------------------------------------------------------------ */
function buildPathPatches(scene, M, BatchClass) {
  const B = new BatchClass(40);
  const paths = [
    [[0, 94], [0, 84], [0, 74], [0, 64]],                    // 中轴
    [[-18, 68], [-18, 46], [-18, 38], [-16, 30]],            // 西侧游廊路
    [[18, 68], [18, 46], [18, 38], [16, 30]],                // 东侧游廊路
    [[-18, 46], [-40, 42], [-62, 44], [-80, 50], [-84, 64]], // 通往竹里馆
    [[18, 46], [40, 42], [60, 38], [70, 30]],                // 通往荷池
    [[-56, 25], [-70, 22], [-84, 16], [-92, 6]],             // 西岸
    [[52, 21], [64, 20], [78, 16], [88, 6]],                 // 东岸
    [[4, -50], [20, -50], [36, -50], [52, -56], [66, -60]],  // 北岸
    [[-30, -48], [-16, -50], [4, -50]],                      // 北岸西段
    [[-70, -18], [-78, -30], [-86, -44], [-90, -62]],        // 山后小径
  ];
  paths.forEach((pts, pi) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
      const len = Math.hypot(x2 - x1, z2 - z1);
      const steps = Math.max(1, Math.round(len / 2.4));
      for (let k = 0; k < steps; k++) {
        const t = (k + 0.5) / steps;
        const x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
        if (waterSDF(x, z) < 0.5) continue;
        const y = terrainHeight(x, z) + 0.055;
        addPavingPatch(B, M, x, z, len / steps + 0.12, pi === 0 ? 4.2 : 2.4, y,
          -Math.atan2(z2 - z1, x2 - x1), 0);
      }
    }
  });
  const g = new THREE.Group(); g.name = '花街园路'; scene.add(g);
  B.build(g);
  return g;
}

/* ------------------------------------------------------------------ *
 * 3. 植被几何与实例收集器
 * ------------------------------------------------------------------ */
function tuftGeo() {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.getAttribute('position');
  const rnd = mulberry32(8821);
  for (let i = 0; i < p.count; i++) {
    const k = 0.82 + rnd() * 0.34;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.86, p.getZ(i) * k);
  }
  p.needsUpdate = true; g.computeVertexNormals();
  return g;
}
function bladeGeo() {
  // 两片交叉草叶，带根深尖浅的顶点色
  const pos = [], col = [], idx = [];
  const add = (x0, z0, ang) => {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const b = pos.length / 3;
    const w = 0.075, h = 0.62;
    pos.push(-w * ca, 0, -w * sa, w * ca, 0, w * sa, -w * 0.30 * ca, h, -w * 0.30 * sa,
      w * 0.30 * ca, h, w * 0.30 * sa);
    col.push(0.24, 0.34, 0.16, 0.24, 0.34, 0.16, 0.52, 0.66, 0.30, 0.52, 0.66, 0.30);
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  };
  add(0, 0, 0); add(0, 0, Math.PI / 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function lotusLeafGeo() {
  const N = 20, pos = [0, 0.02, 0], col = [0.30, 0.52, 0.24], idx = [];
  for (let i = 0; i <= N; i++) {
    const a = i * Math.PI * 2 / N;
    const notch = (i === 0 || i === N) ? 0.18 : 1;
    const r = (0.46 + Math.sin(a * 5) * 0.012) * notch;
    pos.push(Math.cos(a) * r, 0.035 + Math.sin(a * 7) * 0.012, Math.sin(a) * r);
    col.push(0.30 + (i % 3) * 0.02, 0.50 + (i % 4) * 0.018, 0.24);
  }
  for (let i = 1; i <= N; i++) idx.push(0, i, i + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function petalGeo() {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.14, 0.12, 0.16, 0.34, 0, 0.46);
  s.bezierCurveTo(-0.16, 0.34, -0.14, 0.12, 0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false, curveSegments: 5 });
  g.rotateX(-Math.PI / 2 + 0.42);
  return g;
}

const GRASS_VERT = `
  uniform vec3 uCam; uniform float uTime; uniform float uNear; uniform float uFar;
  attribute vec3 color;
  varying vec3 vCol; varying float vFog;
  void main(){
    vec4 base = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float d = distance(uCam, base.xyz);
    float k = 1.0 - smoothstep(uNear, uFar, d);
    vec3 p = position * k;
    p.x += sin(uTime * 1.3 + base.x * 0.35 + base.z * 0.2) * 0.07 * p.y;
    vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
    vCol = color;
    vFog = clamp(1.0 - exp(-0.0020 * d), 0.0, 1.0);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const GRASS_FRAG = `
  precision highp float;
  uniform vec3 uFogColor; uniform float uWet;
  varying vec3 vCol; varying float vFog;
  void main(){
    vec3 c = vCol * mix(1.0, 0.72, uWet);
    c = mix(c, uFogColor, vFog * 0.85);
    gl_FragColor = vec4(c, 1.0);
  }`;

class InstCollector {
  constructor(geo, mat, name) { this.geo = geo; this.mat = mat; this.name = name; this.list = []; }
  add(pos, rot, scale, color) {
    this.list.push({ pos, rot, scale, color });
  }
  build(scene, opts = {}) {
    if (!this.list.length) return null;
    const im = new THREE.InstancedMesh(this.geo, this.mat, this.list.length);
    im.name = this.name;
    im.castShadow = !!opts.castShadow;
    im.receiveShadow = !!opts.receiveShadow;
    im.frustumCulled = !!opts.frustumCulled;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const c = new THREE.Color();
    this.list.forEach((it, i) => {
      e.set(it.rot[0], it.rot[1], it.rot[2]);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(...it.pos), q, new THREE.Vector3(...it.scale));
      im.setMatrixAt(i, m);
      if (it.color !== undefined) im.setColorAt(i, c.set(it.color));
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    scene.add(im);
    return im;
  }
}

/* ------------------------------------------------------------------ *
 * 4. 树木：主干（合批）+ 叶簇（Instancing）
 * ------------------------------------------------------------------ */
const SPECIES = {
  pine:      { leaf: 0x35543a, scale: [1.0, 0.42, 1.0], clusters: 5, trunk: 0x4a3a2a, h: 7.5 },
  willow:    { leaf: 0x7c9a52, scale: [0.62, 0.36, 0.62], clusters: 9, trunk: 0x5a4a34, h: 8.5 },
  osmanthus: { leaf: 0x456b3c, scale: [1.0, 0.78, 1.0], clusters: 8, trunk: 0x55452f, h: 6.2 },
  gingko:    { leaf: 0x9aa548, scale: [0.85, 1.10, 0.85], clusters: 7, trunk: 0x615540, h: 9.0 },
  magnolia:  { leaf: 0x548044, scale: [0.85, 0.95, 0.85], clusters: 7, trunk: 0x5b4c38, h: 7.0 },
  plum:      { leaf: 0x6b7a48, scale: [0.72, 0.60, 0.72], clusters: 6, trunk: 0x41372c, h: 5.2 },
  maple:     { leaf: 0x9b5138, scale: [0.92, 0.84, 0.92], clusters: 7, trunk: 0x4d4030, h: 6.4 },
  peach:     { leaf: 0xc48a92, scale: [0.80, 0.66, 0.80], clusters: 7, trunk: 0x55402f, h: 5.4 },
};
function addTree(ctx, sp, x, z, s, seed, collectors, trunkBatch, M) {
  const cfg = SPECIES[sp];
  const rnd = mulberry32(seed);
  const y = terrainHeight(x, z);
  const H = cfg.h * s;
  const lean = (rnd() - 0.5) * 0.5;
  // 主干：三段渐细圆柱
  const seg = 3;
  for (let i = 0; i < seg; i++) {
    const t0 = i / seg, t1 = (i + 1) / seg;
    const r0 = 0.30 * s * (1 - t0 * 0.55), r1 = 0.30 * s * (1 - t1 * 0.55);
    const g = new THREE.CylinderGeometry(r1, r0, H * (t1 - t0) + 0.06, 8);
    put(trunkBatch, g, M.bark,
      [x + lean * t0 * s, y + H * (t0 + t1) / 2, z + lean * t0 * s * 0.4],
      [(rnd() - 0.5) * 0.06, rnd() * 6.28, lean * 0.35]);
  }
  // 分枝
  for (let k = 0; k < 3; k++) {
    const a = rnd() * Math.PI * 2;
    const L = H * (0.22 + rnd() * 0.18);
    const g = new THREE.CylinderGeometry(0.045 * s, 0.10 * s, L, 6);
    put(trunkBatch, g, M.bark,
      [x + Math.cos(a) * L * 0.35, y + H * (0.58 + k * 0.10), z + Math.sin(a) * L * 0.35],
      [Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7]);
  }
  // 叶簇
  const leaf = collectors[sp];
  const n = Math.round(cfg.clusters * (0.8 + rnd() * 0.5));
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const r = (sp === 'pine' || sp === 'willow' ? 1.0 : 0.75) * (0.35 + rnd() * 0.72) * H * 0.42;
    const hy = sp === 'pine' ? H * (0.52 + (i % 3) * 0.16) : H * (0.62 + (rnd() - 0.5) * 0.42);
    const sz = (0.62 + rnd() * 0.62) * s * (sp === 'pine' ? 1.45 : 1.0);
    const col = new THREE.Color(cfg.leaf);
    col.offsetHSL((rnd() - 0.5) * 0.035, (rnd() - 0.5) * 0.10, (rnd() - 0.5) * 0.12);
    leaf.add([x + Math.cos(a) * r + lean * s, y + hy, z + Math.sin(a) * r],
      [rnd() * 0.4, rnd() * 6.28, rnd() * 0.4],
      [cfg.scale[0] * sz, cfg.scale[1] * sz, cfg.scale[2] * sz], col);
    if (sp === 'willow') {
      // 下垂柳条
      for (let k = 0; k < 3; k++) {
        const t = (k + 1) / 4;
        leaf.add([x + Math.cos(a) * r * 1.15, y + hy - t * H * 0.40, z + Math.sin(a) * r * 1.15],
          [0, rnd() * 6.28, 0], [0.22 * s, (0.42 + rnd() * 0.3) * s, 0.22 * s], col);
      }
    }
  }
  // 玉兰 / 梅 / 桃花：点缀花簇
  if (sp === 'magnolia' || sp === 'plum' || sp === 'peach') {
    const flower = collectors.flower;
    const fc = sp === 'magnolia' ? 0xf3ece0 : sp === 'plum' ? 0xe9c9cf : 0xe8a3ab;
    for (let i = 0; i < 9; i++) {
      const a = rnd() * Math.PI * 2, r = rnd() * H * 0.32;
      flower.add([x + Math.cos(a) * r, y + H * (0.60 + rnd() * 0.34), z + Math.sin(a) * r],
        [0, rnd() * 6.28, 0], [0.16 * s, 0.16 * s, 0.16 * s], new THREE.Color(fc));
    }
  }
  return { x, z, y, H };
}

/* ------------------------------------------------------------------ *
 * 5. 竹、芭蕉、荷、芦苇、草、苔
 * ------------------------------------------------------------------ */
function buildBamboo(scene, M, ctx, collectors, count) {
  const rnd = mulberry32(3301);
  const cane = collectors.bambooCane, leaf = collectors.bambooLeaf;
  const regions = [
    { x: -84, z: 40, rx: 14, rz: 24, n: Math.round(count * 0.36) },
    { x: -94, z: -8, rx: 12, rz: 22, n: Math.round(count * 0.20) },
    { x: 76, z: -66, rx: 16, rz: 16, n: Math.round(count * 0.16) },
    { x: -34, z: -24, rx: 6, rz: 5, n: Math.round(count * 0.10) },  // 方丈岛
    { x: 42, z: -62, rx: 14, rz: 10, n: Math.round(count * 0.18) },
  ];
  regions.forEach(rg => {
    for (let i = 0; i < rg.n; i++) {
      let x = rg.x + (rnd() - 0.5) * rg.rx * 2, z = rg.z + (rnd() - 0.5) * rg.rz * 2;
      if (waterSDF(x, z) < 0.1) continue;
      // 月洞门 → 假山主峰的框景视线通廊：把竹子推到通廊两侧，避免竹竿贴脸遮挡画面
      if (Math.abs(x + 79) < 9 && z > 14 && z < 62) x += (x > -79 ? 11 : -11) + (rnd() - 0.5) * 2;
      if (waterSDF(x, z) < 0.1) continue;
      for (const [bx, bz, bw, bd] of FOOTPRINTS) {
        if (Math.abs(x - bx) < bw / 2 && Math.abs(z - bz) < bd / 2) { x += 3; break; }
      }
      const y = terrainHeight(x, z);
      const h = 4.4 + rnd() * 3.8;
      cane.add([x, y + h / 2, z], [(rnd() - 0.5) * 0.06, rnd() * 6.28, (rnd() - 0.5) * 0.06],
        [1, h / 6, 1], new THREE.Color().setHSL(0.24 + rnd() * 0.05, 0.30, 0.34 + rnd() * 0.14));
      for (let k = 0; k < 5; k++) {
        const a = rnd() * Math.PI * 2;
        leaf.add([x + Math.cos(a) * (0.5 + rnd()), y + h * (0.62 + k * 0.075), z + Math.sin(a) * (0.5 + rnd())],
          [rnd() * 0.5, rnd() * 6.28, rnd() * 0.4],
          [0.55 + rnd() * 0.35, 0.12, 0.55 + rnd() * 0.35],
          new THREE.Color().setHSL(0.25 + rnd() * 0.06, 0.34, 0.30 + rnd() * 0.16));
      }
    }
  });
}
function buildBanana(scene, M, ctx, BatchClass) {
  const B = new BatchClass(40);
  const rnd = mulberry32(4411);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x67924a, roughness: 0.88, side: THREE.DoubleSide });
  leafMat.name = 'bananaLeaf';
  const spots = [[-93, 36], [-95, 28], [-88, 20], [-68, 54], [62, 20], [70, 14], [26, 40], [-26, 40], [80, -32]];
  spots.forEach(([x, z], i) => {
    const y = terrainHeight(x, z);
    put(B, new THREE.CylinderGeometry(0.10, 0.16, 1.5, 7), M.bark, [x, y + 0.75, z]);
    for (let k = 0; k < 6; k++) {
      const a = k * Math.PI / 3 + rnd() * 0.4;
      const len = 1.5 + rnd() * 0.9;
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.bezierCurveTo(0.26, len * 0.25, 0.30, len * 0.7, 0, len);
      shape.bezierCurveTo(-0.30, len * 0.7, -0.26, len * 0.25, 0, 0);
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false, curveSegments: 5 });
      g.rotateX(-Math.PI / 2 + 0.55);
      put(B, g, leafMat, [x, y + 1.45, z], [0, a, 0], 0, { noShadow: true });
    }
  });
  const g = new THREE.Group(); g.name = '芭蕉'; scene.add(g); B.build(g);
  return g;
}
function buildLotus(scene, collectors, quality) {
  const rnd = mulberry32(5511);
  const leaf = collectors.lotus, flower = collectors.lotusFlower, reed = collectors.reed;
  const beds = [
    { x: 46, z: 8, n: 260 }, { x: 12, z: 4, n: 180 }, { x: -20, z: 2, n: 170 },
    { x: 34, z: -26, n: 140 }, { x: -46, z: -36, n: 120 }, { x: 8, z: -38, n: 110 },
  ];
  const total = Math.round(beds.reduce((a, b) => a + b.n, 0) * (0.45 + quality.leaves * 0.55));
  let made = 0;
  beds.forEach(b => {
    const n = Math.round(b.n * (0.45 + quality.leaves * 0.55));
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 13;
      const x = b.x + Math.cos(a) * r, z = b.z + Math.sin(a) * r;
      if (waterSDF(x, z) > -0.35) continue;
      const s = 0.55 + rnd() * 0.95;
      const y = WORLD.waterY + 0.03 + rnd() * 0.06;
      const col = new THREE.Color().setHSL(0.27 + rnd() * 0.05, 0.34, 0.30 + rnd() * 0.14);
      leaf.add([x, y, z], [0, rnd() * 6.28, (rnd() - 0.5) * 0.10], [s, s, s], col);
      if (rnd() < 0.14) {
        flower.add([x, y + 0.16, z], [0, rnd() * 6.28, 0], [s * 0.8, s * 0.8, s * 0.8],
          new THREE.Color(rnd() < 0.7 ? 0xf2d2d8 : 0xf6ece0));
      }
      made++;
    }
  });
  // 芦苇与菖蒲（岸边）
  for (let i = 0; i < 220; i++) {
    const x = (rnd() - 0.5) * 180, z = (rnd() - 0.5) * 100;
    const d = waterSDF(x, z);
    if (d > -0.15 || d < -2.6) continue;
    const s = 0.8 + rnd() * 1.2;
    reed.add([x, WORLD.waterY + 0.4 * s, z], [0, rnd() * 6.28, 0], [s, s, s],
      new THREE.Color().setHSL(0.19 + rnd() * 0.08, 0.30, 0.32 + rnd() * 0.16));
  }
  return made;
}
function buildGrass(scene, M, quality, fogColor) {
  const rnd = mulberry32(6611);
  const count = quality.grass;
  const geo = bladeGeo();
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uCam: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uNear: { value: 26 * quality.lodScale },
      uFar: { value: 62 * quality.lodScale },
      uFogColor: { value: fogColor.clone() },
      uWet: { value: 0 },
    },
    vertexShader: GRASS_VERT, fragmentShader: GRASS_FRAG,
    side: THREE.DoubleSide, vertexColors: false,
  });
  const im = new THREE.InstancedMesh(geo, mat, count);
  im.name = '书带草';
  im.frustumCulled = false;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  let used = 0;
  for (let i = 0; i < count * 3 && used < count; i++) {
    const x = (rnd() - 0.5) * 216, z = (rnd() - 0.5) * 186;
    if (waterSDF(x, z) < 0.3) continue;
    let blocked = false;
    for (const [bx, bz, bw, bd] of FOOTPRINTS) {
      if (Math.abs(x - bx) < bw / 2 + 0.4 && Math.abs(z - bz) < bd / 2 + 0.4) { blocked = true; break; }
    }
    if (blocked) continue;
    const y = terrainHeight(x, z);
    const s = 0.55 + rnd() * 1.15;
    e.set(0, rnd() * 6.28, (rnd() - 0.5) * 0.2);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s));
    im.setMatrixAt(used, m);
    used++;
  }
  im.count = used;
  im.userData.maxCount = used;
  im.instanceMatrix.needsUpdate = true;
  scene.add(im);
  return im;
}

/* ------------------------------------------------------------------ *
 * 6. 远景林带与借景远山
 * ------------------------------------------------------------------ */
function buildDistantForest(scene, M, quality) {
  const rnd = mulberry32(7711);
  // 低模树：不规则双团树冠 + 细干，合并为单几何（远景剪影比纯圆锥自然）
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.30, 0.52, 2.6, 5);
  trunk.translate(0, 1.3, 0); parts.push(trunk);
  const crown = new THREE.IcosahedronGeometry(1, 0);
  crown.scale(2.05, 2.55, 1.95); crown.translate(0, 4.1, 0); parts.push(crown);
  const crown2 = new THREE.IcosahedronGeometry(1, 0);
  crown2.scale(1.30, 1.45, 1.28); crown2.translate(0.55, 5.9, -0.30); parts.push(crown2);
  // 简易合并（都用同样属性）
  const pos = [], nrm = [], uv = [], idx = [];
  parts.forEach(p => {
    const g = p.index ? p.toNonIndexed() : p;
    const pp = g.getAttribute('position'), nn = g.getAttribute('normal'), uu = g.getAttribute('uv');
    const off = pos.length / 3;
    for (let i = 0; i < pp.count; i++) {
      pos.push(pp.getX(i), pp.getY(i), pp.getZ(i));
      nrm.push(nn.getX(i), nn.getY(i), nn.getZ(i));
      uv.push(uu ? uu.getX(i) : 0, uu ? uu.getY(i) : 0);
      idx.push(off + i);
    }
    if (g !== p) g.dispose();
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const mat = new THREE.MeshLambertMaterial({ color: 0x72836a });
  const n = Math.round(640 * quality.trees);
  const im = new THREE.InstancedMesh(geo, mat, n);
  im.name = '远景林带（L3 低模）';
  im.frustumCulled = false;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 145 + rnd() * 105;   // 全部落在 640×560 地形范围内
    let x = Math.cos(a) * r, z = Math.sin(a) * r * 0.92;
    // 北寺塔方向留出视线通廊：把树推离视廊而不是跳过（避免留下单位矩阵实例）
    if (x < -120 && z < -120 && Math.abs(x - z * 0.78) < 55) x -= 95;
    const y = terrainHeight(x, z);
    const s = 0.70 + rnd() * 0.85;
    e.set(0, rnd() * 6.28, 0); q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, y - 0.4, z), q, new THREE.Vector3(s, s * (0.82 + rnd() * 0.5), s));
    im.setMatrixAt(i, m);
    // 低饱和灰绿，随大气雾自然消隐
    im.setColorAt(i, c.setHSL(0.26 + rnd() * 0.07, 0.12 + rnd() * 0.16, 0.34 + rnd() * 0.18));
  }
  im.instanceMatrix.needsUpdate = true;
  im.userData.maxCount = n;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  scene.add(im);
  return im;
}
function buildMountains(scene) {
  const group = new THREE.Group(); group.name = '借景远山 · 灵岩山脊';
  // 山脊全部落在地形网格内（z ≥ −280），避免地形边缘出现硬切直线
  const layers = [
    { z: -212, h: 18, color: 0x778b88, amp: 1.0 },
    { z: -246, h: 28, color: 0x8b9c9b, amp: 1.4 },
    { z: -276, h: 40, color: 0xa3b1ae, amp: 1.8 },
  ];
  layers.forEach((L, li) => {
    const N = 90, pos = [], col = [], idx = [];
    const c = new THREE.Color(L.color);
    for (let i = 0; i <= N; i++) {
      const x = -310 + i * 620 / N;
      const ridge = (Math.sin(x * 0.011 + li * 1.7) * 0.5 + Math.sin(x * 0.027 + li * 2.3) * 0.28
        + Math.sin(x * 0.005 + 1.1) * 0.42 + 0.8) * L.h * L.amp;
      const baseY = terrainHeight(x, L.z) - 4;
      pos.push(x, baseY, L.z, x, baseY + ridge, L.z + Math.sin(x * 0.01) * 8);
      col.push(c.r * 0.72, c.g * 0.72, c.b * 0.72, c.r, c.g, c.b);
    }
    for (let i = 0; i < N; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true });
    const mesh = new THREE.Mesh(g, m);
    mesh.name = '山脊层' + li;
    group.add(mesh);
  });
  scene.add(group);
  return group;
}

/* ------------------------------------------------------------------ *
 * 7. 主入口
 * ------------------------------------------------------------------ */
export function createNature(scene, M, ctx) {
  const quality = ctx.quality;
  const BatchClass = ctx.BatchClass;
  const terrain = buildTerrain(scene, M);
  const pathGroup = buildPathPatches(scene, M, BatchClass);

  // 收集器
  const leafGeo = tuftGeo();
  const collectors = {};
  Object.keys(SPECIES).forEach(k => {
    const mat = new THREE.MeshStandardMaterial({
      color: SPECIES[k].leaf, roughness: 0.92, flatShading: true, side: THREE.DoubleSide,
    });
    mat.name = 'leaf_' + k;
    collectors[k] = new InstCollector(leafGeo, mat, '叶簇_' + k);
  });
  collectors.flower = new InstCollector(new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }), '花簇');
  const bambooMat = new THREE.MeshStandardMaterial({ color: 0x8aa264, roughness: 0.78 });
  collectors.bambooCane = new InstCollector(new THREE.CylinderGeometry(0.055, 0.065, 6, 6, 1), bambooMat, '竹竿');
  collectors.bambooLeaf = new InstCollector(new THREE.PlaneGeometry(1, 0.26),
    new THREE.MeshStandardMaterial({ color: 0x6e924c, roughness: 0.9, side: THREE.DoubleSide }), '竹叶');
  const lotusMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, side: THREE.DoubleSide, vertexColors: true });
  collectors.lotus = new InstCollector(lotusLeafGeo(), lotusMat, '荷叶');
  collectors.lotusFlower = new InstCollector(petalGeo(), new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.82, side: THREE.DoubleSide }), '荷花');
  collectors.reed = new InstCollector(new THREE.ConeGeometry(0.10, 1.4, 4), new THREE.MeshStandardMaterial({
    color: 0x7d8c52, roughness: 0.9 }), '芦苇');

  // 树干合批
  const trunkBatch = new BatchClass(40);
  // 景区化植物配置
  const regions = [
    { x0: -102, x1: -44, z0: -74, z1: -12, sp: ['pine', 'plum', 'pine', 'maple'], n: 34, s: [0.8, 1.3] }, // 云根叠翠
    { x0: -104, x1: -66, z0: 22, z1: 76, sp: ['plum', 'osmanthus'], n: 22, s: [0.7, 1.0] },   // 竹里馆
    { x0: 30, x1: 100, z0: 6, z1: 34, sp: ['willow', 'peach', 'magnolia'], n: 24, s: [0.85, 1.2] }, // 荷风
    { x0: 48, x1: 100, z0: -84, z1: -36, sp: ['osmanthus', 'gingko', 'maple'], n: 26, s: [0.8, 1.2] }, // 小山丛桂
    { x0: -30, x1: 34, z0: 34, z1: 74, sp: ['magnolia', 'osmanthus'], n: 18, s: [0.8, 1.1] },  // 前庭
    { x0: -100, x1: -32, z0: -8, z1: 24, sp: ['willow', 'plum', 'pine'], n: 20, s: [0.8, 1.1] },// 漱石枕流
    { x0: -20, x1: 60, z0: -88, z1: -56, sp: ['pine', 'osmanthus', 'gingko'], n: 22, s: [0.8, 1.15] }, // 北岸
    { x0: 66, x1: 104, z0: -30, z1: 4, sp: ['willow', 'peach'], n: 14, s: [0.8, 1.1] },        // 东岸
  ];
  const rnd = mulberry32(9911);
  let treeCount = 0;
  regions.forEach((rg, ri) => {
    const n = Math.round(rg.n * (0.55 + quality.trees * 0.45));
    let local = 0;
    for (let i = 0; i < n * 10 && local < n; i++) {
      const x = rg.x0 + rnd() * (rg.x1 - rg.x0), z = rg.z0 + rnd() * (rg.z1 - rg.z0);
      if (!freeLand(x, z, 2.4)) continue;
      const ft = clamp((51 - z) / 91, 0, 1);
      if (ft > 0.02 && ft < 1 && Math.abs(x + 81.3 - 17.3 * ft) < 6) continue;
      const sp = rg.sp[Math.floor(rnd() * rg.sp.length)];
      const s = rg.s[0] + rnd() * (rg.s[1] - rg.s[0]);
      addTree(ctx, sp, x, z, s, 10000 + ri * 1000 + i, collectors, trunkBatch, M);
      treeCount++; local++;
    }
  });
  // 中轴对植玉兰（对称礼序）
  [[-9, 68], [9, 68], [-9, 48], [9, 48], [-11, 40], [11, 40]].forEach(([x, z], i) => {
    addTree(ctx, 'magnolia', x, z, 0.95, 20000 + i, collectors, trunkBatch, M);
  });
  // 水边垂柳（对景构图）
  [[-24, 20], [-16, 20], [22, 20], [34, 18], [52, 14], [-58, 2], [8, -46], [-20, -46], [60, -20]].forEach(([x, z], i) => {
    if (freeLand(x, z, 0.6) || waterSDF(x, z) > -1.2)
      addTree(ctx, 'willow', x, z, 1.05, 21000 + i, collectors, trunkBatch, M);
  });

  const trunkGroup = new THREE.Group(); trunkGroup.name = '树干与枝'; scene.add(trunkGroup);
  const trunkStats = trunkBatch.build(trunkGroup);

  // 竹、荷、芦苇先填充实例数据，再统一创建 InstancedMesh（一次性成型）
  buildBamboo(scene, M, ctx, collectors, Math.round(520 * quality.trees));
  buildLotus(scene, collectors, quality);
  const instances = [];
  Object.values(collectors).forEach(c => {
    const im = c.build(scene, { castShadow: c.name.startsWith('叶簇'), receiveShadow: false, frustumCulled: false });
    if (im) instances.push(im);
  });

  const banana = buildBanana(scene, M, ctx, BatchClass);
  const grassMat = new THREE.Color(0xb9c2ba);
  // 始终按最高档容量分配实例缓冲，画质切换只改 count，避免重建几何
  const grass = buildGrass(scene, M, QUALITY.high, grassMat);
  const forest = buildDistantForest(scene, M, QUALITY.high);
  const mountains = buildMountains(scene);

  const api = {
    terrain, pathGroup, trunkGroup, trunkStats, instances, grass, forest, mountains, treeCount,
    applyQuality(q) {
      grass.material.uniforms.uNear.value = 26 * q.lodScale;
      grass.material.uniforms.uFar.value = 62 * q.lodScale;
      const target = Math.round(q.grass);
      grass.count = Math.min(grass.userData.maxCount, target);
      const ft = Math.round(640 * q.trees);
      forest.count = Math.min(forest.userData.maxCount, ft);
      grass.material.uniforms.uWet.value = api._wet || 0;
    },
    setWeather(w, sky) {
      api._wet = w === 'rain' ? 1 : 0;
      grass.material.uniforms.uWet.value = api._wet;
      if (grass.material.uniforms.uFogColor) grass.material.uniforms.uFogColor.value.copy(sky.fogColor);
      const k = w === 'rain' ? 0.76 : w === 'mist' ? 0.90 : 1.0;
      Object.keys(SPECIES).forEach(key => {
        const c = collectors[key];
        if (c.mat) { c.mat.color.set(SPECIES[key].leaf).multiplyScalar(k); }
      });
    },
    update(t, camera) {
      grass.material.uniforms.uTime.value = t;
      grass.material.uniforms.uCam.value.copy(camera.position);
    },
  };
  api.applyQuality(quality);
  return api;
}
