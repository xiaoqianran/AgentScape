/* 西洋楼建筑群：大水法 / 远瀛观 / 观水法 / 海晏堂 / 谐奇趣 / 方外观 / 黄花阵 / 线法山 */
import * as THREE from 'three';
import {
  B, box, cbox, cyl, torus, sphere, R, rr, mulberry32, transform,
  boxGeo, chamferBoxGeo, brokenWallGeo, archWallGeo, shellGeo, tube, leafGeo, Batch,
} from './core.js';
import {
  column, cornice, balustrade, archedNiche, hipRoof, baroqueGable, rosette,
  reliefPanel, stair, archWindow, basinCurb, lionHead, zodiacHead,
} from './arch.js';

/* 石砌台基 + 周边栏板 */
function terrace(b, M, o) {
  const { x, z, w, d, h = 1.2, steps = true } = o;
  cbox(b, M.stone2, w, h, d, [x, h / 2 - 0.12, z], [0, 0, 0], 0.06);
  // 台面采用略深的暖色石材并刻出方砖缝，避免大面积「混凝土板」观感
  cbox(b, M.marbleD, w + 1.1, 0.28, d + 1.1, [x, h - 0.04, z], [0, 0, 0], 0.04);
  const jy = h + 0.104;
  const nx = Math.min(40, Math.max(4, Math.floor(w / 2.6)));
  const nz = Math.min(30, Math.max(3, Math.floor(d / 2.6)));
  for (let i = 0; i <= nx; i++)
    box(b, M.stone, 0.045, 0.012, d + 1.0, [x - w / 2 + i * w / nx, jy, z], [0, 0, 0], { noShadow: true });
  for (let j = 0; j <= nz; j++)
    box(b, M.stone, w + 1.0, 0.012, 0.045, [x, jy + 0.002, z - d / 2 + j * d / nz], [0, 0, 0], { noShadow: true });
  if (steps) stair(b, M, { x, y: 0, z: z + d / 2 + 0.6, w: w * 0.42, steps: Math.max(3, Math.round(h / 0.19)), rise: h / Math.max(3, Math.round(h / 0.19)), run: 0.44 });
}

