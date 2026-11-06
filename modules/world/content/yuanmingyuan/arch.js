/* 建筑语汇：巴洛克柱式、券拱、贝壳龛、雕花、琉璃屋顶、栏杆、生肖兽首 */
import * as THREE from 'three';
import {
  B, box, cbox, cyl, torus, sphere, R, rr, mulberry32, transform,
  boxGeo, chamferBoxGeo, flutedShaftGeo, shellGeo, tube, leafGeo, archWallGeo,
} from './core.js';

/* 科林斯柱：柱础 + 凹槽柱身 + 茛苕叶柱头 + 檐托 */
export function column(batch, M, o = {}) {
  const { x = 0, y = 0, z = 0, h = 6, r = 0.48, mat = M.marble, ruin = 0, seed = 1 } = o;
  const rnd = mulberry32(seed * 977 + 7);
  const baseH = h * 0.055;
  cbox(batch, mat, r * 2.75, baseH * 0.55, r * 2.75, [x, y + baseH * 0.275, z], [0, 0, 0], 0.025);
  cyl(batch, mat, r * 1.28, r * 1.16, baseH * 0.45, [x, y + baseH * 0.78, z], 20);
  torus(batch, mat, r * 1.12, r * 0.075, [x, y + baseH, z], Math.PI * 2, [Math.PI / 2, 0, 0]);
  const capH = h * 0.135;
  const shaftH = h - baseH - capH;
  const cut = ruin > 0 ? 0.35 + rnd() * 0.45 : 1;
  const sh = shaftH * cut;
  B(batch, mat, flutedShaftGeo(sh, r, r * 0.87, 20, r * 0.09, 8, 48), [x, y + baseH, z]);
  if (ruin > 0 && cut < 0.98) {
    // 断裂面：不规则残柱顶
    for (let i = 0; i < 5; i++) {
      const a = rnd() * Math.PI * 2;
      cbox(batch, M.stone, r * (0.35 + rnd() * 0.5), 0.12 + rnd() * 0.2, r * 0.5,
        [x + Math.cos(a) * r * 0.6, y + baseH + sh + rnd() * 0.1, z + Math.sin(a) * r * 0.6],
        [0, a, rnd() * 0.3], 0.02);
    }
    return;
  }
  // 柱头
  const cy = y + baseH + shaftH;
  cyl(batch, mat, r * 0.9, r * 1.18, capH * 0.62, [x, cy + capH * 0.31, z], 18);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    B(batch, mat, leafGeo(capH * 0.72, r * 0.3, 0.028),
      [x + Math.cos(a) * r * 0.98, cy + capH * 0.06, z + Math.sin(a) * r * 0.98],
      [0, -a + Math.PI / 2, 0.14]);
  }
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i / 4) * Math.PI * 2;
    torus(batch, mat, r * 0.23, r * 0.055,
      [x + Math.cos(a) * r * 0.8, cy + capH * 0.7, z + Math.sin(a) * r * 0.8],
      Math.PI * 1.45, [0, -a, Math.PI / 2]);
  }
  cbox(batch, mat, r * 2.5, capH * 0.17, r * 2.5, [x, cy + capH * 0.92, z], [0, Math.PI / 4, 0], 0.02);
  cbox(batch, mat, r * 2.2, capH * 0.1, r * 2.2, [x, cy + capH * 1.02, z], [0, 0, 0], 0.015);
}

/* 叠涩檐口 + 齿饰 */
export function cornice(batch, M, o) {
  const { x, y, z, w, d, mat = M.stone, dentils = true, layers = 3 } = o;
  for (let i = 0; i < layers; i++) {
    const e = 0.06 * i;
    cbox(batch, mat, w + e * 2, 0.13, d + e * 2, [x, y + i * 0.17, z], [0, 0, 0], 0.022);
  }
  if (dentils) {
    const n = Math.floor(w / 0.52);
    for (let i = 0; i < n; i++) {
      const px = x - w / 2 + (i + 0.5) * (w / n);
      box(batch, mat, 0.19, 0.2, 0.15, [px, y + layers * 0.17 - 0.02, z + d / 2 + 0.03]);
      box(batch, mat, 0.19, 0.2, 0.15, [px, y + layers * 0.17 - 0.02, z - d / 2 - 0.03]);
    }
  }
}

