/* 良渚 · 水城 —— 核心层
 * 考古高程基准、场景尺度、确定性噪声、程序化 PBR 贴图集、材质库、
 * 几何工具（覆斗台基 / 断面扫掠）、静态网格合批。
 * 1 场景单位 = 1 米；+X 向东，-Z 向北，+Y = 海拔高程（米，黄海高程近似）。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ================================================================== *
 * 1. 考古高程与实测尺度基准（SURVEY）
 * 依据：良渚遗址官网 lzsite.cn、国家文物局《浙江余杭良渚古城外围大型
 * 水利工程的调查与发掘》、中国文物报「新时代浙江考古重大成果巡礼」、
 * 良渚博物院 / 浙江省文物考古研究所公开资料、《瑶山》考古报告修订版。
 * 所有数值均为公开考古报告中的量级；场景按中值建模，争议区间以 min/max 保留。
 * ================================================================== */
export const SURVEY = {
  datum: 'Y 轴即海拔高程（m，黄海高程近似）· 1 单位 = 1 m',
  era: '距今 5300–4300 年（约公元前 3300–2300 年）',
  waterLevel: 2.6,          // 湿地常年水位 / 城内河道水面
  cityGround: 4.2,          // 城内地面 3–5 m
  wetlandGround: 3.0,       // 城外湿地与稻田地面
  innerCity:   { ew: 1770, ns: 1910, area: 3.00e6, note: '略呈圆角长方形，正南北向，约 300 万 m²' },
  outerGuo:    { area: 6.30e6, note: '外郭内约 630 万 m²（另有 800 万 m² 口径）' },
  wall: {
    crest: 9.0, base: 4.2, height: 4.8,      // 现存较好地段约 4 m，复原高度 5 m 以上
    widthMin: 20, widthTypical: 40, widthMax: 150,
    baseW: 48, crestW: 31, slopeDeg: 30,     // 坡度约 30°
    note: '底部普遍铺垫石块，其上以较纯净黄土堆筑；东北凤山、西南雉山纳入墙体',
  },
  gates: { water: 8, perSide: 2, widthMin: 30, widthMax: 60, westNarrow: '30–40',
           land: 1, landWidth: 150, landNote: '南墙中部「品」字形三台基、四个门道' },
  canals: { count: 51, widthMin: 10, widthMax: 50, depthMin: 2, depthMax: 4,
            note: '城内已发现古河道 51 条，河道宽一般 10–50 m、深 2–4 m' },
  mojiao: {
    baseEW: 670, baseNS: 450, area: 3.0e5, top: 12.0,
    earthwork: 2.11e6, note: '长方形覆斗状人工土台，土方约 211–228 万 m³，台顶与周边稻田高差 9–15 m',
    plaza: 7.0e4, houses: 35,
    damojiao: { ew: 175, ns: 88, area: 1.5e4, rel: 6.0, crest: 18.0,
                note: '古城制高点，海拔 18 m，南北两排共 7 座房址' },
    xiaomojiao: { houses: 4 },
  },
  huangfen: { area: 2.4e5, note: '莫角山以南，最高处八亩山台基与大莫角山南北相对' },
  fanshan: { length: 90, width: 30, area: 2700, crest: 9.2, rel: 5.0,
             graves: 11, note: '莫角山西北角王陵，高出地表约 4–5 m，M12 出玉琮王、玉钺王' },
  jiangjiashan: { graves: 17 },
  yaoshan: {
    peak: 35.0, redTop: 34.8, distanceNE: 5000,
    outerEW: 24, outerNS: 18, area: 400,
    red: { e: 7.60, n: 5.90, w: 7.70, s: 6.20 },
    grey: { widthMin: 1.70, widthMax: 2.10, depthMin: 0.65, depthMax: 0.85 },
    graves: 13, note: '山顶削平筑方形覆斗状祭坛，红土台 / 回字形灰土围沟 / 黄褐斑土砾石面三重土色；坡面有石坎护坡',
  },
  huiguanshan: { peak: 22.0 },
  waterSystem: {
    dams: 11, extentEW: 11000, extentNS: 5500, area: 7.62e5, earthwork: 2.88e6,
    reservoirArea: 8.5e6, note: '11 条人工坝 + 山体 / 孤丘 / 天然溢洪道，影响范围 >100 km²',
  },
  highDam: {
    count: 6, crestMin: 25, crestMax: 40, crestTypicalMin: 30, crestTypicalMax: 35,
    relMin: 10, relMax: 15, lengthMin: 50, lengthMax: 200, thickness: 100,
    names: ['岗公岭', '老虎岭', '周家畈', '秋坞', '石坞', '蜜蜂弄'],
    note: '西北大遮山南麓谷口，东/西两组各封堵一个谷口；坝体高程约海拔 30–35 m，厚近 100 m',
  },
  lowDam: {
    count: 4, crest: 10.0, lengthMin: 35, lengthMax: 360,
    names: ['梧桐弄', '官山', '鲤鱼山', '狮子山'],
    note: '高坝南约 3.5–5.5 km 平原孤丘之间，坝顶高程约 10 m',
  },
  tangshan: {
    length: 5000, widthMin: 20, widthMax: 50, distanceNorth: 2000,
    northCrestMin: 15, northCrestMax: 20, southCrestMin: 12, southCrestMax: 15,
    channelBottomMin: 7, channelBottomMax: 8, doubleGapMin: 20, doubleGapMax: 30,
    note: '山前长堤（塘山），西段矩尺形单层坝、中段南北双层坝夹渠道、东段单坝',
  },
  craft: { grassMud: '坝体下部草裹淤泥堆筑、外覆纯黄土；草起加筋作用，类似现代草袋装土' },
};