/* ============ 大水法 + 石龛屏风 + 喷池 ============ */
function dashuifa(ctx) {
  const { ruin, rest, M, jets, waters, rubble } = ctx;
  const b = ruin, X = 40;
  terrace(b, M, { x: X, z: -2, w: 62, d: 46, h: 0.55, steps: false });

  // 石龛屏风下层：五开间壁龛
  cbox(b, M.stone, 34, 5.6, 2.3, [X, 3.35, -10], [0, 0, 0], 0.06);
  const niches = [-13.5, -7, 0, 7, 13.5];
  niches.forEach((dx, i) => {
    const w = i === 2 ? 4.6 : 3.0;
    archedNiche(b, M, { x: X + dx, y: 0.55, z: -8.78, w, h: i === 2 ? 4.6 : 3.9, d: 0.42, ry: 0 });
  });
  // 壁柱与线脚
  for (let i = 0; i < 6; i++) {
    const dx = -16.6 + i * 6.64;
    column(b, M, { x: X + dx, y: 0.55, z: -8.5, h: 5.0, r: 0.34, mat: M.marbleD, seed: i + 3 });
  }
  cornice(b, M, { x: X, y: 6.1, z: -10, w: 35, d: 2.8 });

  // 上层：中央大拱券 + 两侧残损塔楼
  B(b, M.stone, archWallGeo(13.4, 6.2, 2.0, [{ x: 0, w: 7.6, h: 5.6, arch: true }], 0.05),
    [X, 6.55, -10.3]);
  torus(b, M.marble, 3.8, 0.24, [X, 9.35, -9.2], Math.PI, [0, 0, 0]);
  cbox(b, M.marble, 0.6, 0.85, 0.5, [X, 12.85, -9.2], [0, 0, 0], 0.04);
  B(b, M.marbleD, shellGeo(3.5, 15, 40, 12), [X, 9.7, -11.1]);
  for (const sx of [-1, 1]) {
    cbox(b, M.stone, 8.6, 8.4, 2.6, [X + sx * 11.2, 10.75, -10.3], [0, 0, 0], 0.06);
    archedNiche(b, M, { x: X + sx * 11.2, y: 7.4, z: -8.95, w: 3.3, h: 4.3, d: 0.4, ry: 0 });
    rosette(b, M, X + sx * 11.2, 12.8, -8.92, 0.62);
    column(b, M, { x: X + sx * 15.6, y: 6.55, z: -8.8, h: 6.5, r: 0.42, mat: M.marble, ruin: sx > 0 ? 1 : 0, seed: 20 + sx });
    cornice(b, M, { x: X + sx * 11.2, y: 14.95, z: -10.3, w: 9.2, d: 2.9, dentils: false });
    // 外侧方塔（残）
    cbox(b, M.stone, 5.0, 9.6, 4.4, [X + sx * 20.5, 5.35, -10.5], [0, 0, 0], 0.06);
    archedNiche(b, M, { x: X + sx * 20.5, y: 2.0, z: -8.25, w: 2.6, h: 4.4, d: 0.4 });
    cbox(b, M.stone2, 5.3, 1.1 + (sx > 0 ? 0 : 1.8), 4.7, [X + sx * 20.5, 10.6, -10.5], [0, 0, 0], 0.05);
    for (let i = 0; i < 4; i++) rosette(b, M, X + sx * (18.8 + i * 1.1), 8.9, -8.2, 0.22);
  }
  // 破损山花
  baroqueGable(b, M, { x: X, y: 12.75, z: -10.4, w: 15.4, h: 3.3, d: 1.3, broken: true });
  B(b, M.stone, brokenWallGeo(8, 1.5, 1.9, 41, 0.9), [X - 10.7, 15.1, -10.4]);
  B(b, M.stone, brokenWallGeo(6, 1.1, 1.9, 43, 0.9), [X + 11.6, 15.1, -10.4]);

  // 石狮吐水（下层）
  for (let i = 0; i < 9; i++) {
    const lx = X - 14 + i * 3.5;
    lionHead(b, M, { x: lx, y: 1.5, z: -8.5, s: 0.82 });
    jets.push({ pos: [lx, 1.4, -8.0], vel: [0, 0.4, 5.6], n: 8, size: 0.11, seed: i });
  }
  // 三层跌水石阶（位于台基面之上，避免被台面覆盖）
  for (let l = 0; l < 3; l++) {
    const z = -5.4 + l * 2.4, y = 0.72 - l * 0.14, w = 26 - l * 1.2;
    cbox(b, M.marbleD, w, 0.34, 2.3, [X, y, z], [0, 0, 0], 0.03);
    for (let i = 0; i < 9; i++) {
      const lx = X - w / 2 + 1.2 + i * (w - 2.4) / 8;
      cbox(b, M.stone2, 0.55, 0.18, 0.4, [lx, y + 0.24, z + 1.0], [0, 0, 0], 0.02);
    }
  }

  // 主喷池（椭圆）
  basinCurb(b, M, { x: X, z: 12, rx: 15.2, rz: 9.4, y: 0.62, h: 0.72, seg: 64 });
  waters.push({ x: X, z: 12, rx: 14.7, rz: 8.9, y: 0.82, kind: 'ellipse' });
  // 中央铜鹿猎犬群像基座
  cyl(b, M.stone2, 2.1, 1.8, 1.0, [X, 0.65, 12], 20);
  cyl(b, M.marble, 1.5, 1.3, 0.6, [X, 1.45, 12], 18);
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    B(b, M.stone2, tube([[0, 0, 0], [Math.cos(a) * 0.9, 0.5, Math.sin(a) * 0.9], [Math.cos(a) * 1.5, 0.2, Math.sin(a) * 1.5]], 0.2, 8, 5), [X, 1.7, 12]);
  }
  // 铜鹿
  const deer = (dx, dz, s, ry) => {
    sphere(b, M.bronze, 0.66 * s, [X + dx, 2.5 * s + 0.6, 12 + dz], [1.5, 0.8, 0.75], 12, 9);
    sphere(b, M.bronze, 0.3 * s, [X + dx, 3.0 * s + 0.6, 12 + dz + 0.75 * s], [0.8, 1, 1.2], 10, 8);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      cyl(b, M.bronze, 0.08 * s, 0.045 * s, 1.6 * s, [X + dx + sx * 0.45 * s, 1.6 * s + 0.6, 12 + dz + sz * 0.48 * s], 7);
    }
    for (let i = 0; i < 5; i++) {
      B(b, M.bronzeD, tube([
        [0, 0, 0], [Math.sin(i) * 0.3, 0.4, 0], [Math.sin(i) * 0.62, 0.82, 0.1],
      ], 0.05 * s, 7, 4), [X + dx + (i - 2) * 0.13 * s, 3.25 * s + 0.6, 12 + dz + 0.7 * s]);
    }
  };
  deer(-0.3, 0, 1, 0);
  for (const sx of [-1, 1]) {
    sphere(b, M.bronzeD, 0.34, [X + sx * 2.6, 2.15, 12 + 1.1], [1.3, 0.7, 0.7], 10, 8);
    sphere(b, M.bronzeD, 0.2, [X + sx * 2.6, 2.4, 12 + 1.7], [0.8, 0.8, 1.2], 8, 6);
    for (const s2 of [-1, 1]) for (const s3 of [-1, 1]) cyl(b, M.bronzeD, 0.055, 0.04, 0.9, [X + sx * 2.6 + s2 * 0.22, 1.65, 12 + 1.1 + s3 * 0.35], 6);
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    jets.push({ pos: [X + Math.cos(a) * 1.4, 2.4, 12 + Math.sin(a) * 1.4], vel: [Math.cos(a) * 3.2, 5.2, Math.sin(a) * 3.2], n: 10, size: 0.1, seed: 40 + i });
  }
  // 两侧圆形副池
  for (const sx of [-1, 1]) {
    const bx = X + sx * 23.5;
    basinCurb(b, M, { x: bx, z: 12, rx: 5.4, rz: 5.4, y: 0.62, h: 0.58, seg: 32 });
    waters.push({ x: bx, z: 12, rx: 5.1, rz: 5.1, y: 0.78, kind: 'ellipse' });
    cyl(b, M.marble, 0.75, 0.55, 1.5, [bx, 0.9, 12], 14);
    B(b, M.marbleD, shellGeo(1.4, 13, 28, 8), [bx, 2.0, 12], [0, Math.PI, 0]);
    jets.push({ pos: [bx, 2.1, 12], vel: [0, 6.0, 0], n: 14, size: 0.1, seed: 60 + sx });
  }
  // 复原态：增设完整栏板与顶部雕饰
  balustrade(rest, M, { x1: X - 30, z1: 20, x2: X + 30, z2: 20, y: 0.55, h: 1.0 });
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 5; i++) column(rest, M, { x: X + sx * (17 + i * 2.2), y: 0.55, z: 20, h: 3.4, r: 0.25, mat: M.marble, seed: 80 + i });
  }
  // 残垣断壁与散落构件
  for (let i = 0; i < 46; i++) {
    const a = R() * Math.PI * 2, rad = 16 + R() * 22;
    rubble.push({ pos: [X + Math.cos(a) * rad, 0.3, -2 + Math.sin(a) * rad * 0.75], s: 0.5 + R() * 1.5, rot: R() * 6.28 });
  }
}

