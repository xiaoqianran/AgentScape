/* 良渚 · 水城 —— 城址本体
 * 莫角山宫殿台基（670×450 m 覆斗土台 + 大/小莫角山、乌龟山三台基 + 7 万 m² 沙土广场 +
 * 35 座房址）、皇坟山、池中寺粮仓、夯土城墙（底宽 48 m / 顶高 9 m / 坡度 30°、
 * 块石基础 + 水平夯层 + 卵石护坡）、8 水门与「品」字形陆城门、
 * 反山王陵与南北向王陵长垄、瑶山 / 汇观山三重土色祭坛与石坎护坡、外郭条状台地。
 */
import * as THREE from 'three';
import {
  SURVEY, WORLD, boxGeo, frustumGeo, put, sweepProfile, roundedRectPath,
  transform, mulberry32, clamp, lerp,
} from './core.js';
import { GATES, LAND_GATE, TANGSHAN } from './hydro.js';
import { terrainHeight } from './terrain.js';
import {
  frameGeo, makeHouse, makePileQuay, makeElevationRuler, makePostHoles, makeCanoe,
} from './detail.js';

const rnd = mulberry32(53001007);
const rr = (a, b) => a + (b - a) * rnd();

/* 覆斗状夯土台基统一定位 */
function platform(B, M, cx, cz, bx, bz, tx, tz, y0, y1, mat, opts = {}) {
  const g = frustumGeo(bx, bz, tx, tz, y0, y1, opts);
  put(B, g, mat || M.rammed, [cx, 0, cz]);
  return g;
}
/* 台基坡脚卵石护坡布点 */
function slopeCobbles(out, cx, cz, bx, bz, y0, y1, count, band = 0.42) {
  for (let i = 0; i < count; i++) {
    const side = i % 4, t = rnd();
    const q = y0 + (y1 - y0) * band * rnd();
    const k = (q - y0) / Math.max(0.001, y1 - y0);
    const hx = lerp(bx, bx * 0.92, k) / 2 + rr(0.2, 2.2);
    const hz = lerp(bz, bz * 0.92, k) / 2 + rr(0.2, 2.2);
    let x, z;
    if (side === 0) { x = -hx + hx * 2 * t; z = -hz; }
    else if (side === 1) { x = hx; z = -hz + hz * 2 * t; }
    else if (side === 2) { x = -hx + hx * 2 * t; z = hz; }
    else { x = -hx; z = -hz + hz * 2 * t; }
    out.push({ x: cx + x, y: q + 0.15, z: cz + z, s: rr(0.32, 0.95) });
  }
}

/* ------------------------------------------------------------------ *
 * 1. 莫角山宫殿区
 * ------------------------------------------------------------------ */