/* 供 UI 高程面板 / 剖面图直接读取的核对表 */
export const SURVEY_TABLE = [
  ['城内地面', '3 – 5', '取 4.2'],
  ['湿地常年水位', '2 – 3', '取 2.6'],
  ['城墙顶（现存较好段）', '≈ 8 – 10', '取 9.0 / 相对 4.8'],
  ['莫角山台顶', '≈ 12 – 14', '取 12.0 / 高出稻田 9–15'],
  ['大莫角山台顶', '18', '取 18.0（全城制高点）'],
  ['反山王陵顶', '≈ 8 – 9', '取 9.2 / 高出地表 4–5'],
  ['瑶山山顶 / 红土台', '≈ 35 / 34.8', '取 35.0 / 34.8'],
  ['汇观山山顶', '≈ 22', '取 22.0'],
  ['谷口高坝坝顶', '25 – 40（典型 30 – 35）', '取 32.0 / 相对 10–15'],
  ['平原低坝坝顶', '≈ 10', '取 10.0'],
  ['塘山北坝 / 南坝顶', '15 – 20 / 12 – 15', '取 17.5 / 13.5'],
  ['塘山双坝渠底', '7 – 8', '取 7.6'],
  ['塘山双坝间距', '20 – 30', '取 26'],
  ['古河道宽 / 深', '10 – 50 / 2 – 4', '按段赋值'],
  ['水城门宽', '30 – 60（西墙 30 – 40）', '按门赋值'],
];

/* ================================================================== *
 * 2. 场景尺度与画质档位
 * ================================================================== */
export const WORLD = {
  unit: 1,
  extent: [12000, 10000],           // 流域总范围 X ±6000 / Z ±5000
  coreHalf: [1800, 1900],           // 内城 + 近郊高密度网格区
  city: { hx: 885, hz: 955, corner: 170 },
  waterY: SURVEY.waterLevel,
  channelY: 8.2,                    // 塘山双坝渠道水面
  uplandY: 26.0,                    // 谷口高坝上游山谷水库水面
  sunDefaultHour: 9.15,             // 江南湿地晨间柔光
  far: 16000,
};

export const QUALITY = {
  high:   { label: '高', dpr: 2.0, shadow: 3072, texScale: 1.00, aniso: 8,
            terrain: [420, 360], waterSeg: [224, 188], reed: 22000, grass: 20000,
            cobble: 7600, tree: 1.00, mist: 260, bloom: true, grade: true, detail: 1.00 },
  medium: { label: '中', dpr: 1.5, shadow: 2048, texScale: 0.50, aniso: 4,
            terrain: [300, 260], waterSeg: [160, 132], reed: 11000, grass: 9800,
            cobble: 4200, tree: 0.72, mist: 160, bloom: true, grade: true, detail: 0.78 },
  low:    { label: '低', dpr: 1.0, shadow: 1024, texScale: 0.25, aniso: 1,
            terrain: [210, 180], waterSeg: [96, 80], reed: 3400, grass: 3000,
            cobble: 1500, tree: 0.46, mist: 80, bloom: false, grade: false, detail: 0.56 },
};

/* ================================================================== *
 * 3. 确定性随机与可平铺噪声
 * ================================================================== */
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const R = mulberry32(53004300);
export const rr = (a, b) => a + (b - a) * R();
function h2(x, y, s) {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function vn(x, y, s, P) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const X0 = ((xi % P) + P) % P, Y0 = ((yi % P) + P) % P;
  const X1 = (X0 + 1) % P, Y1 = (Y0 + 1) % P;
  const a = h2(X0, Y0, s), b = h2(X1, Y0, s), c = h2(X0, Y1, s), d = h2(X1, Y1, s);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
export function fbm(x, y, s, oct = 4, P = 8) {
  let amp = 0.55, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * vn(x * f * P, y * f * P, s + i * 31, P * f);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return sum / norm;
}
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;

/* ================================================================== *
 * 4. 程序化 PBR 贴图集（颜色 / 法线 / 粗糙度 / alpha，全部本地生成）
 * ================================================================== */
function makeMaps(size, shade) {
  const n = size * size;
  const col = new Uint8Array(n * 4), nrm = new Uint8Array(n * 4), rgh = new Uint8Array(n * 4);
  const H = new Float32Array(n);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, o = shade(x / size, y / size, x, y, size);
    col[i * 4] = clamp(o[0], 0, 255); col[i * 4 + 1] = clamp(o[1], 0, 255);
    col[i * 4 + 2] = clamp(o[2], 0, 255); col[i * 4 + 3] = clamp((o[5] ?? 1) * 255, 0, 255);
    H[i] = o[3];
    const rv = clamp(o[4] * 255, 0, 255);
    rgh[i * 4] = rv; rgh[i * 4 + 1] = rv; rgh[i * 4 + 2] = rv; rgh[i * 4 + 3] = 255;
  }
  const strength = 2.4;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, o = i * 4;
    const l = H[y * size + ((x - 1 + size) % size)], r = H[y * size + ((x + 1) % size)];
    const t = H[((y - 1 + size) % size) * size + x], b = H[((y + 1) % size) * size + x];
    const nx = (l - r) * strength, ny = (t - b) * strength, nz = 1;
    const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
    nrm[o] = (nx * inv * 0.5 + 0.5) * 255;
    nrm[o + 1] = (ny * inv * 0.5 + 0.5) * 255;
    nrm[o + 2] = (nz * inv * 0.5 + 0.5) * 255; nrm[o + 3] = 255;
  }
  const tex = (data, srgb) => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8; t.needsUpdate = true;
    return t;
  };
  return { map: tex(col, true), normalMap: tex(nrm, false), roughnessMap: tex(rgh, false) };
}