/* ============ 远瀛观：汉白玉三拱门 ============ */
function yuanyingguan(ctx) {
  const { ruin, rest, ruinOnly, M, rubble } = ctx;
  const b = ruin, X = 40, Z = -34;
  terrace(b, M, { x: X, z: Z, w: 40, d: 20, h: 2.1, steps: true });
  balustrade(b, M, { x1: X - 19, z1: Z + 9.6, x2: X - 8, z2: Z + 9.6, y: 2.1, h: 0.95 });
  balustrade(b, M, { x1: X + 8, z1: Z + 9.6, x2: X + 19, z2: Z + 9.6, y: 2.1, h: 0.95 });
  B(b, M.marble, archWallGeo(27, 8.4, 2.4, [
    { x: -8.7, w: 5.6, h: 6.6, arch: true },
    { x: 0, w: 6.6, h: 7.6, arch: true },
    { x: 8.7, w: 5.6, h: 6.6, arch: true },
  ], 0.06), [X, 2.1, Z]);
  for (const dx of [-8.7, 0, 8.7]) {
    torus(b, M.stone2, Math.abs(dx) < 1 ? 3.3 : 2.8, 0.28, [X + dx, 2.1 + (Math.abs(dx) < 1 ? 4.3 : 3.8), Z + 1.3], Math.PI, [0, 0, 0]);
    cbox(b, M.marble, 0.62, 0.9, 0.5, [X + dx, 2.1 + (Math.abs(dx) < 1 ? 7.9 : 6.9), Z + 1.35], [0, 0, 0], 0.04);
    for (const s of [-1, 1]) {
      const off = Math.abs(dx) < 1 ? 3.3 : 2.8;
      column(b, M, { x: X + dx + s * off, y: 2.1, z: Z + 1.55, h: 6.5, r: 0.48, mat: M.marble, seed: 120 + dx + s });
    }
    // 拱间浮雕
    reliefPanel(b, M, { x: X + dx, y: 2.4, z: Z + 1.28, w: 2.0, h: 2.5, d: 0.28 });
  }
  cornice(b, M, { x: X, y: 10.5, z: Z, w: 29, d: 3.2 });
  B(ruinOnly, M.marbleD, brokenWallGeo(27, 2.4, 2.0, 71, 0.7), [X, 11.2, Z]);
  // 左右断壁
  for (const sx of [-1, 1]) {
    B(b, M.stone, brokenWallGeo(9, 6.4, 1.8, 73 + sx, 0.75), [X + sx * 18, 2.1, Z - 3]);
    for (let i = 0; i < 7; i++) rosette(b, M, X + sx * (14.5 + i * 1.15), 4.0 + (i % 3) * 0.6, Z - 2.05, 0.24);
  }
  // 复原态：蓝琉璃重檐顶 + 完整墙体
  cbox(rest, M.plaster, 29.5, 8.6, 3.0, [X, 6.4, Z - 1.1], [0, 0, 0], 0.05);
  for (let i = 0; i < 7; i++) archWindow(rest, M, { x: X - 12 + i * 4, y: 3.0, z: Z + 0.55, w: 1.9, h: 3.6, mat: M.marble });
  for (let i = 0; i < 5; i++) archWindow(rest, M, { x: X - 10 + i * 5, y: 3.0, z: Z - 2.72, w: 1.9, h: 3.4, mat: M.marbleD, ry: Math.PI, pediment: false });
  cbox(rest, M.marbleD, 30.4, 0.42, 3.6, [X, 10.85, Z - 1.1], [0, 0, 0], 0.04);
  hipRoof(rest, M, { x: X, y: 11.3, z: Z - 1, w: 34, d: 14, h: 4.4, mat: M.roof });
  balustrade(rest, M, { x1: X - 15, z1: Z + 5, x2: X + 15, z2: Z + 5, y: 11.3, h: 0.9 });
  for (let i = 0; i < 30; i++) {
    const a = R() * Math.PI * 2, rad = 12 + R() * 16;
    rubble.push({ pos: [X + Math.cos(a) * rad, 0.3, Z + 4 + Math.sin(a) * rad * 0.6], s: 0.4 + R() * 1.2, rot: R() * 6.28 });
  }
}