function buildPalace(B, M, scene, revet, onProgress) {
  const S = SURVEY.mojiao;
  platform(B, M, 0, -60, S.baseEW, S.baseNS, 620, 400, SURVEY.cityGround, S.top, M.rammed, { layers: 18 });
  slopeCobbles(revet, 0, -60, S.baseEW, S.baseNS, SURVEY.cityGround, S.top, 1650);
  onProgress(0.12, '莫角山 670×450 m 覆斗台基');

  /* 沙土广场：砂砾与粘土分层夯筑，约 7 万 m² */
  const plaza = boxGeo(320, 0.10, 220, 0.16);
  put(B, plaza, M.sand, [0, S.top + 0.02, 0]);
  /* 广场上零星砾石与夯窝 */
  for (let i = 0; i < 90; i++) {
    const x = rr(-155, 155), z = rr(-105, 105);
    put(B, boxGeo(rr(0.6, 2.4), 0.05, rr(0.6, 1.8)), M.gravel, [x, S.top + 0.10, z]);
  }

  /* 品字形三座宫殿台基 */
  const dm = S.damojiao;
  platform(B, M, 0, -190, dm.ew, dm.ns, 160, 76, S.top, dm.crest, M.rammed, { layers: 15, topShade: [0.86, 0.90, 0.74] });
  platform(B, M, -190, 25, 104, 72, 92, 62, S.top, 15.5, M.rammed, { layers: 9 });
  platform(B, M, 190, 25, 92, 66, 82, 58, S.top, 14.8, M.rammed, { layers: 8 });
  slopeCobbles(revet, 0, -190, dm.ew, dm.ns, S.top, dm.crest, 420);
  onProgress(0.28, '大莫角山 18 m 制高点与三台基');

  /* 35 座房屋基址：7 座在大莫角山、4 座在小莫角山，其余分布台顶与广场 */
  const sites = [];
  for (let i = 0; i < 7; i++) sites.push([0 + (i % 2 ? 34 : -34), dm.crest + 0.02, -190 - 30 + Math.floor(i / 2) * 22, i]);
  for (let i = 0; i < 4; i++) sites.push([-190 - 22 + (i % 2) * 44, 15.52, 25 - 16 + Math.floor(i / 2) * 30, 7 + i]);
  for (let i = 0; i < 24; i++) {
    const ang = i / 24 * Math.PI * 2, rad = 118 + (i % 3) * 26;
    const x = Math.cos(ang) * rad * 1.35, z = -20 + Math.sin(ang) * rad * 0.72;
    if (Math.abs(x) < 110 && Math.abs(z + 20) < 75) { sites.push([x + 145, S.top + 0.06, z, 11 + i]); continue; }
    sites.push([x, S.top + 0.06, z, 11 + i]);
  }
  sites.forEach(([x, y, z, i]) => {
    const w = rr(9, 17), d = rr(6, 11);
    put(B, boxGeo(w, 0.26, d), M.rammedPlain, [x, y + 0.02, z]);
    makePostHoles(B, M, x, y + 0.30, z, w * 0.8, d * 0.8, 4, 3);
    if (i % 5 !== 3) makeHouse(B, M, x, y + 0.28, z, w * 0.82, d * 0.8,
      { h: rr(2.1, 3.0), stilt: 0.5, dir: (i % 3) * 0.12 - 0.12 });
  });
  onProgress(0.42, '35 座房屋基址与干栏式宫殿');

  /* 皇坟山台地 + 八亩山台基 */
  platform(B, M, 0, 435, 620, 420, 580, 380, SURVEY.cityGround, 10.5, M.rammed, { layers: 15 });
  slopeCobbles(revet, 0, 435, 620, 420, SURVEY.cityGround, 10.5, 980);
  platform(B, M, 0, 380, 160, 90, 146, 78, 10.5, 15.0, M.rammed, { layers: 12 });
  for (let i = 0; i < 6; i++) {
    makeHouse(B, M, -210 + i * 84, 10.55, 500, rr(11, 16), rr(7, 10),
      { h: rr(2.2, 3.1), stilt: 0.55 });
  }

  /* 池中寺台地：炭化稻米堆积 >5000 m² 与高脚粮仓 */
  platform(B, M, 470, 250, 132, 96, 118, 84, SURVEY.cityGround, 6.5, M.rammed, { layers: 6 });
  for (let i = 0; i < 4; i++) {
    makeHouse(B, M, 430 + (i % 2) * 76, 6.55, 226 + Math.floor(i / 2) * 46, 13, 9,
      { h: 2.7, stilt: 1.15 });
  }
  onProgress(0.52, '皇坟山、池中寺粮仓');
}

/* ------------------------------------------------------------------ *
 * 2. 夯土城墙、8 水门、1 陆城门
 * ------------------------------------------------------------------ */
