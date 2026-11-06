/* 圆明园西洋楼 · 基础层：尺度配置、程序化噪声纹理、材质库、几何批处理 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ------------------------------------------------------------------ *
 * 1. 世界尺度与配置
 * ------------------------------------------------------------------ */
export const WORLD = {
  // 1 场景单位 = 1 米；+X 向东，-Z 向北，+Y 向上
  unit: 1,
  core: { minX: -165, maxX: 165, minZ: -95, maxZ: 112 }, // 高精度重建核心区 330m × 207m
  bounds: { minX: -240, maxX: 240, minZ: -180, maxZ: 190 }, // 含远景林带/山体的可视化边界
  groundSize: [560, 440],
  lakeY: -0.62,
  sunDefaultHour: 16.4,
};

export const QUALITY = {
  high:   { label: '高', dpr: 2.0, shadow: 4096, grass: 9000, trees: 1.0,  bloom: true,  grade: true,  waterSeg: 64, aniso: 8, texScale: 1,    detailDist: 175, fadeFar: 145 },
  medium: { label: '中', dpr: 1.5, shadow: 2048, grass: 4200, trees: 0.72, bloom: true,  grade: true,  waterSeg: 40, aniso: 4, texScale: 0.5,  detailDist: 130, fadeFar: 110 },
  low:    { label: '低', dpr: 1.0, shadow: 1024, grass: 900,  trees: 0.45, bloom: false, grade: false, waterSeg: 24, aniso: 1, texScale: 0.25, detailDist: 95,  fadeFar: 80 },
};

export const POIS = [
  { id: 'overview', name: '全景鸟瞰', pos: [86, 21, 106], target: [26, 7, 2], desc: '自东南方向眺望西洋楼景区：右侧为大水法石龛与远瀛观，左侧为海晏堂与生肖喷水钟，南侧园湖与垂柳环绕。' },
  { id: 'dashuifa', name: '大水法', pos: [56, 7.5, 48], target: [40, 7, -8], desc: '西洋楼最大的一组喷泉。石龛式巴洛克屏风、椭圆水池、石狮吐水与前方观水法宝座构成南北轴线。' },
  { id: 'haiyantang', name: '海晏堂', pos: [-64, 13, 72], target: [-72, 7, 6], desc: '西洋楼中体量最大的建筑，正面十一间，汉白玉番花柱、粉红灰墙与孔雀绿琉璃瓦顶；前设十二生肖喷水钟。' },
  { id: 'zodiac', name: '生肖喷水钟', pos: [-55, 5, 60], target: [-62, 2.5, 30], desc: '十二尊兽首铜像分列扇形石阶两侧，按时辰轮流喷水，正午齐喷，是以水力驱动的报时装置。' },
  { id: 'yuanyingguan', name: '远瀛观', pos: [78, 11, -14], target: [40, 6, -34], desc: '坐落于高台之上的汉白玉建筑，三座巨型拱门与精雕柱础为今日遗址中最具辨识度的遗存。' },
  { id: 'guanshuifa', name: '观水法', pos: [12, 5, 74], target: [40, 4, 34], desc: '皇帝观赏大水法喷泉的宝座，后列五扇西洋石屏风，雕刻军阵、甲胄与西洋纹样。' },
  { id: 'maze', name: '黄花阵', pos: [-152, 24, 44], target: [-152, 1, 0], desc: '仿欧洲迷宫的砖砌矮墙花园，中央设八角亭，中秋时宫女持莲花灯竞走其中。' },
  { id: 'lake', name: '园湖夕照', pos: [-6, 4, 132], target: [22, 2, 62], desc: '园内水系以自然式湖岸、垂柳、荷丛与石桥衔接建筑群，呼应圆明园「因水成景」的造园逻辑。' },
];