/* ============ 观水法：宝座与五扇石屏风 ============ */
function guanshuifa(ctx) {
  const { ruin, rest, M } = ctx;
  const b = ruin, X = 40;
  terrace(b, M, { x: X, z: 36, w: 26, d: 13, h: 0.7, steps: true });
  // 五扇屏风呈弧形展开（朝北）
  for (let i = 0; i < 5; i++) {
    const a = (i - 2) * 0.34;
    const px = X + Math.sin(a) * 12.2, pz = 39.5 + Math.cos(a) * 3.4 - 3.4;
    reliefPanel(b, M, { x: px, y: 0.7, z: pz, w: 3.3, h: 4.4, d: 0.48, ry: -a });
    cbox(b, M.stone2, 3.9, 0.5, 0.85, [px, 0.9, pz + 0.15], [0, -a, 0], 0.05);
    cbox(b, M.marbleD, 3.9, 0.35, 0.9, [px, 5.35, pz + 0.15], [0, -a, 0], 0.04);
    rosette(b, M, px, 5.65, pz + 0.62, 0.3);
    if (i === 2) B(b, M.marbleD, brokenWallGeo(3.3, 1.2, 0.5, 91, 0.8), [px, 5.6, pz + 0.15], [0, -a, 0]);
  }
  // 宝座台
  cbox(b, M.marble, 4.4, 0.5, 3.2, [X, 0.95, 32.5], [0, 0, 0], 0.05);
  cbox(b, M.marble, 2.2, 0.55, 1.2, [X, 1.45, 32.4], [0, 0, 0], 0.05);
  cbox(b, M.marble, 2.2, 1.25, 0.35, [X, 2.1, 31.9], [0, 0, 0], 0.05);
  for (const s of [-1, 1]) {
    cbox(b, M.marble, 0.45, 1.0, 1.4, [X + s * 1.2, 1.6, 32.4], [0, 0, 0], 0.04);
    cyl(b, M.bronze, 0.35, 0.28, 1.2, [X + s * 3.2, 1.3, 32.2], 12);
    sphere(b, M.bronze, 0.28, [X + s * 3.2, 2.05, 32.2], [1, 1.2, 1], 10, 8);
    B(b, M.bronze, tube([[0, 0, 0], [0, 0.6, 0.2], [0.25, 0.95, 0.45]], 0.06, 8, 5), [X + s * 3.2, 2.1, 32.2]);
  }
  balustrade(b, M, { x1: X - 11, z1: 30.5, x2: X - 3, z2: 30.5, y: 0.7, h: 0.85 });
  balustrade(b, M, { x1: X + 3, z1: 30.5, x2: X + 11, z2: 30.5, y: 0.7, h: 0.85 });
  rest && balustrade(rest, M, { x1: X - 13, z1: 42, x2: X + 13, z2: 42, y: 0.7, h: 1.0 });
}