function gapAt(x, z) {
  for (const g of GATES) {
    if (g.side === 'N' || g.side === 'S') {
      if (Math.abs(z - g.z) < 74 && Math.abs(x - g.x) < g.w / 2 + 11) return true;
    } else {
      if (Math.abs(x - g.x) < 74 && Math.abs(z - g.z) < g.w / 2 + 11) return true;
    }
  }
  if (z > 880 && Math.abs(x) < LAND_GATE.w / 2 + 14) return true;
  return false;
}
function wallProfile(mult = 1) {
  const base = SURVEY.wall.base, crest = SURVEY.wall.crest;
  const hb = SURVEY.wall.baseW / 2 * mult, hc = SURVEY.wall.crestW / 2 * mult;
  return [[-hb, base], [-hc, crest], [hc, crest], [hb, base]];
}
function wallColor(j, u, y, i, dist) {
  const h = (y - SURVEY.wall.base) / (SURVEY.wall.crest - SURVEY.wall.base);
  if (h < 0.11) return [0.46, 0.48, 0.46];                 // 块石基础
  if (h > 0.90) return [0.66, 0.76, 0.52];                 // 顶部草被
  const layer = 0.78 + 0.22 * (0.5 + 0.5 * Math.sin(y * 12.5 + Math.sin(dist * 0.14) * 0.7));
  return [layer, layer * 0.95, layer * 0.83];               // 水平夯层
}
function buildWalls(B, M, scene, revet, onProgress) {
  const path = roundedRectPath(0, 0, WORLD.city.hx, WORLD.city.hz, WORLD.city.corner, 10);
  const n = path.length;
  const isGap = path.map(p => gapAt(p[0], p[1]));
  let start = isGap.findIndex(v => !v);
  if (start < 0) start = 0;
  const seq = [];
  for (let k = 0; k < n; k++) { const i = (start + k) % n; seq.push({ p: path[i], g: isGap[i] }); }
  seq.push({ p: path[start], g: false });
  const runs = []; let cur = [];
  for (const e of seq) {
    if (!e.g) cur.push(e.p);
    else { if (cur.length > 2) runs.push(cur); cur = []; }
  }
  if (cur.length > 2) runs.push(cur);

  const profile = wallProfile();
  const capUV = (u, y) => [u * 0.07, clamp((y - SURVEY.wall.base) / (SURVEY.wall.crest - SURVEY.wall.base), 0, 1)];
  runs.forEach(run => {
    const sw = sweepProfile(run, profile, { colorFn: wallColor, capUV, uvU: 0.16, uvV: 0.16 });
    put(B, sw.surface, M.rammed);
    sw.caps.forEach(g => put(B, g, M.strata));
    /* 墙脚卵石护坡 */
    for (let i = 0; i < run.length; i += 2) {
      const p0 = run[Math.max(0, i - 1)], p1 = run[Math.min(run.length - 1, i + 1)];
      let tx = p1[0] - p0[0], tz = p1[1] - p0[1];
      const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      const nx = -tz, nz = tx;
      for (const s of [-1, 1]) for (let k = 0; k < 2; k++) {
        const u = s * (19 + k * 3.6 + rnd() * 2.0);
        revet.push({ x: run[i][0] + nx * u, y: 4.35 + k * 0.42 + rnd() * 0.3,
                     z: run[i][1] + nz * u, s: rr(0.34, 0.92) });
      }
    }
  });
  onProgress(0.66, `城墙 ${runs.length} 段 / 8 水门 1 陆门`);

  /* 水城门：木桩护岸、门道标柱与停泊独木舟 */
  GATES.forEach((g, gi) => {
    const horiz = g.side === 'E' || g.side === 'W';
    const edge = g.w / 2 + 3;
    const a = horiz ? [g.x - 70, g.z - edge] : [g.x - edge, g.z - 70];
    const b = horiz ? [g.x + 70, g.z - edge] : [g.x - edge, g.z + 70];
    const c = horiz ? [g.x - 70, g.z + edge] : [g.x + edge, g.z - 70];
    const d = horiz ? [g.x + 70, g.z + edge] : [g.x + edge, g.z + 70];
    makePileQuay(B, M, [a, b], 2.4, { spacing: 3.4, width: 2.2 });
    makePileQuay(B, M, [c, d], 2.4, { spacing: 3.4, width: 2.2 });
    for (const s of [-1, 1]) {
      const px = horiz ? g.x + s * edge : g.x + s * edge;
      const pz = horiz ? g.z + s * edge : g.z;
      put(B, new THREE.CylinderGeometry(0.22, 0.28, 3.2, 7), M.darkWood,
        [px, 4.2, pz]);
    }
    if (gi % 2 === 0) {
      const boat = makeCanoe(M);
      const bx = horiz ? g.x + 18 : g.x + (g.w / 2 + 12);
      const bz = horiz ? g.z + (g.w / 2 + 14) : g.z + 16;
      boat.position.set(bx, WORLD.waterY + 0.08, bz);
      boat.rotation.y = horiz ? Math.PI / 2 : 0;
      boat.scale.setScalar(0.86);
      scene.add(boat);
    }
  });

  /* 陆城门：「品」字形三座夯土台基，分出四个门道，总宽 150 m */
  const lg = [[-56, 0], [56, 0], [0, -34]];
  lg.forEach(([dx, dz]) => {
    platform(B, M, dx, 955 + dz, 34, 26, 28, 20, SURVEY.cityGround, 7.4, M.rammed, { layers: 8 });
    slopeCobbles(revet, dx, 955 + dz, 34, 26, SURVEY.cityGround, 7.4, 70);
  });
  makeElevationRuler(B, M, -76, SURVEY.cityGround, 990, 5.0);
  onProgress(0.74, '陆城门品字形台基');
}