/* 石栏杆（望柱 + 宝瓶式栏板） */
export function balustrade(batch, M, o) {
  const { x1, z1, x2, z2, y = 0, mat = M.marble, h = 1.05, spacing = 1.15 } = o;
  const len = Math.hypot(x2 - x1, z2 - z1);
  const ang = Math.atan2(z2 - z1, x2 - x1);
  const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
  const rot = [0, -ang, 0];
  cbox(batch, mat, len, 0.16, 0.42, [cx, y + 0.08, cz], rot, 0.025);
  cbox(batch, mat, len, 0.13, 0.36, [cx, y + h, cz], rot, 0.025);
  const n = Math.max(2, Math.floor(len / spacing));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const px = x1 + (x2 - x1) * t, pz = z1 + (z2 - z1) * t;
    if (i % 4 === 0) {
      cbox(batch, mat, 0.28, h + 0.2, 0.28, [px, y + (h + 0.2) / 2, pz], rot, 0.025);
      sphere(batch, mat, 0.13, [px, y + h + 0.28, pz], [1, 1.2, 1], 8, 6);
    } else {
      const b = new THREE.LatheGeometry([
        new THREE.Vector2(0.10, 0), new THREE.Vector2(0.15, 0.12), new THREE.Vector2(0.095, 0.28),
        new THREE.Vector2(0.17, 0.48), new THREE.Vector2(0.10, 0.68), new THREE.Vector2(0.13, 0.82),
      ], 9);
      B(batch, mat, b, [px, y + 0.16, pz]);
    }
  }
}

/* 券拱壁龛：拱券线脚、拱心石、贝壳半穹、卷草浮雕 */
export function archedNiche(batch, M, o) {
  const { x, y, z, w = 2.2, h = 4.2, d = 0.5, mat = M.stone, shell = true, ry = 0 } = o;
  const co = Math.cos(ry), si = Math.sin(ry);
  const P = (dx, dy, dz = 0) => [x + dx * co + dz * si, y + dy, z - dx * si + dz * co];
  const spring = h - w * 0.5;
  // 侧壁与拱券线脚
  for (const s of [-1, 1]) {
    cbox(batch, mat, 0.28, spring, d * 0.55, P(s * w * 0.5, spring / 2, d * 0.1), [0, ry, 0], 0.03);
    cbox(batch, mat, 0.4, 0.22, d * 0.7, P(s * w * 0.5, 0.11, d * 0.1), [0, ry, 0], 0.03);
  }
  torus(batch, mat, w * 0.5, 0.15, P(0, spring, d * 0.12), Math.PI, [0, ry, 0]);
  torus(batch, mat, w * 0.5 - 0.24, 0.055, P(0, spring, d * 0.16), Math.PI, [0, ry, 0]);
  // 拱心石
  cbox(batch, M.marble, 0.42, 0.62, d * 0.62, P(0, h - 0.12, d * 0.18), [0, ry, 0], 0.035);
  // 凹龛背板
  box(batch, M.marbleD, w * 0.78, h * 0.86, 0.12, P(0, h * 0.43, -d * 0.12), [0, ry, 0]);
  if (shell) {
    const g = shellGeo(w * 0.38, 13, 32, 9);
    B(batch, M.marbleD, g, P(0, spring + w * 0.32, -d * 0.05), [0, ry, 0]);
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI;
      const r = w * 0.36;
      B(batch, M.marble, tube([
        [0, 0, 0], [Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.36, -r * 0.2],
        [Math.cos(a) * r, Math.sin(a) * r * 0.72, -r * 0.52],
      ], 0.022, 6, 4), P(0, spring + w * 0.32, -d * 0.05), [0, ry, 0]);
    }
  }
  // 基座托座
  cbox(batch, mat, w * 1.05, 0.34, d * 0.8, P(0, 0.17, d * 0.16), [0, ry, 0], 0.035);
  for (const s of [-1, 1]) {
    B(batch, M.marble, leafGeo(0.8, 0.22, 0.04), P(s * w * 0.36, 0.4, d * 0.2), [0, ry, s * 0.5]);
  }
}