/* ============ 海晏堂 + 十二生肖喷水钟 + 蓄水楼 ============ */
function haiyantang(ctx) {
  const { ruin, rest, M, jets, waters, rubble } = ctx;
  const b = ruin, X = -72, Z = 0;
  terrace(b, M, { x: X, z: Z, w: 66, d: 22, h: 1.5, steps: false });
  // 主体：十一开间粉红灰墙
  cbox(b, M.plaster, 60, 9.4, 14, [X, 6.2, Z - 2], [0, 0, 0], 0.07);
  cbox(b, M.stone2, 61.4, 0.65, 15.4, [X, 1.8, Z - 2], [0, 0, 0], 0.05);
  cbox(b, M.marbleD, 61.6, 0.55, 15.6, [X, 10.85, Z - 2], [0, 0, 0], 0.05);
  cornice(b, M, { x: X, y: 11.2, z: Z - 2, w: 62, d: 15.6, mat: M.marbleD });
  for (let i = 0; i < 12; i++) {
    const dx = -27.5 + i * 5;
    column(b, M, { x: X + dx, y: 2.2, z: Z + 5.2, h: 8.2, r: 0.42, mat: M.marble, ruin: (i === 9 || i === 10) ? 1 : 0, seed: 200 + i });
  }
  for (let i = 0; i < 11; i++) {
    const dx = -25 + i * 5;
    if (i === 9 || i === 10) {
      B(b, M.stone, brokenWallGeo(4.2, 5.6, 0.8, 210 + i, 0.65), [X + dx, 2.2, Z + 5.1]);
      continue;
    }
    archWindow(b, M, { x: X + dx, y: 3.5, z: Z + 5.12, w: 2.3, h: 4.6, mat: M.marble });
    cbox(b, M.marbleD, 2.9, 0.35, 0.4, [X + dx, 2.9, Z + 5.3], [0, 0, 0], 0.03);
    rosette(b, M, X + dx, 9.4, Z + 5.35, 0.26);
  }
  // 中央门厅与山花
  cbox(b, M.marbleD, 10.5, 9.6, 2.2, [X, 6.2, Z + 5.8], [0, 0, 0], 0.06);
  for (const s of [-1, 1]) for (const t of [-1, 1])
    column(b, M, { x: X + s * (2.1 + t * 1.5), y: 2.2, z: Z + 7.1, h: 8.6, r: 0.5, mat: M.marble, seed: 230 + s + t });
  baroqueGable(b, M, { x: X, y: 11.7, z: Z + 6.1, w: 12.5, h: 2.6, d: 1.2, broken: false });
  cbox(b, M.wood, 3.2, 5.2, 0.25, [X, 4.8, Z + 7.0], [0, 0, 0], 0.04);
  for (let i = 0; i < 6; i++) cbox(b, M.gold, 0.12, 0.35, 0.06, [X - 1.1 + i * 0.44, 5.6, Z + 7.16], [0, 0, 0], 0.01);
  // 叠落石跑梯与中央喷池
  for (const s of [-1, 1]) {
    for (let l = 0; l < 8; l++) {
      cbox(b, M.marble, 5.4, 0.19, 0.62, [X + s * 8.2, 0.19 * (8 - l) + 0.1, Z + 11.6 + l * 0.62], [0, 0, 0], 0.02);
    }
    balustrade(b, M, { x1: X + s * 5.6, z1: Z + 11.2, x2: X + s * 5.6, z2: Z + 16.6, y: 1.5, h: 0.8, spacing: 0.9 });
  }
  basinCurb(b, M, { x: X, z: Z + 14.2, rx: 5.2, rz: 3.4, y: 0.1, h: 0.55, seg: 32 });
  waters.push({ x: X, z: Z + 14.2, rx: 4.9, rz: 3.1, y: 0.26, kind: 'ellipse' });
  B(b, M.marbleD, shellGeo(1.9, 13, 26, 8), [X, 1.0, Z + 14.2], [0, Math.PI, 0]);
  jets.push({ pos: [X, 1.5, Z + 14.2], vel: [0, 5.6, 0], n: 14, size: 0.09, seed: 250 });
  // 复原态：孔雀绿琉璃庑殿顶 + 屋顶露台栏杆
  hipRoof(rest, M, { x: X, y: 11.9, z: Z - 2, w: 64, d: 17, h: 4.6, mat: M.roof });
  cbox(rest, M.marbleD, 61, 0.5, 15.2, [X, 11.65, Z - 2], [0, 0, 0], 0.04);
  for (const s of [-1, 1]) balustrade(rest, M, { x1: X + s * 29, z1: Z + 5.4, x2: X + s * 29, z2: Z - 9.4, y: 11.9, h: 0.8 });
  for (let i = 0; i < 11; i++) cbox(rest, M.marble, 4.3, 0.12, 0.12, [X - 25 + i * 5, 12.1, Z + 5.5], [0, 0, 0], 0.01);

  // 蓄水楼（锡海）
  const BX = X + 4, BZ = -26;
  cbox(b, M.graybrick, 30, 7.6, 12, [BX, 4.0, BZ], [0, 0, 0], 0.06);
  for (let i = 0; i < 7; i++) {
    B(b, M.graybrick, archWallGeo(3.2, 3.2, 0.6, [{ x: 0, w: 2.0, h: 2.6, arch: true }], 0.03),
      [BX - 12 + i * 4, 0.4, BZ + 6.2], [0, Math.PI, 0]);
  }
  cbox(b, M.stone2, 31, 0.5, 13, [BX, 8.0, BZ], [0, 0, 0], 0.05);
  cbox(b, M.bronzeD, 26, 1.2, 9, [BX, 8.8, BZ], [0, 0, 0], 0.05); // 锡海蓄水槽
  for (let i = 0; i < 6; i++) archWindow(b, M, { x: BX - 11 + i * 4.4, y: 4.6, z: BZ + 6.15, w: 1.6, h: 2.6, mat: M.marbleD, pediment: false });
  // 山墙：券窗、壁柱与腰线，避免大面积无细节的暗墙面
  for (const s of [-1, 1]) {
    const ex = BX + s * 15.05;
    for (let i = 0; i < 2; i++)
      archWindow(b, M, { x: ex, y: 4.4, z: BZ - 2.7 + i * 5.4, w: 1.9, h: 2.9, ry: s * Math.PI / 2, mat: M.marbleD, pediment: false });
    for (const zz of [-5.4, 0, 5.4]) cbox(b, M.stone2, 0.34, 6.8, 0.45, [ex + s * 0.02, 3.6, BZ + zz], [0, 0, 0], 0.03);
    cbox(b, M.marbleD, 0.42, 0.34, 12.2, [ex, 7.2, BZ], [0, 0, 0], 0.03);
    sphere(b, M.marble, 0.34, [ex + s * 0.22, 5.9, BZ], [1, 1, 0.45], 10, 7);
  }

  // 十二生肖喷水钟：扇形石阶 + 兽首人身铜像
  const FZ = 34;
  for (let l = 0; l < 4; l++) {
    const r0 = 8.5 + l * 2.7;
    const seg = 40;
    for (let i = -seg / 2; i < seg / 2; i++) {
      const a = (i / seg) * Math.PI * 1.1;
      const px = X + Math.sin(a) * r0, pz = FZ - Math.cos(a) * r0 * 0.66 + 5;
      cbox(b, M.marbleD, 1.9, 0.3 + l * 0.18, 1.5, [px, 0.2 + l * 0.32, pz], [0, -a, 0], 0.025);
    }
  }
  const names = ['子鼠', '丑牛', '寅虎', '卯兔', '辰龙', '巳蛇', '午马', '未羊', '申猴', '酉鸡', '戌狗', '亥猪'];
  for (let i = 0; i < 12; i++) {
    const a = -0.98 + i * (1.96 / 11);
    const rad = 15.4;
    const px = X + Math.sin(a) * rad, pz = FZ + 5 - Math.cos(a) * rad * 0.66 + 3.2;
    const ry = -a;
    cbox(b, M.marble, 1.5, 0.45, 1.5, [px, 0.32, pz], [0, ry, 0], 0.04);
    cyl(b, M.bronzeD, 0.55, 0.42, 1.35, [px, 1.2, pz], 12);
    cbox(b, M.bronze, 1.15, 0.28, 0.9, [px, 1.9, pz], [0, ry, 0], 0.05);
    zodiacHead(b, M, { x: px, y: 2.45, z: pz + 0.18, kind: i, ry, s: 1.0 });
    cbox(b, M.marbleD, 1.7, 0.22, 1.7, [px, 0.1, pz], [0, ry, 0], 0.02);
    jets.push({ pos: [px, 2.35, pz + 0.62], vel: [Math.sin(ry) * 1.2, 1.4, 3.4], n: 7, size: 0.085, seed: 300 + i });
    (ctx.labels || []).push({ name: names[i], pos: [px, 3.2, pz] });
  }
  // 中央水力钟塔
  cyl(b, M.marble, 3.4, 2.9, 0.7, [X, 0.45, FZ + 5], 24);
  for (let l = 0; l < 4; l++) {
    const r = 2.9 - l * 0.55;
    cyl(b, l % 2 ? M.marbleD : M.stone2, r, r - 0.15, 1.1, [X, 0.8 + l * 1.1, FZ + 5], 20);
    basinCurb(b, M, { x: X, z: FZ + 5, rx: r + 0.25, rz: r + 0.25, y: 1.2 + l * 1.1, h: 0.2, seg: 24 });
    waters.push({ x: X, z: FZ + 5, rx: r + 0.1, rz: r + 0.1, y: 1.42 + l * 1.1, kind: 'ellipse', tiny: true });
  }
  B(b, M.marbleD, shellGeo(1.55, 13, 30, 9), [X, 5.3, FZ + 5], [0, Math.PI, 0]);
  sphere(b, M.gold, 0.42, [X, 5.9, FZ + 5], [1, 1.2, 1], 12, 9);
  jets.push({ pos: [X, 5.9, FZ + 5], vel: [0, 6.2, 0], n: 16, size: 0.1, seed: 320 });
  for (let i = 0; i < 28; i++) {
    const a = R() * Math.PI * 2, rad = 12 + R() * 18;
    rubble.push({ pos: [X + Math.cos(a) * rad, 0.3, 8 + Math.sin(a) * rad * 0.55], s: 0.4 + R() * 1.4, rot: R() * 6.28 });
  }
}