/* ------------------------------------------------------------------ *
 * 3. 王陵区：反山、姜家山、桑树头
 * ------------------------------------------------------------------ */
function graveRows(B, M, cx, y, cz, count, w = 2.6, d = 4.2) {
  const perRow = Math.ceil(count / 2);
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow), k = i % perRow;
    const x = cx + (k - (perRow - 1) / 2) * 6.2;
    const z = cz + (row - 0.5) * 7.2;
    put(B, boxGeo(w, 0.08, d), M.darkWood, [x, y + 0.02, z]);
    put(B, boxGeo(w * 0.78, 0.04, d * 0.76), M.greySoil, [x, y + 0.08, z]);
  }
}
function buildCemetery(B, M, revet, onProgress) {
  /* 南北向长垄（西侧王陵与贵族墓地带） */
  platform(B, M, -400, -130, 110, 770, 88, 740, SURVEY.cityGround, 7.4, M.rammed, { layers: 9 });
  slopeCobbles(revet, -400, -130, 110, 770, SURVEY.cityGround, 7.4, 520);
  /* 反山王陵：高出地表约 5 m，11 座大墓 */
  platform(B, M, -400, -340, 90, 30, 76, 22, 7.4, SURVEY.fanshan.crest, M.rammed, { layers: 6 });
  put(B, boxGeo(76, 0.06, 22), M.gravel, [-400, SURVEY.fanshan.crest + 0.01, -340]);
  graveRows(B, M, -400, SURVEY.fanshan.crest + 0.08, -340, 11, 2.6, 4.0);
  slopeCobbles(revet, -400, -340, 90, 30, 7.4, SURVEY.fanshan.crest, 120);
  /* 姜家山 17 座墓、桑树头 */
  platform(B, M, -400, -80, 76, 66, 64, 56, 7.4, 8.9, M.rammed, { layers: 5 });
  graveRows(B, M, -400, 8.96, -80, 17, 2.2, 3.4);
  platform(B, M, -400, 160, 76, 62, 64, 52, 7.4, 8.7, M.rammed, { layers: 5 });
  graveRows(B, M, -400, 8.76, 160, 9, 2.2, 3.4);
  onProgress(0.82, '反山王陵 11 墓 / 姜家山 17 墓');
}

/* ------------------------------------------------------------------ *
 * 4. 瑶山 / 汇观山祭坛
 * ------------------------------------------------------------------ */