/* 中式琉璃庑殿顶：曲面举折、反宇翘角、正脊垂脊与脊饰 */
export function hipRoof(batch, M, o) {
  const { x, y, z, w, d, h = 3.2, mat = M.roof, ridgeMat = M.ridge, ornaments = true } = o;
  const NX = 26, NZ = 16;
  const pos = [], uv = [], idx = [];
  const ridgeHalf = Math.max(1, w / 2 - d / 2);
  for (let i = 0; i <= NZ; i++) {
    for (let j = 0; j <= NX; j++) {
      const px = (j / NX - 0.5) * w, pz = (i / NZ - 0.5) * d;
      const tz = Math.abs(pz) / (d / 2);
      const tx = Math.max(0, (Math.abs(px) - ridgeHalf) / (d / 2));
      const t = Math.max(0, 1 - Math.max(tz, tx));
      let py = h * Math.pow(t, 1.75);
      py += 0.6 * Math.pow(Math.abs(px) / (w / 2), 4) * Math.pow(Math.abs(pz) / (d / 2), 3) * (1 - t);
      pos.push(px, py, pz);
      uv.push(j / NX * w * 0.32, i / NZ * d * 0.45);
    }
  }
  for (let i = 0; i < NZ; i++) for (let j = 0; j < NX; j++) {
    const a = i * (NX + 1) + j, b = a + NX + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  B(batch, mat, g, [x, y, z], [0, 0, 0], [1, 1, 1], { noZone: true });
  // 檐口封檐板
  cbox(batch, M.wood, w + 0.5, 0.28, d + 0.5, [x, y - 0.06, z], [0, 0, 0], 0.04, { noZone: true });
  // 正脊
  const rg = new THREE.CylinderGeometry(0.19, 0.19, ridgeHalf * 2 + 0.6, 8);
  B(batch, ridgeMat, rg, [x, y + h + 0.1, z], [0, 0, Math.PI / 2], [1, 1, 1], { noZone: true });
  // 四条垂脊
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    B(batch, ridgeMat, tube([
      [x + sx * ridgeHalf, y + h + 0.1, z],
      [x + sx * (ridgeHalf + (d / 2 - ridgeHalf) * 0.45), y + h * 0.62, z + sz * d * 0.24],
      [x + sx * w / 2, y + 0.42, z + sz * d / 2],
    ], 0.105, 12, 6), [0, 0, 0], [0, 0, 0], [1, 1, 1], { noZone: true });
    if (ornaments) {
      // 翘角翻尾石鱼
      B(batch, M.stone2, tube([
        [x + sx * w / 2, y + 0.5, z + sz * d / 2],
        [x + sx * (w / 2 + 0.5), y + 0.85, z + sz * (d / 2 + 0.42)],
        [x + sx * (w / 2 + 0.75), y + 1.55, z + sz * (d / 2 + 0.3)],
      ], 0.11, 10, 6), [0, 0, 0], [0, 0, 0], [1, 1, 1], { noZone: true });
      sphere(batch, M.stone2, 0.19, [x + sx * (w / 2 + 0.75), y + 1.55, z + sz * (d / 2 + 0.3)], [1, 0.7, 1.3], 8, 6, { noZone: true });
    }
  }
}

/* 巴洛克曲线山花 */
export function baroqueGable(batch, M, o) {
  const { x, y, z, w, h, d = 0.9, mat = M.stone, broken = true } = o;
  const s = new THREE.Shape();
  const hw = w / 2;
  s.moveTo(-hw, 0);
  s.lineTo(hw, 0);
  s.lineTo(hw, h * 0.18);
  s.bezierCurveTo(hw * 0.78, h * 0.5, hw * 0.55, h * 0.62, hw * (broken ? 0.16 : 0.1), h * 0.95);
  s.bezierCurveTo(hw * 0.06, h * 1.02, -hw * 0.06, h * 1.02, -hw * (broken ? 0.16 : 0.1), h * 0.95);
  s.bezierCurveTo(-hw * 0.55, h * 0.62, -hw * 0.78, h * 0.5, -hw, h * 0.18);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 1, curveSegments: 12 });
  g.translate(0, 0, -d / 2);
  B(batch, mat, g, [x, y, z]);
  for (const sx of [-1, 1]) {
    torus(batch, M.marble, 0.48, 0.14, [x + sx * hw * 0.72, y + h * 0.42, z + d / 2 + 0.06], Math.PI * 1.6, [0, 0, sx > 0 ? 0 : Math.PI]);
    B(batch, M.marble, leafGeo(1.15, 0.35, 0.06), [x + sx * hw * 0.42, y + h * 0.38, z + d / 2 + 0.08], [0, 0, sx * -0.7]);
  }
  rosette(batch, M, x, y + h * 0.52, z + d / 2 + 0.12, 0.42);
}