export const HOTSPOTS = [
  { name: '大水法石龛', pos: [40, 9, -10], desc: '残存的巴洛克石龛屏风，中央大拱券与贝壳形壁龛、卷草浮雕仍可辨认。' },
  { name: '大水法喷池', pos: [40, 2, 12], desc: '椭圆石砌水池，中央原置铜鹿与猎犬群像，四周石狮口吐水帘。' },
  { name: '远瀛观', pos: [40, 11, -30], desc: '汉白玉三拱门，台上原有重檐琉璃顶，1860 年后仅余石构。' },
  { name: '观水法石屏风', pos: [40, 5, 36], desc: '五扇石屏雕刻西洋军阵图纹，是中西合璧装饰的珍贵实例。' },
  { name: '海晏堂', pos: [-72, 11, 0], desc: '面阔十一间，正门居中，左右叠落石跑梯环抱中央喷水池。' },
  { name: '十二生肖兽首', pos: [-64, 3, 30], desc: '铸铜兽首人身像，依次代表子鼠至亥猪，每时辰喷水报时。' },
  { name: '蓄水楼（锡海）', pos: [-72, 9, -26], desc: '工字型蓄水楼，内置锡海与轧水机，为海晏堂与大水法喷泉供水。' },
  { name: '谐奇趣', pos: [-138, 12, 6], desc: '西洋楼最早建成的三层楼，南北各有海棠式、菊花式喷水池。' },
  { name: '方外观', pos: [-118, 9, -40], desc: '二层大理石贴面建筑，蓝色琉璃瓦四坡顶，后为容妃礼拜之所。' },
  { name: '黄花阵', pos: [-152, 3, 0], desc: '又称万花阵，砖砌矮墙构成的欧式迷宫。' },
];

/* ------------------------------------------------------------------ *
 * 2. 确定性随机与可平铺噪声
 * ------------------------------------------------------------------ */
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export let R = mulberry32(18601018);
export function resetWorldSeed(seed = 18601018) { R = mulberry32(seed); }
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
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/* ------------------------------------------------------------------ *
 * 3. 程序化纹理（颜色 + 法线 + 粗糙度，全部离线生成，无外部贴图）
 * ------------------------------------------------------------------ */
function makeMaps(size, shade) {
  const n = size * size;
  const col = new Uint8Array(n * 4);
  const nrm = new Uint8Array(n * 4);
  const rgh = new Uint8Array(n * 4);
  const H = new Float32Array(n);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const o = shade(x / size, y / size, x, y, size);
      col[i * 4] = o[0]; col[i * 4 + 1] = o[1]; col[i * 4 + 2] = o[2]; col[i * 4 + 3] = 255;
      H[i] = o[3];
      const rv = clamp(o[4] * 255, 0, 255);
      rgh[i * 4] = rv; rgh[i * 4 + 1] = rv; rgh[i * 4 + 2] = rv; rgh[i * 4 + 3] = 255;
    }
  }
  const strength = 2.2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x, o = i * 4;
      const l = H[y * size + ((x - 1 + size) % size)], r = H[y * size + ((x + 1) % size)];
      const t = H[((y - 1 + size) % size) * size + x], b = H[((y + 1) % size) * size + x];
      const nx = (l - r) * strength, ny = (t - b) * strength, nz = 1;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nrm[o] = (nx * inv * 0.5 + 0.5) * 255;
      nrm[o + 1] = (ny * inv * 0.5 + 0.5) * 255;
      nrm[o + 2] = (nz * inv * 0.5 + 0.5) * 255;
      nrm[o + 3] = 255;
    }
  }
  const tex = (data, srgb) => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  return { map: tex(col, true), normalMap: tex(nrm, false), roughnessMap: tex(rgh, false) };
}