function buildAltar(B, M, revet, cx, cz, peak, scale, onProgress) {
  const s = scale;
  const outerW = 24 * s, outerD = 18 * s;
  const redW = 7.6 * s, redD = 5.9 * s;
  const trenchW = 1.9 * s;
  /* 山顶削平至 33.4 m（瑶山）/ 21.0 m（汇观山），祭坛为高出山顶的覆斗状土台 */
  const base = peak - 1.6;
  const gravelTop = base + 1.2;              // 黄褐斑土砾石台面
  const trenchBottom = base + 0.25;         // 灰土围沟底：低于台面 0.95 m
  const redTop = peak - 0.2;                // 红土台顶 34.8 m，为祭坛制高点
  /* 第三重：黄褐色斑土 + 砾石台面（回字外框） */
  const iw = redW + trenchW * 2, id = redD + trenchW * 2;
  const outer = frameGeo(outerW, outerD, iw, id, 1.2);
  put(B, outer, M.gravel, [cx, base, cz]);
  /* 第二重：灰土围沟（低于台面约 0.8 m） */
  const grey = frameGeo(iw, id, redW, redD, 0.16);
  put(B, grey, M.greySoil, [cx, trenchBottom, cz]);
  /* 第一重：红土台，祭坛制高点 */
  const redH = redTop - trenchBottom;
  put(B, boxGeo(redW, redH, redD, 0.3), M.redClay, [cx, trenchBottom + redH / 2, cz]);
  /* 立杆测影 */
  put(B, new THREE.CylinderGeometry(0.11 * s, 0.15 * s, 3.6 * s, 8), M.darkWood,
    [cx, peak + 1.7 * s, cz]);
  /* 13 座墓葬：南北两列 */
  for (let i = 0; i < 13; i++) {
    const row = i < 7 ? 0 : 1, k = row === 0 ? i : i - 7;
    const n = row === 0 ? 7 : 6;
    const x = cx + (k - (n - 1) / 2) * 3.0 * s;
    const z = cz + (4.6 + row * 2.5) * s;
    put(B, boxGeo(1.9 * s, 0.06, 3.0 * s), M.darkWood, [x, gravelTop + 0.02, z]);
    put(B, boxGeo(1.5 * s, 0.04, 2.5 * s), M.greySoil, [x, gravelTop + 0.07, z]);
  }
  /* 砾石台阶（南侧） */
  for (let i = 0; i < 14; i++) {
    const z = cz + outerD / 2 + 1.4 * s + i * 1.5 * s;
    const y = gravelTop - i * 0.52 * s;
    put(B, boxGeo(6.2 * s, 0.42 * s, 1.7 * s), M.gravel, [cx, y, z]);
  }
  /* 石坎护坡：西北 / 西 / 南三面挡土石磡 */
  for (let ring = 0; ring < 3; ring++) {
    const rad = (outerW / 2 + 9 + ring * 5.5) * s;
    const y = peak - 1.0 - ring * 1.45;
    for (let i = 0; i < 34; i++) {
      const a = -Math.PI * 0.12 + i / 33 * Math.PI * 1.55;
      const x = cx + Math.cos(a) * rad, z = cz + Math.sin(a) * rad * (outerD / outerW);
      put(B, boxGeo(rr(2.1, 3.4) * s, rr(0.9, 1.4) * s, rr(1.3, 2.1) * s), M.stoneBlock,
        [x, y, z], [0, -a, 0]);
    }
  }
  /* 坡面散落砾石 */
  for (let i = 0; i < 260 * s; i++) {
    const a = rnd() * Math.PI * 2, rad = (18 + rnd() * 78) * s;
    const x = cx + Math.cos(a) * rad, z = cz + Math.sin(a) * rad;
    revet.push({ x, y: terrainHeight(x, z) + 0.15, z, s: rr(0.35, 1.1) * s });
  }
}
function buildAltars(B, M, revet, onProgress) {
  buildAltar(B, M, revet, 3200, -3600, SURVEY.yaoshan.peak, 1.0, onProgress);
  buildAltar(B, M, revet, 2480, -4230, SURVEY.huiguanshan.peak, 0.72, onProgress);
  onProgress(0.90, '瑶山三重土色祭坛与汇观山');
}

/* ------------------------------------------------------------------ *
 * 5. 外郭条状台地、木栈桥与码头
 * ------------------------------------------------------------------ */