const TEXDEF = {
  /* 夯土：水平夯层 + 夯窝 + 草根痕 */
  rammed: { size: 512, fn: (u, v) => {
    const g = fbm(u, v, 11, 4), f = fbm(u, v, 47, 3, 32);
    const layer = Math.abs(Math.sin((v * 19 + g * 2.6) * Math.PI));
    const seam = smooth(0.86, 0.99, 1 - layer) * 0.19;
    const tamp = smooth(0.62, 0.86, fbm(u * 3, v * 3, 71, 2)) * 0.12;
    const root = smooth(0.78, 0.96, fbm(u, v, 97, 3)) * 0.18;
    const base = 158 + g * 34 - seam * 72 - tamp * 28 + f * 8;
    return [base + root * 6, base * 0.86 - seam * 56 + root * 22, base * 0.62 - seam * 40 + root * 2,
      g * 0.42 + f * 0.3 - seam * 1.1, 0.92 + f * 0.08];
  } },
  /* 纯净黄土（城墙 / 坝壳） */
  yellowClay: { size: 256, fn: (u, v) => {
    const g = fbm(u, v, 131, 5), f = fbm(u, v, 137, 3, 32);
    const lam = Math.abs(Math.sin((v * 18 + g * 2) * Math.PI)) * 0.08;
    const base = 176 + g * 30 - lam * 90;
    return [base, base * 0.85 + f * 6, base * 0.61 + f * 4,
      g * 0.5 + f * 0.3 - lam * 0.7, 0.93 + f * 0.06];
  } },
  /* 草裹泥：深灰褐淤泥 + 交错草茎纤维，可见一坨坨草包 */
  grassMud: { size: 512, fn: (u, v) => {
    const g = fbm(u, v, 151, 4), f = fbm(u, v, 157, 3, 32);
    const bundle = Math.abs(Math.sin((u * 9 + v * 5 + g * 2) * Math.PI));
    const straw = Math.pow(Math.abs(Math.sin((u * 120 + v * 17 + g * 8) * Math.PI)), 12);
    const edge = smooth(0.80, 0.98, bundle) * 0.30;
    const base = 92 + g * 30 - edge * 44 + straw * 46;
    return [base + straw * 16, base * 0.94 + straw * 22, base * 0.74 + straw * 4,
      g * 0.45 + f * 0.32 - edge * 0.9 + straw * 0.7, 0.95 + f * 0.05];
  } },
  /* 青淤泥 / 水下淤泥：蓝灰、有机质斑、气孔 */
  blueSilt: { size: 256, fn: (u, v) => {
    const g = fbm(u, v, 173, 5), f = fbm(u, v, 179, 3, 32);
    const organic = smooth(0.58, 0.84, fbm(u, v, 181, 3));
    const pit = smooth(0.72, 0.94, fbm(u * 4, v * 4, 191, 2));
    const base = 66 + g * 26 - organic * 20 - pit * 18;
    return [base - 4, base + 2, base + 4, g * 0.55 + f * 0.35 - pit * 0.7, 0.97];
  } },
  /* 卵石护坡：圆润砾石镶嵌 */
  cobble: { size: 512, fn: (u, v) => {
    const g = fbm(u, v, 211, 4), f = fbm(u, v, 223, 3, 32);
    const cx = u * 22, cy = v * 22;
    const jx = cx - Math.floor(cx) - 0.5 + fbm(u, v, 227, 2, 16) * 0.22;
    const jy = cy - Math.floor(cy) - 0.5 + fbm(u, v, 229, 2, 16) * 0.22;
    const d = Math.hypot(jx, jy);
    const stone = smooth(0.30, 0.48, d);
    const tint = h2(Math.floor(cx), Math.floor(cy), 233);
    const base = 128 + tint * 52 + g * 26 - stone * 42;
    return [base, base * 0.97 - stone * 6, base * 0.90 - stone * 10,
      -stone * 1.4 + g * 0.3 + f * 0.18, 0.88 + f * 0.10];
  } },
  /* 块石 / 石坎：棱角块体 */
  stoneBlock: { size: 256, fn: (u, v) => {
    const g = fbm(u, v, 241, 4), f = fbm(u, v, 251, 3, 32);
    const rows = 9, cols = 6;
    const ry = v * rows, rx = u * cols + (Math.floor(ry) % 2) * 0.5;
    const joint = smooth(0.42, 0.5, Math.max(Math.abs((ry % 1) - 0.5), Math.abs((rx % 1) - 0.5)));
    const base = 138 + g * 34 - joint * 62;
    return [base, base * 1.01, base * 0.97, g * 0.5 + f * 0.3 - joint * 1.3, 0.9 + f * 0.08];
  } },
  /* 湿岸 / 滩涂：湿泥、龟裂与藻痕 */
  wetMud: { size: 256, fn: (u, v) => {
    const g = fbm(u, v, 263, 5), f = fbm(u, v, 269, 3, 32);
    const crack = smooth(0.88, 0.995, 1 - Math.abs(Math.sin((u * 8 + v * 7 + g * 4) * Math.PI)));
    const algae = smooth(0.56, 0.80, fbm(u, v, 271, 3)) * 0.35;
    const base = 96 + g * 32 - crack * 36 - algae * 26;
    return [base, base * 0.96 + algae * 16, base * 0.80 + algae * 6,
      g * 0.55 + f * 0.3 - crack * 0.9, 0.82 + f * 0.14];
  } },
  /* 湿地草甸 / 莎草：近中性亮底，让航拍色块由顶点色主导 */
  marsh: { size: 256, fn: (u, v) => {
    const g = fbm(u, v, 281, 5), f = fbm(u, v, 283, 3, 32);
    const blade = Math.abs(Math.sin((u * 46 + v * 13 + g * 6) * Math.PI));
    const wet = smooth(0.52, 0.80, fbm(u, v, 293, 3));
    const base = 214 + g * 30 + blade * 12 - wet * 10;
    return [base * 0.965, base, base * 0.925,
      g * 0.5 + f * 0.34 + blade * 0.3, 0.94 + f * 0.06];
  } },
  /* 稻田：田埂网格 + 稻茬 + 水面反光 */
  paddy: { size: 256, fn: (u, v) => {
    const g = fbm(u, v, 307, 4), f = fbm(u, v, 311, 3, 32);
    const gx = Math.abs((u * 6) % 1 - 0.5), gy = Math.abs((v * 6) % 1 - 0.5);
    const ridge = smooth(0.44, 0.49, Math.max(gx, gy));
    const stubble = Math.abs(Math.sin((u * 90 + v * 70) * Math.PI)) * 0.14;
    const base = 96 + g * 36 + stubble * 60 + ridge * 34;
    return [base * 0.76, base, base * 0.50 + ridge * 8, g * 0.4 + f * 0.3 + ridge * 0.6, 0.80 + f * 0.16];
  } },
  /* 沙土广场：砂砾与粘土分层夯筑 */
  sand: { size: 256, fn: (u, v) => {
    const g = fbm(u, v, 317, 5), f = fbm(u, v, 331, 3, 32);
    const grit = smooth(0.62, 0.86, fbm(u * 8, v * 8, 337, 2));
    const base = 168 + g * 30 - grit * 34;
    return [base, base * 0.94, base * 0.78, g * 0.42 + f * 0.36 + grit * 0.4, 0.94 + f * 0.06];
  } },
  /* 瑶山红土台 */
  redClay: { size: 256, fn: (u, v) => {
    const g = fbm(u, v, 347, 5), f = fbm(u, v, 349, 3, 32);
    const base = 138 + g * 34;
    return [base, base * 0.56, base * 0.40, g * 0.55 + f * 0.3, 0.95];
  } },
  /* 灰土围沟 */
  greySoil: { size: 256, fn: (u, v) => {
    const g = fbm(u, v, 353, 5), f = fbm(u, v, 359, 3, 32);
    const base = 108 + g * 34;
    return [base, base * 1.01, base * 0.99, g * 0.55 + f * 0.32, 0.96];
  } },
  /* 砾石台面 */
  gravel: { size: 256, fn: (u, v) => {
    const g = fbm(u, v, 367, 4), f = fbm(u, v, 373, 3, 32);
    const speck = smooth(0.60, 0.84, fbm(u * 14, v * 14, 379, 2));
    const base = 146 + g * 30 - speck * 40;
    return [base, base * 0.98, base * 0.91, g * 0.4 + f * 0.3 + speck * 0.9, 0.93 + f * 0.06];
  } },
  /* 茅草顶 */
  thatch: { size: 256, fn: (u, v) => {
    const g = fbm(u, v, 383, 4), f = fbm(u, v, 389, 3, 32);
    const straw = Math.abs(Math.sin((u * 74 + g * 5) * Math.PI));
    const course = smooth(0.86, 0.99, 1 - Math.abs(Math.sin(v * 11 * Math.PI)));
    const base = 132 + g * 30 + straw * 26 - course * 36;
    return [base, base * 0.84, base * 0.52, g * 0.4 + f * 0.28 + straw * 0.5 - course * 0.7, 0.93];
  } },
  /* 木材 / 独木舟 */
  wood: { size: 256, fn: (u, v) => {
    const grain = Math.abs(Math.sin((u * 22 + fbm(u, v, 397, 3) * 5) * Math.PI));
    const g = fbm(u, v, 401, 3);
    return [98 + grain * 22 + g * 12, 66 + grain * 16 + g * 8, 42 + grain * 10 + g * 6,
      grain * 0.45 + g * 0.3, 0.72 + g * 0.16];
  } },
  /* 树皮 */
  bark: { size: 256, fn: (u, v) => {
    const g = fbm(u, v, 409, 4);
    const ridge = Math.abs(Math.sin((u * 19 + g * 6) * Math.PI));
    const crack = smooth(0.68, 0.96, ridge);
    const b = 84 + g * 32 - crack * 32;
    return [b, b * 0.86, b * 0.70, ridge * 0.6 + g * 0.3 - crack * 0.5, 0.93];
  } },
  /* 山体林被（远景） */
  hill: { size: 256, fn: (u, v) => {
    const g = fbm(u, v, 419, 5), f = fbm(u, v, 421, 3, 32);
    const canopy = smooth(0.42, 0.72, fbm(u, v, 431, 4));
    const base = 168 + g * 52 + canopy * 30;
    return [base * 0.90, base, base * 0.86, g * 0.5 + f * 0.3 + canopy * 0.5, 0.95];
  } },
  /* 芦苇 / 菰叶：带 alpha 的细长叶簇 */
  reed: { size: 256, fn: (u, v) => {
    const g = fbm(u, v, 439, 3);
    const ribs = Math.abs(Math.sin(u * Math.PI * 9));
    const leaf = 1 - smooth(0.30, 0.50, Math.abs(u - 0.5) - v * 0.06);
    const tip = 1 - smooth(0.86, 1.0, v);
    const a = clamp(leaf * tip * (0.72 + ribs * 0.28), 0, 1);
    return [104 + g * 56, 132 + g * 62, 64 + g * 34, g * 0.4 + ribs * 0.3, 0.9, a];
  } },
  /* 阔叶 / 荷叶：带 alpha */
  leaf: { size: 256, fn: (u, v) => {
    const g = fbm(u, v, 443, 4);
    const d = Math.hypot((u - 0.5) * 1.06, (v - 0.5) * 1.06);
    const notch = (v > 0.5 && u > 0.46 && u < 0.54) ? 0 : 1;
    const a = clamp((1 - smooth(0.40, 0.49, d)) * notch, 0, 1);
    const vein = Math.abs(Math.sin(Math.atan2(v - 0.5, u - 0.5) * 9)) * 0.12;
    return [78 + g * 52, 122 + g * 60, 58 + g * 30, g * 0.45 + vein, 0.86, a];
  } },
};