/* ============ 谐奇趣：三层楼 + 曲廊 + 八角亭 + 海棠式喷池 ============ */
function xieqiqu(ctx) {
  const { ruin, rest, M, jets, waters } = ctx;
  const b = ruin, X = -138, Z = 4;
  terrace(b, M, { x: X, z: Z, w: 44, d: 20, h: 0.9, steps: true });
  cbox(b, M.plaster, 20, 12.4, 12, [X, 7.1, Z - 2], [0, 0, 0], 0.06);
  for (let l = 0; l < 3; l++) {
    const y = 1.2 + l * 4.0;
    cbox(b, M.marbleD, 22, 0.4, 13.4, [X, y + 3.75, Z - 2], [0, 0, 0], 0.04);
    for (let i = 0; i < 7; i++) {
      const dx = -9 + i * 3;
      column(b, M, { x: X + dx, y, z: Z + 4.2, h: 3.6, r: 0.3, mat: M.marble, seed: 400 + l * 10 + i });
      if (l === 2) archWindow(b, M, { x: X + dx + 1.5, y: y + 0.5, z: Z + 4.05, w: 1.7, h: 2.6, mat: M.marbleD, pediment: false });
    }
  }
  balustrade(b, M, { x1: X - 10, z1: Z + 4.4, x2: X + 10, z2: Z + 4.4, y: 5.1, h: 0.72, spacing: 0.85 });
  // 两翼曲廊与八角亭
  for (const s of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const a = i / 5 * Math.PI * 0.42;
      const px = X + s * (10 + Math.sin(a) * 8.5), pz = Z + 4 - Math.cos(a) * 2 + 2;
      column(b, M, { x: px, y: 0.9, z: pz, h: 3.3, r: 0.24, mat: M.marbleD, seed: 440 + i + s });
      cbox(b, M.marbleD, 3.0, 0.28, 1.5, [px, 4.3, pz], [0, s * a, 0], 0.02);
    }
    const kx = X + s * 20, kz = Z + 8;
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      column(b, M, { x: kx + Math.cos(a) * 3.0, y: 0.9, z: kz + Math.sin(a) * 3.0, h: 3.6, r: 0.22, mat: M.marble, seed: 460 + i });
    }
    cbox(b, M.stone2, 7.2, 0.4, 7.2, [kx, 0.9, kz], [0, Math.PI / 8, 0], 0.04);
    hipRoof(rest, M, { x: kx, y: 4.6, z: kz, w: 8, d: 8, h: 2.4, mat: M.roof });
    rosette(b, M, kx, 4.7, kz + 3.0, 0.3);
  }
  hipRoof(rest, M, { x: X, y: 13.4, z: Z - 2, w: 23, d: 14, h: 3.2, mat: M.roof });
  // 海棠形喷池
  basinCurb(b, M, { x: X, z: Z + 18, rx: 9.5, rz: 7.0, y: 0.05, h: 0.55, seg: 48 });
  waters.push({ x: X, z: Z + 18, rx: 9.1, rz: 6.6, y: 0.24, kind: 'ellipse' });
  cyl(b, M.marble, 1.1, 0.8, 1.8, [X, 0.95, Z + 18], 16);
  B(b, M.marbleD, shellGeo(1.8, 13, 28, 8), [X, 2.0, Z + 18], [0, Math.PI, 0]);
  jets.push({ pos: [X, 2.2, Z + 18], vel: [0, 5.8, 0], n: 12, size: 0.09, seed: 480 });
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    lionHead(b, M, { x: X + Math.cos(a) * 8.6, y: 0.75, z: Z + 18 + Math.sin(a) * 6.3, ry: -a + Math.PI / 2, s: 0.6 });
  }
}