const GUO = [
  { name: '扁担山', x: -700, z: -1420, w: 540, d: 74, y: 6.4 },
  { name: '和尚地', x: 260, z: -1420, w: 450, d: 68, y: 6.0 },
  { name: '美人地', x: 1520, z: -560, w: 72, d: 480, y: 6.2 },
  { name: '里山', x: 1520, z: 140, w: 68, d: 390, y: 6.0 },
  { name: '高村', x: 1480, z: 720, w: 82, d: 340, y: 5.8 },
  { name: '卞家山', x: 180, z: 1500, w: 660, d: 76, y: 6.0 },
  { name: '文家山', x: -1250, z: 1080, w: 340, d: 72, y: 5.9 },
  { name: '东杨家村', x: -1460, z: 400, w: 68, d: 340, y: 5.7 },
  { name: '西杨家村', x: -1560, z: -220, w: 68, d: 300, y: 5.7 },
];
function buildOuterGuo(B, M, scene, revet, onProgress) {
  GUO.forEach((g, gi) => {
    platform(B, M, g.x, g.z, g.w + 10, g.d + 10, g.w, g.d, SURVEY.wetlandGround, g.y,
      M.rammed, { layers: 8, topShade: [0.72, 0.82, 0.58] });
    slopeCobbles(revet, g.x, g.z, g.w + 10, g.d + 10, SURVEY.wetlandGround, g.y, 90, 0.55);
    /* 台地上的干栏式住屋 */
    const long = g.w > g.d;
    const count = Math.max(3, Math.floor((long ? g.w : g.d) / 72));
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count - 0.5;
      const x = g.x + (long ? t * g.w * 0.86 : rr(-g.w * 0.2, g.w * 0.2));
      const z = g.z + (long ? rr(-g.d * 0.18, g.d * 0.18) : t * g.d * 0.86);
      makeHouse(B, M, x, g.y + 0.02, z, long ? rr(11, 16) : rr(8, 12), long ? rr(7, 10) : rr(11, 15),
        { h: rr(2.1, 2.8), stilt: 0.85, dir: long ? 0 : Math.PI / 2 });
    }
    /* 临水木桩码头 */
    if (gi % 2 === 0) {
      const long = g.w > g.d;
      const px = g.x + (long ? 0 : (g.w / 2 + 6));
      const pz = g.z + (long ? (g.d / 2 + 6) : 0);
      makePileQuay(B, M, long ? [[px - 26, pz], [px + 26, pz]] : [[px, pz - 26], [px, pz + 26]],
        WORLD.waterY, { spacing: 2.6, width: 2.6 });
    }
  });
  /* 钟家港古河道沿岸作坊木桩 */
  for (let k = 0; k < 8; k++) {
    const z = -720 + k * 190;
    makePileQuay(B, M, [[430, z], [430, z + 42]], WORLD.waterY, { spacing: 3.0, width: 2.2 });
  }
  /* 跨内环水网的木桥 */
  for (const [x, z, len, rot] of [[0, -460, 46, 0], [-430, 0, 46, Math.PI / 2], [430, -60, 46, Math.PI / 2], [0, 340, 46, 0]]) {
    for (let i = 0; i < 14; i++) {
      const t = (i + 0.5) / 14 - 0.5;
      const px = x + (rot === 0 ? t * len : 0), pz = z + (rot === 0 ? 0 : t * len);
      put(B, boxGeo(rot === 0 ? len / 14 + 0.1 : 3.0, 0.14, rot === 0 ? 3.0 : len / 14 + 0.1), M.wood,
        [px, WORLD.waterY + 1.25, pz]);
      if (i % 4 === 0) put(B, new THREE.CylinderGeometry(0.12, 0.14, 2.6, 6), M.darkWood,
        [px, WORLD.waterY + 0.4, pz]);
    }
  }
  onProgress(1.0, '外郭台地、码头与木桥');
}

export function buildCity(ctx) {
  const { B, M, scene, revet } = ctx;
  const cb = ctx.onProgress || (() => {});
  buildPalace(B, M, scene, revet, p => cb(p * 0.34, '莫角山宫殿区'));
  buildWalls(B, M, scene, revet, p => cb(0.34 + p * 0.24, '夯土城墙与水门'));
  buildCemetery(B, M, revet, p => cb(0.58 + p * 0.10, '王陵区'));
  buildAltars(B, M, revet, p => cb(0.68 + p * 0.12, '祭坛'));
  buildOuterGuo(B, M, scene, revet, p => cb(0.80 + p * 0.20, '外郭与码头'));
}
export { GUO };
