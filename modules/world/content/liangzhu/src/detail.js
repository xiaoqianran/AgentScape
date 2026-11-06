/* 良渚 · 水城 —— 共用细部构件
 * 卵石护坡实例化、独木舟、干栏式房屋、木桩驳岸/码头、带洞框形土台、
 * 高程标尺、房址柱洞、夯土台阶。
 */
import * as THREE from 'three';
import {
  boxGeo, transform, put, frustumGeo, mulberry32, clamp, lerp,
} from './core.js';

/** 卵石 / 块石护坡：一次 InstancedMesh 承载成千上万块砾石 */
export function createRevetment(scene, M, placements, maxCount = 9000) {
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) * 1.0, p.getY(i) * 0.52, p.getZ(i) * 0.86);
  }
  p.needsUpdate = true; geo.computeVertexNormals();
  const mat = M.cobble.clone(); mat.name = 'revetmentCobble';
  const n = Math.min(placements.length, maxCount);
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
  mesh.name = '卵石护坡';
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  const rnd = mulberry32(880331);
  const rot = new THREE.Euler();
  for (let i = 0; i < n; i++) {
    const a = placements[i];
    const s = a.s ?? (0.35 + rnd() * 0.62);
    rot.set(rnd() * 0.6, rnd() * Math.PI * 2, rnd() * 0.5);
    q.setFromEuler(rot);
    m.compose(new THREE.Vector3(a.x, a.y, a.z), q, new THREE.Vector3(s, s * (0.7 + rnd() * 0.5), s));
    mesh.setMatrixAt(i, m);
    const k = 0.62 + rnd() * 0.52;
    c.setRGB(k, k * 0.97, k * 0.90);
    mesh.setColorAt(i, c);
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = false; mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}

/** 带矩形洞的水平框（用于瑶山「回」字形灰土围沟与砾石台面） */
export function frameGeo(ow, od, iw, id, h) {
  const s = new THREE.Shape();
  s.moveTo(-ow / 2, -od / 2); s.lineTo(ow / 2, -od / 2);
  s.lineTo(ow / 2, od / 2); s.lineTo(-ow / 2, od / 2); s.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-iw / 2, -id / 2); hole.lineTo(-iw / 2, id / 2);
  hole.lineTo(iw / 2, id / 2); hole.lineTo(iw / 2, -id / 2); hole.closePath();
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 4 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, h, 0);
  return g;
}

/** 独木舟：下半球壳 + 舷缘 + 横撑 + 艄公竹篙 */
export function makeCanoe(M, scene = null) {
  const g = new THREE.Group();
  const L = 6.4, W = 1.15, H = 0.46;
  const hull = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.wood);
  hull.scale.set(W / 2, H, L / 2);
  hull.rotation.y = Math.PI / 2;   // 长轴沿 Z
  hull.castShadow = true; g.add(hull);
  const inner = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.82, L * 0.86),
    new THREE.MeshStandardMaterial({ color: 0x2c2319, roughness: 0.96, side: THREE.DoubleSide }));
  inner.rotation.x = -Math.PI / 2; inner.position.y = 0.015; g.add(inner);
  for (const z of [-1.7, 0.3, 2.0]) {
    const bench = new THREE.Mesh(boxGeo(W * 0.9, 0.09, 0.22), M.darkWood);
    bench.position.set(0, 0.06, z); g.add(bench);
  }
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 4.2, 6), M.rope);
  pole.position.set(0.42, 1.7, -1.1); pole.rotation.z = 0.20; g.add(pole);
  const figure = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.27, 1.15, 7), M.darkWood);
  figure.position.set(0, 0.72, -1.25); g.add(figure);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), M.rope);
  head.position.set(0, 1.38, -1.25); g.add(head);
  if (scene) scene.add(g);
  return g;
}