/* 坝体剖面地层图（底部青淤泥 → 草裹泥坝芯 → 黄土外壳 → 草被），v 对应高程 */
function strataMaps() {
  const w = 256, h = 512;
  const col = new Uint8Array(w * h * 4), nrm = new Uint8Array(w * h * 4), rgh = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h;                 // v=0 底，v=1 顶
    const g = fbm(u * 3, v * 3, 457, 4), f = fbm(u * 9, v * 9, 461, 3, 32);
    let r, gg, b, ht;
    if (v < 0.16) {                             // 青淤泥 / 砂砾基础
      const base = 68 + g * 24;
      r = base - 6; gg = base + 2; b = base + 6; ht = g * 0.5 - 0.2;
    } else if (v < 0.76) {                      // 草裹泥：一坨坨草包 + 草茎
      const bundle = Math.abs(Math.sin((u * 11 + v * 44 + g * 2) * Math.PI));
      const seam = smooth(0.80, 0.98, bundle);
      const straw = Math.pow(Math.abs(Math.sin((u * 130 + v * 24 + g * 7) * Math.PI)), 14);
      const base = 88 + g * 26 - seam * 34 + straw * 40;
      r = base + straw * 12; gg = base * 0.92 + straw * 18; b = base * 0.72;
      ht = g * 0.4 + f * 0.3 - seam * 0.8 + straw * 0.6;
    } else {                                    // 纯黄土外壳 + 夯层
      const lam = smooth(0.86, 0.99, 1 - Math.abs(Math.sin(v * 110 * Math.PI)));
      const base = 168 + g * 26 - lam * 46;
      r = base; gg = base * 0.85; b = base * 0.60; ht = g * 0.45 + f * 0.25 - lam * 0.8;
    }
    const edge = 1 - smooth(0.90, 1.0, v);     // 顶部草被
    r = r * edge + 92 * (1 - edge); gg = gg * edge + 112 * (1 - edge); b = b * edge + 60 * (1 - edge);
    const i = y * w + x, o = i * 4;
    col[o] = clamp(r, 0, 255); col[o + 1] = clamp(gg, 0, 255); col[o + 2] = clamp(b, 0, 255); col[o + 3] = 255;
    nrm[o] = 128; nrm[o + 1] = 128; nrm[o + 2] = 255; nrm[o + 3] = 255;
    const rv = clamp(0.90 + f * 0.09, 0, 1) * 255;
    rgh[o] = rv; rgh[o + 1] = rv; rgh[o + 2] = rv; rgh[o + 3] = 255;
  }
  const mk = (data, srgb) => {
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true; if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4; t.needsUpdate = true; return t;
  };
  return { map: mk(col, true), normalMap: mk(nrm, false), roughnessMap: mk(rgh, false) };
}

