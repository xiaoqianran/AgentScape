/* 良渚 · 水城 —— 水系场
 * 内外城河、内外环水网、51 条古河道、8 水门通道、外郭水面、8.5 km² 库区、
 * 塘山双坝渠道、谷口高坝上游山谷水库，以及坝体/台基占地的岸线裁剪。
 * 提供带空间索引的 SDF、深度场与三张水面 mask（2.6 / 8.2 / 26.0 m）。
 */
import * as THREE from 'three';
import {
  WORLD, SURVEY, clamp, smooth, lerp, fbm, roundedRectPath, mulberry32,
} from './core.js';

const WL = SURVEY.waterLevel;

/* ------------------------------------------------------------------ *
 * 1. 考古要素定义
 * ------------------------------------------------------------------ */
export const GATES = [
  { id: 'N1', side: 'N', x: -450, z: -955, w: 52 },
  { id: 'N2', side: 'N', x: 450, z: -955, w: 52 },
  { id: 'S1', side: 'S', x: -520, z: 955, w: 48 },
  { id: 'S2', side: 'S', x: 520, z: 955, w: 48 },
  { id: 'E1', side: 'E', x: 885, z: -450, w: 56 },
  { id: 'E2', side: 'E', x: 885, z: 450, w: 56 },
  { id: 'W1', side: 'W', x: -885, z: -450, w: 36 },
  { id: 'W2', side: 'W', x: -885, z: 450, w: 36 },
];
export const LAND_GATE = { x: 0, z: 955, w: 150 };

/* 环形水系：内城河 / 外城河（南墙缺外城河）/ 内环 / 外环 / 城外宽阔水面 */
export const RINGS = [
  { id: 'innerMoat', name: '内城河', cx: 0, cz: 0, hx: 830, hz: 900, r: 150, hw: 30, d: 3.2 },
  { id: 'outerMoat', name: '外城河', cx: 0, cz: 0, hx: 975, hz: 1050, r: 180, hw: 58, d: 3.4, noSouth: true, cutZ: 760, cutX: 1200 },
  { id: 'innerRing', name: '宫殿区内环水网', cx: 0, cz: -60, hx: 430, hz: 400, r: 130, hw: 22, d: 2.8 },
  { id: 'outerRing', name: '内城外环水网', cx: 0, cz: -60, hx: 690, hz: 730, r: 190, hw: 30, d: 3.0 },
  { id: 'outerWater', name: '城外东 / 北 / 西开阔水面', cx: 0, cz: 0, hx: 1420, hz: 1500, r: 300, hw: 170, d: 2.4 },
];

/* 51 条古河道：4 条南北纵河 × 6 段 + 4 条东西横河 × 5 段 + 7 条汊港 */
export const TRUNKS = (() => {
  const out = [];
  const VX = [-700, -470, 400, 690], VW = [28, 20, 44, 32];
  const HZ = [-760, -500, 250, 520], HW = [26, 34, 30, 24];
  const ZB = [-880, -760, -500, 250, 520, 780, 880];
  const XB = [-860, -700, -470, 400, 690, 860];
  const rnd = mulberry32(510051);
  VX.forEach((x, i) => {
    for (let k = 0; k < ZB.length - 1; k++) {
      const w = clamp(VW[i] + (rnd() - 0.5) * 12, 10, 50);
      out.push({ id: `V${i}-${k}`, name: i === 2 && k === 2 ? '钟家港（城内水上交通要道）' : `南北古河道 ${i + 1}`,
        x1: x, z1: ZB[k], x2: x, z2: ZB[k + 1], w, d: clamp(2.2 + rnd() * 1.7, 2, 4) });
    }
  });
  HZ.forEach((z, i) => {
    for (let k = 0; k < XB.length - 1; k++) {
      const w = clamp(HW[i] + (rnd() - 0.5) * 12, 10, 50);
      out.push({ id: `H${i}-${k}`, name: `东西古河道 ${i + 1}`,
        x1: XB[k], z1: z, x2: XB[k + 1], z2: z, w, d: clamp(2.2 + rnd() * 1.7, 2, 4) });
    }
  });
  const branches = [
    ['反山前汊港', -470, -500, -620, -620, 18],
    ['王陵区西侧河', -700, -620, -820, -380, 16],
    ['皇坟山南汊', -470, 520, -300, 700, 22],
    ['池中寺东河湾', 400, 250, 560, 340, 20],
    ['东水门内汊', 690, -450, 830, -450, 30],
    ['西水门内汊', -690, 450, -830, 450, 22],
    ['作坊区河湾', 400, 520, 560, 640, 24],
  ];
  branches.forEach(([name, x1, z1, x2, z2, w], i) => out.push({
    id: `B${i}`, name, x1, z1, x2, z2, w, d: 2.4 + (i % 3) * 0.5,
  }));
  return out;                                    // 24 + 20 + 7 = 51
})();