/* ============ 方外观 + 五竹亭 ============ */
function fangwaiguan(ctx) {
  const { ruin, rest, M } = ctx;
  const b = ruin, X = -118, Z = -40;
  terrace(b, M, { x: X, z: Z, w: 22, d: 16, h: 0.9, steps: true });
  cbox(b, M.marbleD, 15, 8.6, 10, [X, 5.2, Z], [0, 0, 0], 0.06);
  for (let l = 0; l < 2; l++) for (let i = 0; i < 5; i++)
    archWindow(b, M, { x: X - 6 + i * 3, y: 1.4 + l * 4.1, z: Z + 5.1, w: 1.7, h: 2.9, mat: M.marble, pediment: false });
  for (let i = 0; i < 6; i++) {
    column(b, M, { x: X - 7.5 + i * 3, y: 0.9, z: Z + 5.3, h: 4.0, r: 0.28, mat: M.marble, seed: 500 + i });
    rosette(b, M, X - 7.5 + i * 3, 9.3, Z + 5.2, 0.28);
  }
  cbox(b, M.stone2, 16.5, 0.5, 11.5, [X, 9.7, Z], [0, 0, 0], 0.04);
  hipRoof(rest, M, { x: X, y: 10.0, z: Z, w: 18, d: 13, h: 3.4, mat: M.roof });
  // 八角亭
  const kx = X - 14, kz = Z + 4;
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    column(b, M, { x: kx + Math.cos(a) * 2.7, y: 0.9, z: kz + Math.sin(a) * 2.7, h: 3.3, r: 0.2, mat: M.marbleD, seed: 520 + i });
  }
  hipRoof(rest, M, { x: kx, y: 4.3, z: kz, w: 7, d: 7, h: 2.0, mat: M.roof });
  // 五竹亭
  for (let i = 0; i < 5; i++) {
    const px = X + 12 + (i % 3) * 6, pz = Z + 20 + Math.floor(i / 3) * 6;
    for (let k = 0; k < 4; k++) cyl(b, M.wood, 0.13, 0.11, 3.0, [px + (k % 2 ? 1.7 : -1.7), 1.6, pz + (k < 2 ? -1.7 : 1.7)], 7);
    hipRoof(rest, M, { x: px, y: 3.2, z: pz, w: 5, d: 5, h: 1.6, mat: M.roof });
    cbox(b, M.wood, 4.2, 0.2, 4.2, [px, 0.35, pz], [0, 0, 0], 0.02);
  }
}