/* 水汽精灵：径向柔边 alpha */
function mistMaps() {
  const s = 128, col = new Uint8Array(s * s * 4), nrm = new Uint8Array(s * s * 4), rgh = new Uint8Array(s * s * 4);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const u = x / s - 0.5, v = y / s - 0.5;
    const d = Math.hypot(u, v) * 2;
    const n = fbm(x / s * 3, y / s * 3, 467, 3);
    const a = clamp((1 - smooth(0.34, 1.0, d)) * (0.45 + n * 0.55), 0, 1) * 0.62;
    const i = (y * s + x) * 4;
    col[i] = 226; col[i + 1] = 232; col[i + 2] = 228; col[i + 3] = a * 255;
    nrm[i] = 128; nrm[i + 1] = 128; nrm[i + 2] = 255; nrm[i + 3] = 255;
    rgh[i] = rgh[i + 1] = rgh[i + 2] = 245; rgh[i + 3] = 255;
  }
  const mk = data => {
    const t = new THREE.DataTexture(data, s, s, THREE.RGBAFormat);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true; t.needsUpdate = true; return t;
  };
  return { map: mk(col), normalMap: mk(nrm), roughnessMap: mk(rgh) };
}

export function buildTextures(onProgress, texScale = 1) {
  const out = {}, keys = Object.keys(TEXDEF);
  keys.forEach((k, i) => {
    const def = TEXDEF[k];
    const size = Math.max(64, Math.pow(2, Math.round(Math.log2(def.size * texScale))));
    out[k] = makeMaps(size, def.fn);
    if (onProgress) onProgress((i + 1) / (keys.length + 2), k);
  });
  out.strata = strataMaps();
  out.mist = mistMaps();
  if (onProgress) onProgress(1, '剖面地层 / 水汽');
  return out;
}