/* 8 座水城门水道：沟通内外城河，穿城墙豁口 */
export const GATE_CHANNELS = GATES.map(g => {
  const r = g.w / 2;
  if (g.side === 'N') return { id: g.id, x1: g.x, z1: -880, x2: g.x, z2: -1070, w: g.w, d: 3.2 };
  if (g.side === 'S') return { id: g.id, x1: g.x, z1: 880, x2: g.x, z2: 1320, w: g.w, d: 3.0 };
  if (g.side === 'E') return { id: g.id, x1: 850, z1: g.z, x2: 1070, z2: g.z, w: g.w, d: 3.2 };
  return { id: g.id, x1: -850, z1: g.z, x2: -1070, z2: g.z, w: g.w, d: 3.0 };
});

/* 低水位（2.6 m）湖沼：高—低坝之间 8.5 km² 库区 + 城郊湿地浅塘 */
export const LAKES = [
  { id: 'reservoir', name: '高坝—低坝库区（约 8.5 km²）', x: -3100, z: -3000, rx: 1950, rz: 1400, d: 3.4 },
  { id: 'eastMarsh', name: '城东湿地湖', x: 2750, z: 260, rx: 660, rz: 500, d: 2.2 },
  { id: 'seShallow', name: '东南浅滩', x: 2250, z: 1520, rx: 540, rz: 390, d: 1.8 },
  { id: 'swMarsh', name: '西南沼泽', x: -1950, z: 1620, rx: 620, rz: 430, d: 2.0 },
  { id: 'northLake', name: '北郊湖', x: 620, z: -1950, rx: 570, rz: 360, d: 2.2 },
];
(() => {
  const rnd = mulberry32(778811);
  for (let i = 0; i < 12; i++) {
    LAKES.push({ id: `pond${i}`, name: '湿地浅塘',
      x: -4600 + rnd() * 9200, z: -3600 + rnd() * 7200,
      rx: 70 + rnd() * 170, rz: 55 + rnd() * 130, d: 1.2 + rnd() * 1.0 });
  }
})();

/* 岸线裁剪：夯土台基、王陵区、外郭台地、库区孤丘 */
export const CUTS = [
  { type: 'box', x: 0, z: -60, hx: 342, hz: 232 },             // 莫角山台基
  { type: 'box', x: 0, z: 435, hx: 312, hz: 212 },             // 皇坟山台地
  { type: 'box', x: -400, z: -130, hx: 58, hz: 385 },          // 王陵南北向长垄
  { type: 'box', x: 470, z: 250, hx: 66, hz: 48 },             // 池中寺台地
  { type: 'box', x: 3200, z: -3600, hx: 130, hz: 125 },        // 瑶山山顶
  { type: 'box', x: 2480, z: -4230, hx: 95, hz: 90 },          // 汇观山山顶
];
/* 库区内孤丘（低坝所连接的自然山体） */
export const HILLOCKS = [
  [-4350, -1980, 24], [-4080, -1920, 18], [-3700, -1900, 26], [-3410, -1880, 16],
  [-3050, -1880, 23], [-2720, -1840, 17], [-2400, -1830, 25], [-2090, -1790, 19],
];
HILLOCKS.forEach(([x, z, h]) => CUTS.push({ type: 'ell', x, z, rx: h * 6.2, rz: h * 5.4 }));

/* 塘山长堤（山前长堤）：西段矩尺形单层坝 / 中段南北双层坝 / 东段单坝 */
export const TANGSHAN = {
  west: [[-4600, -3480], [-3980, -3480], [-3980, -3120], [-3400, -3060]],
  middle: [[-3400, -2960], [-2800, -2930], [-2200, -2880], [-1600, -2810], [-1000, -2730], [-520, -2660]],
  east: [[-520, -2660], [180, -2540], [900, -2380]],
  gap: 26,                 // 双坝间距（考古 20–30 m）
  channelBottom: 7.6,     // 渠底海拔（考古 7–8 m）
  northCrest: 17.5,       // 考古 15–20 m
  southCrest: 13.5,       // 考古 12–15 m
  baseW: 44, crestW: 14,
};
export const TANGSHAN_MID = TANGSHAN.middle;