/* ============ 黄花阵（万花阵）迷宫 ============ */
function maze(ctx) {
  const { ruin, rest, M } = ctx;
  const b = ruin, X = -152, Z = 0, half = 22, wallH = 1.35;
  cbox(b, M.ground, 48, 0.15, 48, [X, 0.02, Z], [0, 0, 0], 0.02);
  const rnd = mulberry32(7777);
  for (let ring = 0; ring < 6; ring++) {
    const s = half - ring * 3.4;
    if (s < 4) break;
    const gapSide = Math.floor(rnd() * 4);
    const gapOff = (rnd() - 0.5) * s * 0.9;
    const sides = [
      (t) => [X - s + t * 2 * s, Z - s, 0],
      (t) => [X + s, Z - s + t * 2 * s, Math.PI / 2],
      (t) => [X + s - t * 2 * s, Z + s, 0],
      (t) => [X - s, Z + s - t * 2 * s, Math.PI / 2],
    ];
    sides.forEach((fn, si) => {
      const n = Math.max(4, Math.round(s / 1.15));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        if (si === gapSide && Math.abs(t - 0.5 - gapOff / (2 * s)) < 0.075) continue;
        const [px, pz, ry] = fn(t);
        cbox(b, M.graybrick, 2 * s / n * 1.02, wallH, 0.62, [px, wallH / 2, pz], [0, ry, 0], 0.025);
        cbox(b, M.stone2, 2 * s / n * 1.06, 0.12, 0.78, [px, wallH + 0.06, pz], [0, ry, 0], 0.02);
        // 顶部绿篱
        cbox(rest, M.hedge, 2 * s / n * 0.96, 0.32, 0.5, [px, wallH + 0.28, pz], [0, ry, 0], 0.06);
      }
    });
  }
  // 中央八角亭
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    column(b, M, { x: X + Math.cos(a) * 3.1, y: 0.15, z: Z + Math.sin(a) * 3.1, h: 3.6, r: 0.22, mat: M.marble, seed: 600 + i });
  }
  cbox(b, M.marbleD, 8, 0.4, 8, [X, 0.2, Z], [0, Math.PI / 8, 0], 0.04);
  hipRoof(rest, M, { x: X, y: 3.9, z: Z, w: 8.4, d: 8.4, h: 2.6, mat: M.roof });
  sphere(rest, M.gold, 0.45, [X, 6.7, Z], [1, 1.3, 1], 10, 8);
}

/* ============ 线法山 / 线法画 / 园墙 / 门 ============ */
function peripheral(ctx) {
  const { ruin, rest, M, waters } = ctx;
  const b = ruin;
  // 线法山透视布景墙
  const X = 140, Z = -12;
  cbox(b, M.stone2, 34, 0.7, 3, [X, 0.35, Z], [0, 0, 0], 0.04);
  for (let i = 0; i < 7; i++) {
    const px = X - 15 + i * 5;
    cbox(b, M.plaster, 4.4, 6.2, 0.5, [px, 3.6, Z], [0, 0, 0], 0.04);
    reliefPanel(b, M, { x: px, y: 1.1, z: Z + 0.32, w: 3.4, h: 3.2, d: 0.25 });
    rosette(b, M, px, 6.2, Z + 0.3, 0.3);
  }
  B(b, M.stone, brokenWallGeo(34, 1.4, 0.7, 701, 0.55), [X, 6.8, Z]);
  for (const s of [-1, 1]) column(b, M, { x: X + s * 17.5, y: 0, z: Z, h: 7.6, r: 0.42, mat: M.marble, ruin: s > 0 ? 1 : 0, seed: 710 + s });
  // 北侧园墙
  for (let i = 0; i < 46; i++) {
    const px = -168 + i * 7.4;
    cbox(b, M.graybrick, 7.5, 2.7, 0.9, [px, 1.35, -92], [0, 0, 0], 0.03);
    cbox(b, M.roof, 7.8, 0.24, 1.3, [px, 2.82, -92], [0, 0, 0], 0.03);
    cbox(b, M.stone2, 0.55, 3.05, 1.1, [px - 3.7, 1.52, -92], [0, 0, 0], 0.03);
  }
  // 东西界墙
  for (const sx of [-1, 1]) for (let i = 0; i < 22; i++) {
    const pz = -92 + i * 9.2;
    cbox(b, M.graybrick, 0.9, 2.2, 9.3, [sx * 170, 1.1, pz], [0, 0, 0], 0.03);
    cbox(b, M.roof, 1.3, 0.2, 9.5, [sx * 170, 2.3, pz], [0, 0, 0], 0.03);
  }
  // 养雀笼门
  const GX = -106, GZ = 14;
  B(b, M.marbleD, archWallGeo(9, 6.2, 1.6, [{ x: 0, w: 4.4, h: 5.2, arch: true }], 0.05), [GX, 0, GZ]);
  for (const s of [-1, 1]) column(b, M, { x: GX + s * 2.6, y: 0, z: GZ + 0.9, h: 5.6, r: 0.36, mat: M.marble, seed: 730 + s });
  cornice(b, M, { x: GX, y: 6.2, z: GZ, w: 10.4, d: 1.9 });
  rosette(b, M, GX, 7.0, GZ + 0.9, 0.45);
}

export function buildBuildings(ctx) {
  const steps = [
    ['大水法石龛与喷池', dashuifa],
    ['远瀛观三拱门', yuanyingguan],
    ['观水法石屏风', guanshuifa],
    ['海晏堂与生肖钟', haiyantang],
    ['谐奇趣与曲廊', xieqiqu],
    ['方外观与五竹亭', fangwaiguan],
    ['黄花阵迷宫', maze],
    ['线法山与园墙', peripheral],
  ];
  steps.forEach(([name, fn], i) => {
    fn(ctx);
    if (ctx.onProgress) ctx.onProgress((i + 1) / steps.length, name);
  });
}