const TEXDEF = {
  stone: { size: 512, rep: [1, 1], fn: (u, v, x, y, S) => {
    const g = fbm(u, v, 11, 5), fine = fbm(u, v, 47, 3, 32), stain = fbm(u * 1.7, v * 0.35, 71, 3);
    const vein = Math.abs(Math.sin((u * 13 + v * 6 + g * 5.5) * Math.PI)) ;
    const vline = smooth(0.82, 0.99, 1 - vein) * 0.16;
    const moss = smooth(0.63, 0.82, fbm(u, v, 97, 3)) * 0.42;
    const pit = smooth(0.74, 0.9, fine) * 0.25;
    const base = 188 + g * 30 - vline * 120 - stain * 26 - pit * 60;
    return [clamp(base + moss * -18, 0, 255), clamp(base * 0.985 + moss * 16 - vline * 100, 0, 255),
      clamp(base * 0.93 + moss * -6 - vline * 80, 0, 255),
      g * 0.55 + fine * 0.3 - vline * 1.2 - pit * 0.8,
      0.72 + fine * 0.22 + moss * 0.1];
  } },
  marble: { size: 512, rep: [1, 1], fn: (u, v) => {
    const g = fbm(u, v, 23, 4), warp = fbm(u, v, 61, 3);
    const vein = Math.pow(1 - Math.abs(Math.sin((u * 6.2 + v * 3.1 + warp * 3.4) * Math.PI)), 9);
    const fine = fbm(u, v, 89, 3, 32);
    const base = 218 + g * 20 - vein * 42;
    return [base, base * 0.99 - vein * 30, base * 0.955 - vein * 22,
      g * 0.35 + fine * 0.25 - vein * 0.5, 0.38 + fine * 0.2 + vein * 0.2];
  } },
  plaster: { size: 512, rep: [1, 1], fn: (u, v) => {
    const g = fbm(u, v, 31, 4), fine = fbm(u, v, 113, 3, 32), dirt = fbm(u, v * 0.4, 137, 3);
    const crack = smooth(0.87, 0.98, 1 - Math.abs(Math.sin((u * 9 + v * 11 + g * 6) * Math.PI))) * 0.35;
    const b = 1 - dirt * 0.22 - crack * 0.3;
    return [206 * b + g * 12, 166 * b + g * 12, 154 * b + g * 10,
      g * 0.5 + fine * 0.35 - crack, 0.78 + fine * 0.15];
  } },
  brick: { size: 512, rep: [1, 1], fn: (u, v, x, y) => {
    const rows = 12, cols = 5;
    const ry = v * rows, rx = u * cols + (Math.floor(ry) % 2) * 0.5;
    const my = Math.abs((ry % 1) - 0.5), mx = Math.abs((rx % 1) - 0.5);
    const joint = smooth(0.42, 0.5, Math.max(my, mx));
    const g = fbm(u, v, 151, 4), fine = fbm(u, v, 179, 3, 32);
    const k = 1 - joint * 0.55;
    return [(158 + g * 26) * k, (104 + g * 20) * k, (88 + g * 18) * k,
      -joint * 0.85 + g * 0.35 + fine * 0.22, 0.78 + fine * 0.16 + joint * 0.1];
  } },
  graybrick: { size: 512, rep: [1, 1], fn: (u, v) => {
    const rows = 14, cols = 6;
    const ry = v * rows, rx = u * cols + (Math.floor(ry) % 2) * 0.5;
    const joint = smooth(0.40, 0.5, Math.max(Math.abs((ry % 1) - 0.5), Math.abs((rx % 1) - 0.5)));
    const g = fbm(u, v, 191, 4), f = fbm(u, v, 211, 3, 32);
    const k = 1 - joint * 0.42;
    return [(132 + g * 30) * k, (130 + g * 28) * k, (120 + g * 24) * k,
      -joint * 0.8 + g * 0.4 + f * 0.2, 0.82 + f * 0.12];
  } },
  roof: { size: 256, rep: [1, 1], fn: (u, v) => {
    const ribs = Math.abs(Math.sin(u * Math.PI * 18));
    const course = Math.abs(Math.sin(v * Math.PI * 12));
    const g = fbm(u, v, 233, 3);
    const hi = Math.pow(ribs, 0.6), lo = smooth(0.85, 1, course);
    const k = 0.62 + hi * 0.52 - lo * 0.22 + g * 0.14;
    return [46 * k + g * 12, 148 * k + g * 18, 106 * k + g * 14,
      hi * 0.9 - lo * 0.5 + g * 0.2, 0.26 + g * 0.16 + lo * 0.1];
  } },
  bronze: { size: 256, rep: [1, 1], fn: (u, v) => {
    const g = fbm(u, v, 251, 4), pat = smooth(0.52, 0.75, fbm(u, v, 277, 3));
    const f = fbm(u, v, 293, 3, 32);
    return [112 + g * 34 - pat * 68, 78 + g * 26 + pat * 24, 46 + g * 16 + pat * 18,
      g * 0.5 + f * 0.3 - pat * 0.25, 0.44 + g * 0.28 + pat * 0.25];
  } },
  wood: { size: 256, rep: [1, 1], fn: (u, v) => {
    const grain = Math.abs(Math.sin((u * 26 + fbm(u, v, 307, 3) * 5) * Math.PI));
    const g = fbm(u, v, 311, 3);
    return [96 + grain * 26 + g * 12, 44 + grain * 14 + g * 8, 36 + grain * 10 + g * 8,
      grain * 0.4 + g * 0.3, 0.48 + g * 0.2];
  } },
  ground: { size: 512, rep: [1, 1], fn: (u, v) => {
    const g = fbm(u, v, 331, 5), f = fbm(u, v, 347, 3, 32), patch = fbm(u, v, 359, 3);
    const dry = smooth(0.52, 0.78, patch);
    return [126 + g * 46 + dry * 52, 138 + g * 42 + dry * 30, 82 + g * 28 + dry * 14,
      g * 0.55 + f * 0.4, 0.9 + f * 0.1];
  } },
  hedge: { size: 256, rep: [1, 1], fn: (u, v) => {
    const g = fbm(u, v, 379, 4), f = fbm(u, v, 383, 4, 16);
    return [44 + g * 34 + f * 16, 70 + g * 46 + f * 20, 36 + g * 22 + f * 10,
      g * 0.6 + f * 0.5, 0.86 + g * 0.12];
  } },
};