/* 谷口高坝上游山谷水库（水面 26 m） */
export const UPLAND_LAKES = [
  { id: 'eastValley', name: '东组谷口上游水库', x: -2600, z: -4660, rx: 430, rz: 260, d: 3.2 },
  { id: 'westValley', name: '西组谷口上游水库', x: -4930, z: -4520, rx: 400, rz: 235, d: 3.0 },
];

/* 11 条坝体：6 谷口高坝 + 4 平原低坝 + 1 山前长堤 */
export const HIGH_DAMS = [
  { id: 'ggl', name: '岗公岭', group: '东组', x: -2080, z: -4200, ang: 0.10, len: 120, crest: 32.0, baseY: 19.0, baseW: 98, crestW: 26 },
  { id: 'lhl', name: '老虎岭', group: '东组', x: -2650, z: -4240, ang: 0.04, len: 148, crest: 33.0, baseY: 19.5, baseW: 100, crestW: 28 },
  { id: 'zjf', name: '周家畈', group: '东组', x: -3180, z: -4190, ang: -0.08, len: 96, crest: 31.5, baseY: 18.5, baseW: 94, crestW: 24 },
  { id: 'qw', name: '秋坞', group: '西组', x: -4230, z: -4160, ang: 0.06, len: 112, crest: 34.0, baseY: 20.0, baseW: 100, crestW: 28 },
  { id: 'sw', name: '石坞', group: '西组', x: -4760, z: -4230, ang: -0.06, len: 84, crest: 33.5, baseY: 20.0, baseW: 96, crestW: 24 },
  { id: 'mfl', name: '蜜蜂弄', group: '西组', x: -5260, z: -4160, ang: 0.12, len: 66, crest: 31.0, baseY: 18.5, baseW: 92, crestW: 22 },
];
export const LOW_DAMS = [
  { id: 'wtl', name: '梧桐弄', x1: -4350, z1: -1980, x2: -4080, z2: -1920, crest: 10.0, baseY: 4.0, baseW: 52, crestW: 16 },
  { id: 'gs', name: '官山', x1: -3700, z1: -1900, x2: -3410, z2: -1880, crest: 10.0, baseY: 4.0, baseW: 52, crestW: 16 },
  { id: 'lys', name: '鲤鱼山', x1: -3050, z1: -1880, x2: -2720, z2: -1840, crest: 10.0, baseY: 4.0, baseW: 54, crestW: 16 },
  { id: 'szs', name: '狮子山', x1: -2400, z1: -1830, x2: -2090, z2: -1790, crest: 10.0, baseY: 4.0, baseW: 50, crestW: 16 },
];

/* 乘船航线：三条闭合水道环线，均落在 SDF 水域中心线上 */
export const BOAT_ROUTES = [
  { id: 'moat', name: '内城河环线 · 水城门',
    points: roundedRectPath(0, 0, 830, 900, 150, 42), closed: true },
  { id: 'inner', name: '宫城内环 · 钟家港',
    points: roundedRectPath(0, -60, 430, 400, 130, 34), closed: true },
  { id: 'outer', name: '外环水网 · 作坊区',
    points: roundedRectPath(0, -60, 690, 730, 190, 46), closed: true },
];

/* ------------------------------------------------------------------ *
 * 2. SDF 基元与空间索引
 * ------------------------------------------------------------------ */
function sdRoundBox(px, pz, hx, hz, r) {
  const qx = Math.abs(px) - hx + r, qz = Math.abs(pz) - hz + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
}
function segDist(x, z, x1, z1, x2, z2) {
  const dx = x2 - x1, dz = z2 - z1;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? clamp(((x - x1) * dx + (z - z1) * dz) / l2, 0, 1) : 0;
  return Math.hypot(x - (x1 + t * dx), z - (z1 + t * dz));
}
const ellQ = (x, z, e) => Math.hypot((x - e.x) / e.rx, (z - e.z) / e.rz);

/* 每个基元带 margin 包围盒与类型化求值，供索引桶快速剔除 */
const LOW = [];
function pushSeg(a, r, d) {
  LOW.push({ t: 0, x1: a.x1, z1: a.z1, x2: a.x2, z2: a.z2, r: r || a.w / 2, d: d || a.d,
    minX: Math.min(a.x1, a.x2) - r - 14, maxX: Math.max(a.x1, a.x2) + r + 14,
    minZ: Math.min(a.z1, a.z2) - r - 14, maxZ: Math.max(a.z1, a.z2) + r + 14 });
}
function pushRing(a) {
  LOW.push({ t: 1, ...a,
    minX: a.cx - a.hx - a.hw - 14, maxX: a.cx + a.hx + a.hw + 14,
    minZ: a.cz - a.hz - a.hw - 14, maxZ: a.cz + a.hz + a.hw + 14 });
}
function pushEll(a) {
  LOW.push({ t: 2, ...a,
    minX: a.x - a.rx - 14, maxX: a.x + a.rx + 14,
    minZ: a.z - a.rz - 14, maxZ: a.z + a.rz + 14 });
}
RINGS.forEach(pushRing);
TRUNKS.forEach(a => pushSeg(a, a.w / 2, a.d));
GATE_CHANNELS.forEach(a => pushSeg(a, a.w / 2, a.d));
LAKES.forEach(pushEll);