/* ================================================================== *
 * 5. 材质库
 * ================================================================== */
export function buildMaterials(T) {
  const std = (name, key, o = {}) => {
    const t = T[key];
    const m = new THREE.MeshStandardMaterial({
      map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap,
      normalScale: new THREE.Vector2(o.ns ?? 0.55, o.ns ?? 0.55),
      roughness: o.roughness ?? 0.92, metalness: o.metalness ?? 0,
      color: o.color ?? 0xffffff, side: o.side ?? THREE.FrontSide,
      vertexColors: o.vertexColors ?? false, flatShading: o.flat ?? false,
      alphaTest: o.alphaTest ?? 0, transparent: o.transparent ?? false,
      opacity: o.opacity ?? 1, depthWrite: o.depthWrite ?? true,
    });
    m.name = name; return m;
  };
  const M = {
    ground:     std('ground', 'marsh', { roughness: 1.0, ns: 0.32, vertexColors: true }),
    rammed:     std('rammed', 'rammed', { roughness: 0.96, ns: 0.72, vertexColors: true, side: THREE.DoubleSide }),
    rammedPlain:std('rammedPlain', 'rammed', { roughness: 0.96, ns: 0.72, side: THREE.DoubleSide }),
    yellowClay: std('yellowClay', 'yellowClay', { roughness: 0.95, ns: 0.48, vertexColors: true, side: THREE.DoubleSide }),
    grassMud:   std('grassMud', 'grassMud', { roughness: 0.97, ns: 0.82, side: THREE.DoubleSide }),
    blueSilt:   std('blueSilt', 'blueSilt', { roughness: 0.98, ns: 0.6 }),
    cobble:     std('cobble', 'cobble', { roughness: 0.9, ns: 0.9 }),
    stoneBlock: std('stoneBlock', 'stoneBlock', { roughness: 0.92, ns: 0.72 }),
    wetMud:     std('wetMud', 'wetMud', { roughness: 0.86, ns: 0.6 }),
    paddy:      std('paddy', 'paddy', { roughness: 0.82, ns: 0.34 }),
    sand:       std('sand', 'sand', { roughness: 0.96, ns: 0.45 }),
    redClay:    std('redClay', 'redClay', { roughness: 0.96, ns: 0.5 }),
    greySoil:   std('greySoil', 'greySoil', { roughness: 0.97, ns: 0.45 }),
    gravel:     std('gravel', 'gravel', { roughness: 0.94, ns: 0.7 }),
    thatch:     std('thatch', 'thatch', { roughness: 0.94, ns: 0.62, side: THREE.DoubleSide }),
    wood:       std('wood', 'wood', { roughness: 0.74, ns: 0.4 }),
    bark:       std('bark', 'bark', { roughness: 0.95, ns: 0.68 }),
    hill:       std('hill', 'hill', { roughness: 0.96, ns: 0.38 }),
    strata:     std('strata', 'strata', { roughness: 0.96, ns: 0.18, side: THREE.DoubleSide }),
    reed:       std('reed', 'reed', { roughness: 0.9, ns: 0.2, side: THREE.DoubleSide, alphaTest: 0.42 }),
    leaf:       std('leaf', 'leaf', { roughness: 0.86, ns: 0.2, side: THREE.DoubleSide, alphaTest: 0.42 }),
    canopy:     std('canopy', 'hill', { roughness: 0.96, ns: 0.3 }),
    mist:       new THREE.MeshBasicMaterial({ map: T.mist.map, transparent: true, depthWrite: false,
                    opacity: 0.62, side: THREE.DoubleSide, fog: false, blending: THREE.NormalBlending }),
  };
  M.mist.name = 'mist';
  const solid = (name, color, roughness = 0.85, metalness = 0) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness }); m.name = name; return m;
  };
  M.darkWood = solid('darkWood', 0x3b2b1e, 0.78);
  M.rope = solid('rope', 0x9a8a62, 0.96);
  M.jade = solid('jade', 0x7f9d86, 0.42, 0.06);
  M.stoneDark = solid('stoneDark', 0x7d8279, 0.92);
  M.meadow = solid('meadow', 0x63794a, 0.98);
  M.foam = new THREE.MeshBasicMaterial({ color: 0xdce8e2, transparent: true, opacity: 0.34,
    depthWrite: false, side: THREE.DoubleSide });
  M.foam.name = 'foam';
  return M;
}

/* ================================================================== *
 * 6. 几何工具
 * ================================================================== */