export function rosette(batch, M, x, y, z, r = 0.4, mat = M.marble) {
  sphere(batch, mat, r * 0.42, [x, y, z + r * 0.18], [1, 1, 0.55], 10, 7);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    B(batch, mat, leafGeo(r * 0.75, r * 0.24, 0.035),
      [x + Math.cos(a) * r * 0.36, y + Math.sin(a) * r * 0.36, z],
      [0, 0, a - Math.PI / 2]);
  }
}

/* 石雕屏风 / 浮雕板：卷草、花环、军阵纹样的几何化表达 */
export function reliefPanel(batch, M, o) {
  const { x, y, z, w = 2.4, h = 3.4, d = 0.42, ry = 0, mat = M.stone } = o;
  const co = Math.cos(ry), si = Math.sin(ry);
  const P = (dx, dy, dz = 0) => [x + dx * co + dz * si, y + dy, z - dx * si + dz * co];
  cbox(batch, mat, w, h, d, P(0, h / 2, 0), [0, ry, 0], 0.055);
  cbox(batch, M.marble, w - 0.34, h - 0.5, 0.1, P(0, h / 2, d / 2 + 0.04), [0, ry, 0], 0.03);
  const fz = d / 2 + 0.12;
  rosette(batch, M, ...P(0, h * 0.62, fz), w * 0.17);
  for (const s of [-1, 1]) {
    B(batch, M.marble, tube([
      [0, -h * 0.28, 0], [s * w * 0.16, -h * 0.05, 0.05], [s * w * 0.3, h * 0.16, 0.08],
      [s * w * 0.2, h * 0.36, 0.05], [s * w * 0.08, h * 0.3, 0.02],
    ], 0.075, 12, 5), P(0, h * 0.45, fz), [0, ry, 0]);
    for (let i = 0; i < 5; i++) {
      B(batch, M.marble, leafGeo(0.5, 0.16, 0.035),
        P(s * (w * 0.13 + i * w * 0.045), h * (0.22 + (i % 2) * 0.18), fz + 0.02),
        [0, ry, s * (0.5 + i * 0.22)]);
    }
  }
  for (let i = 0; i < 9; i++) {
    cbox(batch, M.marbleD, w / 11, 0.09, 0.09, P(-w * 0.4 + i * (w * 0.1), h * 0.1, fz), [0, ry, 0], 0.015);
  }
}

/* 台阶 */
export function stair(batch, M, o) {
  const { x, y, z, w, steps = 6, rise = 0.19, run = 0.42, mat = M.stone, ry = 0 } = o;
  const co = Math.cos(ry), si = Math.sin(ry);
  for (let i = 0; i < steps; i++) {
    const h = rise * (steps - i);
    cbox(batch, mat, w, h, run * 1.04,
      [x + si * ((i + 0.5) * run), y + h / 2, z + co * ((i + 0.5) * run)], [0, ry, 0], 0.02);
  }
}

/* 拱窗：券脸、窗棂、玻璃、三角巴洛克假门楣 */
export function archWindow(batch, M, o) {
  const { x, y, z, w = 1.5, h = 2.8, ry = 0, mat = M.marble, pediment = true } = o;
  const co = Math.cos(ry), si = Math.sin(ry);
  const P = (dx, dy, dz = 0) => [x + dx * co + dz * si, y + dy, z - dx * si + dz * co];
  const spring = h - w / 2;
  box(batch, M.dark, w * 0.92, h * 0.94, 0.1, P(0, h / 2, 0.06), [0, ry, 0]);
  box(batch, M.glass, w * 0.86, h * 0.9, 0.06, P(0, h / 2, 0.14), [0, ry, 0], { noShadow: true });
  for (const s of [-1, 1]) cbox(batch, mat, 0.16, spring, 0.24, P(s * w * 0.5, spring / 2, 0.18), [0, ry, 0], 0.025);
  torus(batch, mat, w * 0.5, 0.12, P(0, spring, 0.2), Math.PI, [0, ry, 0]);
  for (let i = 1; i < 3; i++) box(batch, mat, 0.055, spring, 0.08, P(-w / 2 + (i * w / 3), spring / 2, 0.21), [0, ry, 0]);
  box(batch, mat, w * 0.96, 0.07, 0.08, P(0, spring * 0.56, 0.21), [0, ry, 0]);
  cbox(batch, mat, w * 1.16, 0.22, 0.36, P(0, 0.11, 0.2), [0, ry, 0], 0.03);
  if (pediment) {
    const sh = new THREE.Shape();
    sh.moveTo(-w * 0.7, 0); sh.lineTo(w * 0.7, 0); sh.lineTo(0, h * 0.22); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.22, bevelEnabled: false });
    B(batch, mat, g, P(0, h + 0.16, 0.14), [0, ry, 0]);
    rosette(batch, M, ...P(0, h + 0.25, 0.36), 0.14);
  }
}