const HIGH = UPLAND_LAKES.map(a => ({ ...a,
  minX: a.x - a.rx - 14, maxX: a.x + a.rx + 14,
  minZ: a.z - a.rz - 14, maxZ: a.z + a.rz + 14 }));
const MID_SEGS = [];
for (let i = 0; i < TANGSHAN_MID.length - 1; i++) {
  const a = TANGSHAN_MID[i], b = TANGSHAN_MID[i + 1];
  MID_SEGS.push({ x1: a[0], z1: a[1], x2: b[0], z2: b[1], r: 12 });
}

const CELL = 260;
const COLS = Math.ceil(WORLD.extent[0] / CELL) + 2;
const ROWS = Math.ceil(WORLD.extent[1] / CELL) + 2;
const bucket = new Map();
function cellKey(cx, cz) { return cz * COLS + cx; }
function idxOf(x, z) {
  return [Math.floor((x + WORLD.extent[0] / 2) / CELL) + 1, Math.floor((z + WORLD.extent[1] / 2) / CELL) + 1];
}
function register(list) {
  list.forEach((p, pi) => {
    const c0 = idxOf(p.minX, p.minZ), c1 = idxOf(p.maxX, p.maxZ);
    for (let cz = c0[1]; cz <= c1[1]; cz++) for (let cx = c0[0]; cx <= c1[0]; cx++) {
      if (cx < 0 || cz < 0 || cx >= COLS || cz >= ROWS) continue;
      const k = cellKey(cx, cz);
      if (!bucket.has(k)) bucket.set(k, []);
      if (!bucket.get(k).includes(pi)) bucket.get(k).push(pi);
    }
  });
}
register(LOW);

function primDist(p, x, z) {
  if (p.t === 0) return segDist(x, z, p.x1, p.z1, p.x2, p.z2) - p.r;
  if (p.t === 1) {
    if (p.noSouth && z > p.cutZ && Math.abs(x - p.cx) < p.cutX) return 1e4;
    return Math.abs(sdRoundBox(x - p.cx, z - p.cz, p.hx, p.hz, p.r)) - p.hw;
  }
  return (ellQ(x, z, p) - 1) * Math.min(p.rx, p.rz);
}
/* 裁剪域整体包围盒：绝大多数采样点无需逐项求交 */
const CUT_BB = CUTS.reduce((a, q) => {
  const hx = q.type === 'box' ? q.hx : q.rx, hz = q.type === 'box' ? q.hz : q.rz;
  return { minX: Math.min(a.minX, q.x - hx - 4), maxX: Math.max(a.maxX, q.x + hx + 4),
           minZ: Math.min(a.minZ, q.z - hz - 4), maxZ: Math.max(a.maxZ, q.z + hz + 4) };
}, { minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9 });
function cutDist(x, z) {
  if (x < CUT_BB.minX || x > CUT_BB.maxX || z < CUT_BB.minZ || z > CUT_BB.maxZ) return 1e5;
  let c = 1e5;
  for (let i = 0; i < CUTS.length; i++) {
    const q = CUTS[i];
    const hx = q.type === 'box' ? q.hx : q.rx, hz = q.type === 'box' ? q.hz : q.rz;
    if (Math.abs(x - q.x) > hx + 4 || Math.abs(z - q.z) > hz + 4) continue;
    if (q.type === 'box') {
      const dx = Math.abs(x - q.x) - q.hx, dz = Math.abs(z - q.z) - q.hz;
      c = Math.min(c, Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0));
    } else {
      c = Math.min(c, (ellQ(x, z, q) - 1) * Math.min(q.rx, q.rz));
    }
  }
  return c;
}

/** 低水位（2.6 m）水系有符号距离，<0 为水中 */
export function waterSDF(x, z) {
  const i = idxOf(x, z);
  const list = bucket.get(cellKey(i[0], i[1]));
  if (!list) return 1e4;
  let d = 1e4;
  for (let k = 0; k < list.length; k++) {
    const p = LOW[list[k]];
    if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
    const v = primDist(p, x, z);
    if (v < d) d = v;
  }
  const c = cutDist(x, z);
  if (c < 3) d = Math.max(d, -c);
  return d;
}
export const inWater = (x, z) => waterSDF(x, z) < 0;