export function buildTextures(onProgress, texScale = 1) {
  const out = {};
  const keys = Object.keys(TEXDEF);
  keys.forEach((k, i) => {
    const def = TEXDEF[k];
    const size = Math.max(128, Math.pow(2, Math.round(Math.log2(def.size * texScale))));
    out[k] = makeMaps(size, def.fn);
    if (onProgress) onProgress((i + 1) / keys.length, k);
  });
  return out;
}

/* ------------------------------------------------------------------ *
 * 4. 材质库
 * ------------------------------------------------------------------ */
export function buildMaterials(T) {
  const std = (name, key, opts = {}) => {
    const t = T[key];
    const m = new THREE.MeshStandardMaterial({
      map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap,
      normalScale: new THREE.Vector2(opts.ns ?? 0.55, opts.ns ?? 0.55),
      roughness: opts.roughness ?? 0.9, metalness: opts.metalness ?? 0.0,
      color: opts.color ?? 0xffffff, side: opts.side ?? THREE.FrontSide,
      transparent: opts.transparent ?? false, opacity: opts.opacity ?? 1,
      vertexColors: opts.vertexColors ?? false,
    });
    m.name = name;
    return m;
  };
  const M = {
    stone:   std('stone', 'stone', { roughness: 0.92, ns: 0.65 }),
    stone2:  std('stone2', 'stone', { roughness: 0.92, ns: 0.5, color: 0xe5dcc6 }),
    marble:  std('marble', 'marble', { roughness: 0.62, ns: 0.35 }),
    marbleD: std('marbleD', 'marble', { roughness: 0.72, ns: 0.4, color: 0xc9bda9 }),
    plaster: std('plaster', 'plaster', { roughness: 0.9, ns: 0.35 }),
    brick:   std('brick', 'brick', { roughness: 0.95, ns: 0.7 }),
    graybrick: std('graybrick', 'graybrick', { roughness: 0.94, ns: 0.7 }),
    roof:    std('roof', 'roof', { roughness: 0.38, ns: 0.85, metalness: 0.12, color: 0xd9f0dd }),
    bronze:  std('bronze', 'bronze', { roughness: 0.55, ns: 0.5, metalness: 0.72 }),
    bronzeD: std('bronzeD', 'bronze', { roughness: 0.7, ns: 0.5, metalness: 0.62, color: 0x8b9a72 }),
    wood:    std('wood', 'wood', { roughness: 0.6, ns: 0.4 }),
    ground:  std('ground', 'ground', { roughness: 1.0, ns: 0.35, vertexColors: true }),
    hedge:   std('hedge', 'hedge', { roughness: 1.0, ns: 0.6 }),
  };
  M.ridge = new THREE.MeshStandardMaterial({ color: 0x37624c, roughness: 0.36, metalness: 0.16 }); M.ridge.name = 'ridge';
  M.glass = new THREE.MeshPhysicalMaterial({ color: 0x6f8ba0, roughness: 0.18, metalness: 0.15, transparent: true, opacity: 0.42, side: THREE.DoubleSide });
  M.glass.name = 'glass';
  M.dark = new THREE.MeshStandardMaterial({ color: 0x3a3630, roughness: 0.95 }); M.dark.name = 'dark';
  M.gold = new THREE.MeshStandardMaterial({ color: 0xc7a25c, roughness: 0.34, metalness: 0.82 }); M.gold.name = 'gold';
  M.leaf = new THREE.MeshStandardMaterial({ color: 0x6b7a3e, roughness: 0.95, side: THREE.DoubleSide, vertexColors: true }); M.leaf.name = 'leaf';
  M.waterFoam = new THREE.MeshBasicMaterial({ color: 0xdfeaf0, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide });
  M.waterFoam.name = 'waterFoam';
  return M;
}