/* 椭圆/圆形喷池石沿与池壁 */
export function basinCurb(batch, M, o) {
  const { x, z, rx, rz, y = 0, h = 0.62, mat = M.stone, seg = 48, gap = 0 } = o;
  for (let i = 0; i < seg; i++) {
    if (gap && (i % seg < gap)) continue;
    const a = (i / seg) * Math.PI * 2;
    const a2 = ((i + 1) / seg) * Math.PI * 2;
    const len = Math.hypot((Math.cos(a2) - Math.cos(a)) * rx, (Math.sin(a2) - Math.sin(a)) * rz) * 1.06;
    const px = x + Math.cos((a + a2) / 2) * rx, pz = z + Math.sin((a + a2) / 2) * rz;
    cbox(batch, mat, len, h, 0.62, [px, y + h / 2, pz], [0, -((a + a2) / 2) + Math.PI / 2, 0], 0.035);
    cbox(batch, M.marbleD, len * 0.94, 0.1, 0.72, [px, y + h + 0.05, pz], [0, -((a + a2) / 2) + Math.PI / 2, 0], 0.02);
  }
  // 池底
  B(batch, M.stone2, new THREE.CircleGeometry(Math.min(rx, rz) * 0.98, seg),
    [x, y - 0.22, z], [-Math.PI / 2, 0, 0], [rx / Math.min(rx, rz), rz / Math.min(rx, rz), 1]);
}

/* 石狮吐水头 */
export function lionHead(batch, M, o) {
  const { x, y, z, ry = 0, s = 1, mat = M.stone } = o;
  sphere(batch, mat, 0.42 * s, [x, y, z], [1, 0.95, 0.72], 12, 9);
  sphere(batch, mat, 0.24 * s, [x, y - 0.12 * s, z + 0.32 * s], [1, 0.7, 1], 10, 7);
  sphere(batch, M.dark, 0.11 * s, [x, y - 0.14 * s, z + 0.5 * s], [1, 0.8, 0.5], 8, 6);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    sphere(batch, mat, 0.15 * s, [x + Math.cos(a) * 0.38 * s, y + Math.sin(a) * 0.38 * s, z - 0.1 * s], [1, 1, 0.65], 7, 5);
  }
  for (const sx of [-1, 1]) sphere(batch, mat, 0.11 * s, [x + sx * 0.24 * s, y + 0.24 * s, z + 0.08 * s], [1, 0.7, 1], 7, 5);
}