/** 谷口高坝上游水库 SDF（水面 26 m） */
export function uplandSDF(x, z) {
  let d = 1e4;
  for (let i = 0; i < HIGH.length; i++) {
    const p = HIGH[i];
    if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
    d = Math.min(d, (ellQ(x, z, p) - 1) * Math.min(p.rx, p.rz));
  }
  return d;
}
/** 塘山双坝之间的渠道 SDF（水面 8.2 m） */
export function channelSDF(x, z) {
  let d = 1e4;
  for (let i = 0; i < MID_SEGS.length; i++) {
    const s = MID_SEGS[i];
    d = Math.min(d, segDist(x, z, s.x1, s.z1, s.x2, s.z2) - s.r);
  }
  return d;
}

/** 水下淤泥河床高程：按 SDF 深度与有机物噪声给出 2–4 m 的河道深度 */
export function bedElevation(x, z, level = WL, sdf = waterSDF) {
  const d = sdf(x, z);
  const deep = smooth(0, -26, d);
  const n = fbm(x * 0.008 + 3.1, z * 0.008 + 7.7, 503, 3);
  return level - (0.75 + 2.65 * deep + n * 0.42);
}
/** 岸线附近的浑浊度（水下淤泥可见度） */
export function siltFactor(x, z) {
  const d = waterSDF(x, z);
  return clamp(1 - smooth(-2, -22, d), 0, 1) * 0.75 + 0.25 * fbm(x * 0.01, z * 0.01, 509, 3);
}

/* ------------------------------------------------------------------ *
 * 3. 水面 mask 纹理：R 覆盖 · G 深度 · B 淤泥浑浊度
 * ------------------------------------------------------------------ */
function makeMask(w, h, sdf, extent, origin, onStep) {
  const data = new Uint8Array(w * h * 4);
  const [EW, NS] = extent;
  for (let j = 0; j < h; j++) {
    const z = origin[1] + (j / (h - 1) - 0.5) * NS;
    for (let i = 0; i < w; i++) {
      const x = origin[0] + (i / (w - 1) - 0.5) * EW;
      const d = sdf(x, z);
      const cover = 1 - smooth(-1.6, 3.4, d);
      const depth = clamp(-d / 22, 0, 1);
      const silt = clamp(0.30 + 0.70 * (1 - smooth(-1, -16, d)) + 0.18 * fbm(x * 0.012, z * 0.012, 521, 2), 0, 1);
      const k = (j * w + i) * 4;
      data[k] = cover * 255; data[k + 1] = depth * 255; data[k + 2] = silt * 255; data[k + 3] = 255;
    }
    if (onStep && j % 96 === 0) onStep(j / h);
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}
/** 主水面：全流域 2.6 m。核心区用独立高密度 mask 以保证 10 m 窄河道不断裂 */
export function buildWaterMasks(q, onProgress) {
  const coreW = Math.round(1024 * clamp(q.detail + 0.15, 0.6, 1.1));
  const coreH = Math.round(coreW * 3800 / 3600);
  const basinW = Math.round(1024 * clamp(q.detail, 0.6, 1));
  const basinH = Math.round(basinW * WORLD.extent[1] / WORLD.extent[0]);
  const core = makeMask(coreW, coreH, waterSDF, [3600, 3800], [0, 0]);
  if (onProgress) onProgress(0.55, '内城水网 mask');
  const basin = makeMask(basinW, basinH, waterSDF, WORLD.extent, [0, 0]);
  if (onProgress) onProgress(0.85, '流域水面 mask');
  const mid = makeMask(512, 384, channelSDF, [6000, 3000], [-2200, -2800]);
  const high = makeMask(512, 384, uplandSDF, [6000, 3000], [-3700, -4600]);
  if (onProgress) onProgress(1, '渠道 / 山谷水库 mask');
  return { core, basin, mid, high,
    coreExtent: [3600, 3800], coreOrigin: [0, 0],
    basinExtent: WORLD.extent, basinOrigin: [0, 0],
    midExtent: [6000, 3000], midOrigin: [-2200, -2800],
    highExtent: [6000, 3000], highOrigin: [-3700, -4600] };
}

/* ------------------------------------------------------------------ *
 * 4. 供小地图与剖面图使用的要素清单
 * ------------------------------------------------------------------ */
export const MAP_WATER = { rings: RINGS, trunks: TRUNKS, gates: GATE_CHANNELS, lakes: LAKES };