/* ------------------------------------------------------------------ *
 * 5. 几何工具
 * ------------------------------------------------------------------ */
export function boxGeo(w, h, d, uvPerMeter = 0.55) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv');
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * dims[f][0] * uvPerMeter, uv.getY(k) * dims[f][1] * uvPerMeter);
    }
  }
  uv.needsUpdate = true;
  return g;
}

export function chamferBoxGeo(w, h, d, bevel = 0.035, uvPerMeter = 0.5) {
  const s = new THREE.Shape();
  const hw = w / 2 - bevel, hh = h / 2 - bevel;
  s.moveTo(-hw, -hh); s.lineTo(hw, -hh); s.lineTo(hw, hh); s.lineTo(-hw, hh); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(0.01, d - bevel * 2), bevelEnabled: true,
    bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 1, steps: 1,
  });
  g.translate(0, 0, -(d - bevel * 2) / 2);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w * uvPerMeter, uv.getY(i) * h * uvPerMeter);
  return g;
}

export function archWallGeo(w, h, d, holes = [], bevel = 0.04) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h); s.lineTo(-w / 2, h); s.closePath();
  holes.forEach(o => {
    const p = new THREE.Path();
    const hw = o.w / 2;
    if (o.arch) {
      const spring = o.h - hw;
      p.moveTo(o.x - hw, 0); p.lineTo(o.x - hw, spring);
      p.absarc(o.x, spring, hw, Math.PI, 0, true);
      p.lineTo(o.x + hw, 0); p.closePath();
    } else {
      p.moveTo(o.x - hw, 0); p.lineTo(o.x - hw, o.h);
      p.lineTo(o.x + hw, o.h); p.lineTo(o.x + hw, 0); p.closePath();
    }
    s.holes.push(p);
  });
  const g = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(0.05, d - bevel * 2), bevelEnabled: bevel > 0,
    bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 16, steps: 1,
  });
  g.translate(0, 0, -(d - bevel * 2) / 2);
  return g;
}

export function brokenWallGeo(w, h, d, seed = 1, jagged = 1) {
  const r = mulberry32(seed * 7919 + 13);
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0);
  const N = Math.max(6, Math.round(w / 1.1));
  for (let i = N; i >= 0; i--) {
    const x = -w / 2 + (i / N) * w;
    const base = h - (0.12 + r() * 0.55 * jagged) * h;
    const dent = Math.sin(i * 1.7 + seed) * 0.07 * h;
    s.lineTo(x, Math.max(0.35 * h, base + dent));
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -d / 2);
  return g;
}

export function flutedShaftGeo(height, rBottom, rTop, flutes = 20, depth = 0.045, rings = 10, seg = 72) {
  const pos = [], nrm = [], uv = [], idx = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const y = t * height;
    const entasis = Math.sin(t * Math.PI) * 0.025;
    const r = rBottom + (rTop - rBottom) * t + entasis;
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const fl = Math.cos(a * flutes);
      const rad = r - depth * (0.5 - 0.5 * fl);
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      pos.push(x, y, z);
      const dr = -depth * 0.5 * flutes * Math.sin(a * flutes);
      const nx = Math.cos(a) * rad + Math.sin(a) * dr, nz = Math.sin(a) * rad - Math.cos(a) * dr;
      const l = Math.hypot(nx, nz) || 1;
      nrm.push(nx / l, 0.06, nz / l);
      uv.push(j / seg * 3, t * height * 0.5);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j, b = a + seg + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export function shellGeo(radius, ribs = 13, seg = 40, rings = 12) {
  const pos = [], nrm = [], uv = [], idx = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI;
      const ripple = Math.cos(a * ribs) * 0.045 * t;
      const R2 = radius * t;
      const x = Math.cos(a) * R2 * (1 + ripple);
      const y = Math.sin(a) * R2 * (1 + ripple) * 0.72;
      const z = -Math.pow(t, 2) * radius * 0.62;
      pos.push(x, y, z);
      nrm.push(0, 0.25, 1);
      uv.push(j / seg, t);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
    const a = i * (seg + 1) + j, b = a + seg + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function tube(points, radius, seg = 24, radial = 6) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  return new THREE.TubeGeometry(curve, seg, radius, radial, false);
}

export function leafGeo(len = 1, wide = 0.34, thick = 0.045) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(wide * 0.8, len * 0.18, wide, len * 0.55, wide * 0.18, len);
  s.bezierCurveTo(-wide * 0.18, len, -wide, len * 0.55, -wide * 0.8, len * 0.18);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelSize: thick * 0.4, bevelThickness: thick * 0.4, bevelSegments: 1, curveSegments: 5 });
}