/* 十二生肖兽首（简化但可辨的铸铜头像） */
export function zodiacHead(batch, M, o) {
  const { x, y, z, kind = 0, ry = 0, s = 1 } = o;
  const mat = M.bronze;
  const co = Math.cos(ry), si = Math.sin(ry);
  const P = (dx, dy, dz) => [x + dx * co + dz * si, y + dy, z - dx * si + dz * co];
  sphere(batch, mat, 0.36 * s, P(0, 0, 0), [1, 1.1, 0.95], 12, 9);
  sphere(batch, M.bronzeD, 0.075 * s, P(-0.17, 0.1, 0.29), [1, 1, 1], 8, 6);
  sphere(batch, M.bronzeD, 0.075 * s, P(0.17, 0.1, 0.29), [1, 1, 1], 8, 6);
  const snout = (len, wide, drop = -0.1) => {
    sphere(batch, mat, wide * s, P(0, drop * s, (0.3 + len * 0.35) * s), [1.05, 0.72, 1 + len * 0.6], 10, 7);
  };
  switch (kind) {
    case 0: // 鼠
      snout(0.7, 0.16, -0.14); for (const sx of [-1, 1]) sphere(batch, mat, 0.16 * s, P(sx * 0.32, 0.3, -0.02), [1, 1, 0.5], 9, 6); break;
    case 1: // 牛
      snout(0.8, 0.24, -0.16);
      for (const sx of [-1, 1]) B(batch, mat, tube([[0, 0, 0], [sx * 0.4, 0.25, 0], [sx * 0.62, 0.5, 0.05]], 0.075 * s, 8, 5), P(sx * 0.26, 0.25, -0.02)); break;
    case 2: // 虎
      snout(0.6, 0.23, -0.15); for (const sx of [-1, 1]) sphere(batch, mat, 0.16 * s, P(sx * 0.28, 0.34, -0.02), [1, 1, 0.55], 8, 6);
      for (let i = 0; i < 5; i++) cbox(batch, M.bronzeD, 0.05 * s, 0.12 * s, 0.04 * s, P((i - 2) * 0.13, 0.42, 0.26), [0, ry, 0], 0.01); break;
    case 3: // 兔
      snout(0.4, 0.17, -0.12);
      for (const sx of [-1, 1]) sphere(batch, mat, 0.1 * s, P(sx * 0.19, 0.62, -0.05), [0.7, 2.6, 0.65], 8, 7); break;
    case 4: // 龙
      snout(0.85, 0.2, -0.13);
      for (const sx of [-1, 1]) B(batch, mat, tube([[0, 0, 0], [sx * 0.3, 0.42, -0.1], [sx * 0.5, 0.66, -0.22]], 0.06 * s, 8, 5), P(sx * 0.16, 0.3, -0.08));
      for (let i = 0; i < 4; i++) B(batch, M.bronzeD, leafGeo(0.28 * s, 0.09 * s, 0.03 * s), P((i - 1.5) * 0.16, 0.36, -0.22), [0.4, ry, 0]); break;
    case 5: // 蛇
      snout(0.6, 0.14, -0.16);
      B(batch, mat, tube([[0, 0, 0], [0, 0.5, -0.1], [0.16, 0.78, 0.02]], 0.1 * s, 10, 6), P(0, 0.18, -0.1)); break;
    case 6: // 马
      snout(1.0, 0.2, -0.22);
      for (let i = 0; i < 6; i++) B(batch, M.bronzeD, leafGeo(0.3 * s, 0.1 * s, 0.03 * s), P((i - 2.5) * 0.12, 0.4, -0.2 - i * 0.02), [0.8, ry, 0]);
      for (const sx of [-1, 1]) sphere(batch, mat, 0.09 * s, P(sx * 0.22, 0.48, -0.06), [0.6, 1.5, 0.6], 7, 6); break;
    case 7: // 羊
      snout(0.7, 0.19, -0.16);
      for (const sx of [-1, 1]) torus(batch, mat, 0.2 * s, 0.06 * s, P(sx * 0.32, 0.32, -0.04), Math.PI * 1.35, [0, ry, sx * 0.5]); break;
    case 8: // 猴
      snout(0.4, 0.2, -0.16); for (const sx of [-1, 1]) sphere(batch, mat, 0.17 * s, P(sx * 0.36, 0.08, 0), [1, 1, 0.55], 9, 6);
      sphere(batch, M.bronzeD, 0.25 * s, P(0, -0.05, 0.32), [1.1, 0.75, 0.6], 10, 7); break;
    case 9: // 鸡
      snout(0.35, 0.13, -0.06);
      for (let i = 0; i < 5; i++) B(batch, M.bronzeD, leafGeo(0.26 * s, 0.1 * s, 0.03 * s), P((i - 2) * 0.1, 0.4, -0.05), [0.3, ry, (i - 2) * 0.22]);
      sphere(batch, M.bronzeD, 0.1 * s, P(0, -0.28, 0.3), [1, 1.2, 0.7], 8, 6); break;
    case 10: // 狗
      snout(0.85, 0.18, -0.18); for (const sx of [-1, 1]) sphere(batch, mat, 0.13 * s, P(sx * 0.32, 0.14, -0.05), [0.7, 1.5, 0.7], 8, 6); break;
    default: // 猪
      snout(0.7, 0.26, -0.2); for (const sx of [-1, 1]) B(batch, mat, leafGeo(0.3 * s, 0.13 * s, 0.04 * s), P(sx * 0.3, 0.32, -0.04), [0, ry, sx * 0.6]);
      cyl(batch, M.bronzeD, 0.12 * s, 0.12 * s, 0.06 * s, P(0, -0.2, 0.52), 10); break;
  }
}