export function boxGeo(w, h, d, uvPerMeter = 0.25) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv');
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, uv.getX(k) * dims[f][0] * uvPerMeter, uv.getY(k) * dims[f][1] * uvPerMeter);
  }
  uv.needsUpdate = true; return g;
}
export function transform(pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(pos[0], pos[1], pos[2]),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])),
    new THREE.Vector3(scale[0], scale[1], scale[2]));
  return m;
}
export function tube(points, radius, seg = 24, radial = 6) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  return new THREE.TubeGeometry(curve, seg, radius, radial, false);
}
export function extrudePolygon(points, depth) {
  const s = new THREE.Shape();
  points.forEach((p, i) => i === 0 ? s.moveTo(p[0], p[1]) : s.lineTo(p[0], p[1]));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 8, steps: 1 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** 圆角矩形路径（顺时针），用于城墙、城河、内外环水网与乘船航线 */
export function roundedRectPath(cx, cz, hx, hz, r, step = 12) {
  r = Math.min(r, hx, hz);
  const pts = [];
  const push = (x, z) => pts.push([cx + x, cz + z]);
  const line = (x1, z1, x2, z2) => {
    const len = Math.hypot(x2 - x1, z2 - z1), n = Math.max(1, Math.round(len / step));
    for (let i = 0; i < n; i++) push(x1 + (x2 - x1) * i / n, z1 + (z2 - z1) * i / n);
  };
  const arc = (ox, oz, a0, a1) => {
    const n = Math.max(3, Math.round(Math.abs(a1 - a0) * r / step));
    for (let i = 0; i < n; i++) {
      const a = a0 + (a1 - a0) * i / n;
      push(ox + Math.cos(a) * r, oz + Math.sin(a) * r);
    }
  };
  line(-(hx - r), hz, hx - r, hz);
  arc(hx - r, hz - r, Math.PI / 2, 0);
  line(hx, hz - r, hx, -(hz - r));
  arc(hx - r, -(hz - r), 0, -Math.PI / 2);
  line(hx - r, -hz, -(hx - r), -hz);
  arc(-(hx - r), -(hz - r), -Math.PI / 2, -Math.PI);
  line(-hx, -(hz - r), -hx, hz - r);
  arc(-(hx - r), hz - r, Math.PI, Math.PI / 2);
  return pts;
}

/** 覆斗状（下大上小）矩形夯土台基：侧面按夯层分带，顶面平 */
export function frustumGeo(bx, bz, tx, tz, y0, y1, opts = {}) {
  const layers = opts.layers ?? Math.max(2, Math.round((y1 - y0) / 0.45));
  const pos = [], nor = [], uv = [], col = [], idx = [];
  const b = [[-bx / 2, -bz / 2], [bx / 2, -bz / 2], [bx / 2, bz / 2], [-bx / 2, bz / 2]];
  const t = [[-tx / 2, -tz / 2], [tx / 2, -tz / 2], [tx / 2, tz / 2], [-tx / 2, tz / 2]];
  const push = (x, y, z, nx, ny, nz, u, v, shade) => {
    pos.push(x, y, z); nor.push(nx, ny, nz); uv.push(u, v);
    col.push(shade[0], shade[1], shade[2]);
    return pos.length / 3 - 1;
  };
  for (let f = 0; f < 4; f++) {
    const f2 = (f + 1) % 4;
    const b1 = b[f], b2 = b[f2], t1 = t[f], t2 = t[f2];
    const ex = b2[0] - b1[0], ez = b2[1] - b1[1];
    const len = Math.hypot(ex, ez);
    // 外法线（指向台基外侧）
    let nx = ez / len, nz = -ex / len;
    if (nx * (b1[0] + b2[0]) + nz * (b1[1] + b2[1]) < 0) { nx = -nx; nz = -nz; }
    const run = Math.hypot((t1[0] - b1[0]), (t1[1] - b1[1]));
    const ny = run > 0 ? (y1 - y0) / Math.hypot(run, y1 - y0) : 1;
    const sl = Math.hypot(nx, ny, nz);
    const N = [nx / sl * Math.cos(Math.atan2(run, y1 - y0)), (y1 - y0 > 0 ? run / Math.hypot(run, y1 - y0) : 0), nz / sl];
    const nl = Math.hypot(N[0], N[1], N[2]) || 1;
    for (let k = 0; k <= layers; k++) {
      const q = k / layers, y = y0 + (y1 - y0) * q;
      const shadeK = 0.88 + 0.11 * (0.5 + 0.5 * Math.sin(q * layers * Math.PI * 1.7));
      const shade = [shadeK, shadeK * 0.985, shadeK * 0.955];
      const p1x = b1[0] + (t1[0] - b1[0]) * q, p1z = b1[1] + (t1[1] - b1[1]) * q;
      const p2x = b2[0] + (t2[0] - b2[0]) * q, p2z = b2[1] + (t2[1] - b2[1]) * q;
      push(p1x, y, p1z, N[0] / nl, N[1] / nl, N[2] / nl, 0, y * 0.55, shade);
      push(p2x, y, p2z, N[0] / nl, N[1] / nl, N[2] / nl, len * 0.28, y * 0.55, shade);
    }
    for (let k = 0; k < layers; k++) {
      const a = (f * (layers + 1) + k) * 2, c = a + 2;
      idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  // 顶面
  const baseIdx = pos.length / 3;
  const shadeTop = opts.topShade ?? [0.93, 0.95, 0.86];
  const uvS = 0.22;
  [[-tx / 2, -tz / 2], [tx / 2, -tz / 2], [tx / 2, tz / 2], [-tx / 2, tz / 2]].forEach(p => {
    push(p[0], y1, p[1], 0, 1, 0, p[0] * uvS, p[1] * uvS, shadeTop);
  });
  idx.push(baseIdx, baseIdx + 2, baseIdx + 1, baseIdx, baseIdx + 3, baseIdx + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/** 沿 2D 路径扫掠横断面。
 *  path: [[x,z]...]；profile: [[u,y]...]（u 为横向偏移，按左侧法线方向）
 *  返回 { surface, caps:[start,end] }，caps 的 uv 由 capUV(u,y) 决定。 */
export function sweepProfile(path, profile, opts = {}) {
  const n = path.length, m = profile.length;
  const pos = [], nor = [], uv = [], col = [], idx = [];
  const dist = [0];
  for (let i = 1; i < n; i++) dist.push(dist[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  const proLen = [0];
  for (let j = 1; j < m; j++) proLen.push(proLen[j - 1] + Math.hypot(profile[j][0] - profile[j - 1][0], profile[j][1] - profile[j - 1][1]));
  const colorFn = opts.colorFn || (() => [1, 1, 1]);
  for (let i = 0; i < n; i++) {
    const p0 = path[Math.max(0, i - 1)], p1 = path[Math.min(n - 1, i + 1)];
    let tx = p1[0] - p0[0], tz = p1[1] - p0[1];
    const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const nx = -tz, nz = tx;                    // 左法线
    for (let j = 0; j < m; j++) {
      const [u, y] = profile[j];
      const c = colorFn(j, u, y, i, dist[i]);
      // 面法线由断面切向 (du,dy) 与路径切向叉乘近似
      const pPrev = profile[Math.max(0, j - 1)], pNext = profile[Math.min(m - 1, j + 1)];
      const du = pNext[0] - pPrev[0], dy = pNext[1] - pPrev[1];
      let vnx = -dy * nx, vny = du, vnz = -dy * nz;
      const vl = Math.hypot(vnx, vny, vnz) || 1;
      // 统一朝外：依据断面左右侧判定
      if (j > 0 && j < m - 1 && u < 0 && vny < 0) { vnx = -vnx; vny = -vny; vnz = -vnz; }
      pos.push(path[i][0] + nx * u, y, path[i][1] + nz * u);
      nor.push(vnx / vl, vny / vl, vnz / vl);
      uv.push(dist[i] * (opts.uvU ?? 0.16), proLen[j] * (opts.uvV ?? 0.16));
      col.push(c[0], c[1], c[2]);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < m - 1; j++) {
    const a = i * m + j, b = a + m;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const surface = new THREE.BufferGeometry();
  surface.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  surface.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  surface.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  surface.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  surface.setIndex(idx);
  const capGeos = [];
  const capUV = opts.capUV || ((u, y) => [u * 0.10, y * 0.10]);
  for (const end of [0, n - 1]) {
    const p0 = path[Math.max(0, end - 1)], p1 = path[Math.min(n - 1, end + 1)];
    let tx = p1[0] - p0[0], tz = p1[1] - p0[1];
    const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const nx = -tz, nz = tx;
    const cp = [], cn = [], cu = [], ci = [];
    // 扇形三角化（断面凸）
    profile.forEach(([u, y]) => {
      cp.push(path[end][0] + nx * u, y, path[end][1] + nz * u);
      cn.push(end === 0 ? -tx : tx, 0, end === 0 ? -tz : tz);
      const q = capUV(u, y); cu.push(q[0], q[1]);
    });
    for (let j = 1; j < m - 1; j++) ci.push(0, j, j + 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(cn, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(cu, 2));
    g.setIndex(ci);
    capGeos.push(g);
  }
  return { surface, caps: capGeos };
}

/** 放置一个几何到合批器 */
export function put(B, geo, mat, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], opts = {}) {
  B.add(geo, mat, transform(pos, rot, scale), opts);
}

/* ================================================================== *
 * 7. 静态几何合批：材质 + 空间格
 * ================================================================== */
function normalizeGeo(g) {
  const src = g.index ? g.toNonIndexed() : g.clone();
  const out = new THREE.BufferGeometry();
  const p = src.getAttribute('position');
  out.setAttribute('position', p.clone());
  out.setAttribute('normal', src.getAttribute('normal') ? src.getAttribute('normal').clone()
    : new THREE.Float32BufferAttribute(new Float32Array(p.count * 3), 3));
  const uv = src.getAttribute('uv');
  out.setAttribute('uv', uv ? uv.clone() : new THREE.Float32BufferAttribute(new Float32Array(p.count * 2), 2));
  /* 统一携带 color 属性，保证同材质合批时属性集合一致 */
  if (src.getAttribute('color')) out.setAttribute('color', src.getAttribute('color').clone());
  else {
    const white = new Float32Array(p.count * 3).fill(1);
    out.setAttribute('color', new THREE.Float32BufferAttribute(white, 3));
  }
  if (src !== g) src.dispose();
  return out;
}
export class Batch {
  constructor(zone = 64) { this.groups = new Map(); this.zone = zone; }
  add(geo, mat, matrix, opts = {}) {
    if (!geo || !geo.getAttribute('position')) return;
    const g = normalizeGeo(geo);
    g.applyMatrix4(matrix);
    const e = matrix.elements;
    const zx = Math.floor(e[12] / this.zone), zz = Math.floor(e[14] / this.zone);
    const key = (opts.noZone ? 'all' : `${zx}_${zz}`) + '|' + mat.name;
    if (!this.groups.has(key)) this.groups.set(key, { mat, list: [], noShadow: false });
    const grp = this.groups.get(key);
    grp.list.push(g);
    if (opts.noShadow) grp.noShadow = true;
    if (opts.dispose !== false && geo.dispose) geo.dispose();
  }
  build(parent) {
    let meshes = 0, tris = 0;
    this.groups.forEach(grp => {
      if (!grp.list.length) return;
      const merged = grp.list.length === 1 ? grp.list[0] : mergeGeometries(grp.list, false);
      if (!merged) return;
      const mesh = new THREE.Mesh(merged, grp.mat);
      mesh.castShadow = !grp.noShadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.name = 'batch_' + grp.mat.name;
      merged.computeBoundingSphere();
      parent.add(mesh);
      meshes++; tris += merged.getAttribute('position').count / 3;
      if (grp.list.length > 1) grp.list.forEach(g => g.dispose());
    });
    this.groups.clear();
    return { meshes, tris };
  }
}