export function transform(pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
  m.compose(new THREE.Vector3(pos[0], pos[1], pos[2]), q, new THREE.Vector3(scale[0], scale[1], scale[2]));
  return m;
}

/* ------------------------------------------------------------------ *
 * 6. 静态几何批处理：按材质 + 40m 空间格合并，显著降低 draw call
 * ------------------------------------------------------------------ */
function normalizeGeo(g) {
  const src = g.index ? g.toNonIndexed() : g.clone();
  const out = new THREE.BufferGeometry();
  const p = src.getAttribute('position');
  out.setAttribute('position', p.clone());
  out.setAttribute('normal', src.getAttribute('normal') ? src.getAttribute('normal').clone() : new THREE.Float32BufferAttribute(new Float32Array(p.count * 3), 3));
  const uv = src.getAttribute('uv');
  out.setAttribute('uv', uv ? uv.clone() : new THREE.Float32BufferAttribute(new Float32Array(p.count * 2), 2));
  if (src !== g) src.dispose();
  return out;
}

/* 远处不可辨的装饰性小构件：可按视距整组剔除，核心石构永不剔除 */
export const DETAIL_MATERIALS = new Set([
  'gold', 'bronze', 'bronzeD', 'wood', 'glass', 'ridge', 'dark', 'hedge', 'waterFoam', 'leaf',
]);

export class Batch {
  constructor(zone = 40) { this.groups = new Map(); this.zone = zone; }
  add(geo, mat, matrix, opts = {}) {
    const g = normalizeGeo(geo);
    g.applyMatrix4(matrix);
    const e = matrix.elements;
    const zx = Math.floor(e[12] / this.zone), zz = Math.floor(e[14] / this.zone);
    const key = (opts.noZone ? 'all' : `${zx}_${zz}`) + '|' + mat.name;
    if (!this.groups.has(key)) this.groups.set(key, { mat, list: [], noShadow: false });
    const grp = this.groups.get(key);
    grp.list.push(g);
    if (opts.noShadow) grp.noShadow = true;
    geo.dispose && opts.dispose !== false && geo.dispose();
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
      const sph = merged.boundingSphere;
      mesh.userData.center = sph.center.clone();
      mesh.userData.radius = sph.radius;
      mesh.userData.detail = DETAIL_MATERIALS.has(grp.mat.name);
      parent.add(mesh);
      meshes++;
      tris += merged.getAttribute('position').count / 3;
      grp.list.forEach((g, i) => { if (g !== merged) g.dispose(); });
    });
    this.groups.clear();
    return { meshes, tris };
  }
}

export function B(batch, mat, geo, pos, rot = [0, 0, 0], scale = [1, 1, 1], opts) {
  batch.add(geo, mat, transform(pos, rot, scale), opts);
}
export function box(batch, mat, w, h, d, pos, rot, opts) {
  B(batch, mat, boxGeo(w, h, d, opts?.uv ?? 0.5), pos, rot, [1, 1, 1], opts);
}
export function cbox(batch, mat, w, h, d, pos, rot, bevel = 0.04, opts) {
  B(batch, mat, chamferBoxGeo(w, h, d, bevel, opts?.uv ?? 0.5), pos, rot, [1, 1, 1], opts);
}
export function cyl(batch, mat, r1, r2, h, pos, seg = 16, rot, opts) {
  B(batch, mat, new THREE.CylinderGeometry(r2, r1, h, seg, 1), pos, rot, [1, 1, 1], opts);
}
export function torus(batch, mat, r, tubeR, pos, arc = Math.PI * 2, rot, opts) {
  B(batch, mat, new THREE.TorusGeometry(r, tubeR, 6, Math.max(12, Math.round(arc * 10)), arc), pos, rot, [1, 1, 1], opts);
}
export function sphere(batch, mat, r, pos, scale, wseg = 10, hseg = 7, opts) {
  B(batch, mat, new THREE.SphereGeometry(r, wseg, hseg), pos, [0, 0, 0], scale || [1, 1, 1], opts);
}