/** 干栏式房屋：架空木地板、柱列、茅草双坡屋顶、山墙 */
export function makeHouse(B, M, x, y, z, w, d, opts = {}) {
  const h = opts.h ?? 2.4, stilt = opts.stilt ?? 0.62;
  const dir = opts.dir ?? 0;
  const t = (px, py, pz) => [x + px * Math.cos(dir) - pz * Math.sin(dir), y + py,
                              z + px * Math.sin(dir) + pz * Math.cos(dir)];
  const add = (geo, mat, off, ry = 0, sc = [1, 1, 1]) => {
    const p = t(off[0], off[1], off[2]);
    put(B, geo, mat, p, [0, ry + dir, 0], sc, { noZone: false });
  };
  const floor = boxGeo(w, 0.16, d);
  add(floor, M.wood, [0, stilt, 0]);
  const nx = Math.max(3, Math.round(w / 2.6)), nz = Math.max(2, Math.round(d / 2.6));
  const post = new THREE.CylinderGeometry(0.105, 0.13, stilt + h * 0.28, 6);
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
    const px = -w / 2 + w * i / nx, pz = -d / 2 + d * j / nz;
    add(post, M.darkWood, [px, (stilt + h * 0.28) / 2, pz]);
  }
  /* 墙身：低矮木骨泥墙 */
  add(boxGeo(w * 0.98, h * 0.62, 0.10), M.thatch, [0, stilt + h * 0.31, -d / 2]);
  add(boxGeo(w * 0.98, h * 0.62, 0.10), M.thatch, [0, stilt + h * 0.31, d / 2]);
  add(boxGeo(0.10, h * 0.62, d * 0.98), M.thatch, [-w / 2, stilt + h * 0.31, 0]);
  add(boxGeo(0.10, h * 0.62, d * 0.98), M.thatch, [w / 2, stilt + h * 0.31, 0]);
  /* 双坡茅草顶：两片倾斜厚板 */
  const slope = Math.atan2(h * 0.78, d / 2 + 0.6);
  const roofLen = Math.hypot(d / 2 + 0.6, h * 0.78);
  for (const s of [-1, 1]) {
    const roof = boxGeo(w + 1.1, 0.20, roofLen);
    const off = [0, stilt + h * 0.62 + h * 0.39, s * (d / 4 + 0.3)];
    const p = t(off[0], off[1], off[2]);
    put(B, roof, M.thatch, p, [s * slope, dir, 0], [1, 1, 1]);
  }
  /* 屋脊 */
  add(boxGeo(w + 1.3, 0.16, 0.24), M.darkWood, [0, stilt + h * 0.62 + h * 0.78, 0]);
}

/** 木桩驳岸 / 码头：沿折线布桩并铺木板 */
export function makePileQuay(B, M, pts, baseY, opts = {}) {
  const spacing = opts.spacing ?? 2.2, width = opts.width ?? 3.0;
  const pile = new THREE.CylinderGeometry(0.10, 0.13, 2.4, 6);
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
    const len = Math.hypot(x2 - x1, z2 - z1), n = Math.max(1, Math.round(len / spacing));
    const ang = -Math.atan2(z2 - z1, x2 - x1);
    for (let k = 0; k <= n; k++) {
      const t = k / n, px = x1 + (x2 - x1) * t, pz = z1 + (z2 - z1) * t;
      put(B, pile, M.darkWood, [px, baseY + 0.55, pz]);
      if (k < n) {
        const deck = boxGeo(len / n + 0.06, 0.13, width, 0.4);
        put(B, deck, M.wood, [px + (x2 - x1) / n / 2, baseY + 1.62, pz + (z2 - z1) / n / 2], [0, ang, 0]);
      }
    }
  }
}

/** 高程标尺：竖杆 + 每米刻度 + 顶端小牌 */
export function makeElevationRuler(B, M, x, y0, z, height, labelEvery = 2) {
  const rod = new THREE.CylinderGeometry(0.055, 0.055, height, 6);
  put(B, rod, M.darkWood, [x, y0 + height / 2, z]);
  const n = Math.floor(height);
  for (let i = 0; i <= n; i++) {
    const major = i % labelEvery === 0;
    const tick = boxGeo(major ? 0.85 : 0.42, 0.045, 0.05);
    put(B, tick, M.rope, [x + (major ? 0.42 : 0.21), y0 + i, z]);
  }
}

/** 房址柱洞群：浅色夯土台面上的暗色柱洞圆环 */
export function makePostHoles(B, M, x, y, z, w, d, nx = 4, nz = 3) {
  const hole = new THREE.CylinderGeometry(0.16, 0.16, 0.06, 8);
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    put(B, hole, M.darkWood,
      [x - w / 2 + w * (i + 0.5) / nx, y + 0.02, z - d / 2 + d * (j + 0.5) / nz]);
  }
}
