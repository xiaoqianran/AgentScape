/* 吴苑澄观 · 核心层
 * 世界尺度与交付指标常量、LOD 分级标准、定点观察视角、
 * 确定性噪声、程序化 PBR 贴图集、材质库、几何工具、静态网格合批、地形与水系场函数。
 * 1 场景单位 = 1 米；+X 向东，-Z 向北，+Y 向上。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ================================================================== *
 * 1. 场景规模、边界、画质档位与 LOD 分级标准
 * ================================================================== */
export const WORLD = {
  unit: 1,
  garden: { minX: -110, maxX: 110, minZ: -95, maxZ: 95, area: 220 * 190 }, // 围墙内 4.18 ha
  core:   { minX: -110, maxX: 110, minZ: -95, maxZ: 95 },                  // 高精度核心区
  bounds: { minX: -150, maxX: 150, minZ: -140, maxZ: 160 },                 // 可浏览范围
  total:  [640, 560],          // 场景总尺寸（含园外借景地形、远山、林带、佛塔）
  ground: [640, 560],
  waterY: -0.42,
  sunDefaultHour: 15.67,       // 北京时间 15:40 江南午后
  borrowPagoda: [-255, -262],  // 园外借景：北寺塔（八角九层，76 m，距园内观景点约 400 m）
};

export const QUALITY = {
  high:   { label: '高', dpr: 2.0, shadow: 4096, texScale: 1,    aniso: 8, grass: 11000, trees: 1.00,
            leaves: 1.00, bloom: true,  grade: true,  lodScale: 1.00, waterSeg: 1.00, rain: 2600, detailBias: 1.00 },
  medium: { label: '中', dpr: 1.5, shadow: 2048, texScale: 0.5,  aniso: 4, grass: 5200,  trees: 0.74,
            leaves: 0.72, bloom: true,  grade: true,  lodScale: 0.80, waterSeg: 0.70, rain: 1400, detailBias: 0.86 },
  low:    { label: '低', dpr: 1.0, shadow: 1024, texScale: 0.25, aniso: 1, grass: 1200,  trees: 0.46,
            leaves: 0.45, bloom: false, grade: false, lodScale: 0.62, waterSeg: 0.48, rain: 600,  detailBias: 0.72 },
};

/* LOD 分级标准：距离以「相机 → 对象包围球近缘」计，随画质档 lodScale 缩放。
 * level 0 全细节几何 + 512² 贴图；level 1 轮廓细节；level 2 简化体量；level 3 剪影 + 大气雾。 */
export const LOD_LEVELS = [
  { id: 0, tag: 'L0', name: '极近景全细节', near: 0,   far: 18,  color: 0xe86a5c,
    scope: '核心区建筑/假山/池岸/近景花木；筒瓦垄、瓦当滴水、斗拱、棂条、挂落、砖雕、太湖石孔洞、逐叶草簇；投射高分辨率阴影' },
  { id: 1, tag: 'L1', name: '近景轮廓细节', near: 18,  far: 55,  color: 0xe9b34a,
    scope: '同院落 / 对岸建筑山石；保留飞檐翘角、屋脊、棂格、山石主孔与枝干轮廓，剔除微型雕饰' },
  { id: 2, tag: 'L2', name: '中景简化体量', near: 55,  far: 140, color: 0x5fbf8e,
    scope: '相邻景区、园墙、园外村落；简化体量 + 屋顶剪影，树叶改交叉面片，山石改低模轮廓，关闭阴影投射' },
  { id: 3, tag: 'L3', name: '远景剪影',     near: 140, far: 640, color: 0x5b8fc7,
    scope: '园外借景层：远山、林带、北寺塔；仅轮廓与剪影 + 高度雾消隐（塔在 140–420 m 保留中模以维持借景可辨）' },
];

/* 定点观察关键视角：pos 相机、target 注视点、fov 等效焦距、dir 朝向说明、desc 取景内容 */
export const POIS = [
  { id: 'overview', key: '1', name: '全园鸟瞰', pos: [122, 92, 152], target: [-4, 1, -10], fov: 42,
    dir: '朝西北 · 方位角约 322° · 垂直视场角 42°（广角）',
    desc: '自东南上空俯视全园：南部 190 m 礼序中轴、中部一池三山、九个园中园景区、四周云墙与园外借景层同时入画，用于检验整体格局与边界闭合。' },
  { id: 'gate', key: '2', name: '主入口 · 宫门', pos: [0, 2.6, 108], target: [0, 4.6, 72], fov: 39,
    dir: '正北 · 方位角 0° · 垂直视场角 39°',
    desc: '立于照壁前石广场朝北：八字照壁、砖雕门楼、宫门三间、轿厅与层层递进的中轴门洞构成礼序序列；照壁同时起障景作用，园内山水不一览无余。' },
  { id: 'axis', key: '3', name: '中轴前庭', pos: [0, 2.5, 72], target: [0, 5.0, 52], fov: 39,
    dir: '正北 · 方位角 0° · 垂直视场角 39°',
    desc: '前庭北望澄观堂：五开间歇山顶、月台踏跺、左右廊庑与对植玉兰，检验前朝中轴的对称关系与建筑比例。' },
  { id: 'hall', key: '4', name: '主体建筑 · 远香堂', pos: [-6, 2.3, 2], target: [0, 5.4, 30], fov: 39,
    dir: '朝南偏东 · 方位角约 168° · 垂直视场角 39°',
    desc: '自池中平桥回望南岸主体厅堂：歇山反宇屋面、飞檐翘角、整面格扇长窗、台基与美人靠，以及檐下斗拱在水中的倒影。' },
  { id: 'water', key: '5', name: '核心水景 · 一池三山', pos: [0, 2.4, 18], target: [-2, 1.2, -24], fov: 39,
    dir: '正北偏西 · 方位角约 357° · 垂直视场角 39°',
    desc: '南岸临水石平台正北：澄碧池大水面约占画面 45%，蓬莱、方丈、瀛洲三岛呈一池三山格局，曲桥、不系舟石舫、北岸雪香云蔚亭与主峰依次展开。' },
  { id: 'rockery', key: '6', name: '假山叠石 · 云根叠翠', pos: [-44, 2.2, -14], target: [-64, 5.6, -40], fov: 39,
    dir: '朝西北 · 方位角约 322° · 垂直视场角 39°',
    desc: '西山蹬道口近观太湖石：皴纹、涡孔与「皱漏瘦透」的孔洞透光、峡谷蹬道、跌水水帘与峰顶小亭；石面苔痕与湿痕在近景可辨。' },
  { id: 'summit', key: '7', name: '制高点俯瞰 · 见山楼', pos: [20, 11.2, -56], target: [0, 0.5, 14], fov: 42,
    dir: '朝南偏西 · 方位角约 196° · 垂直视场角 42°（广角）',
    desc: '见山楼二层外廊俯瞰：全园水系走向、屋顶群的高低节奏、九个景区的分隔与连通、南侧中轴纵深尽收眼底。' },
  { id: 'borrow', key: '8', name: '借景 · 北寺塔', pos: [40, 2.4, 13], target: [-95, 10, -137], fov: 39,
    dir: '朝西北 · 方位角约 318° · 垂直视场角 39°',
    desc: '荷风四面亭外临水处向西北远眺：荷叶与垂柳为前景、云墙为框，把园外约 400 m 处的九层北寺塔与灵岩山山脊「借」入园中，是借景关系的核心机位。' },
  { id: 'facing', key: '9', name: '对景 · 堂亭轴线', pos: [0, 2.4, 22], target: [-8, 5.2, -14], fov: 39,
    dir: '朝北偏西 · 方位角约 347° · 垂直视场角 39°',
    desc: '远香堂北檐下正对雪香云蔚亭：堂—水面—蓬莱岛—六角亭—假山主峰四点一线，两侧廊与竹丛形成夹景，构成全园最主要的对景轴线。' },
  { id: 'frame', key: '0', name: '框景 · 延月洞门', pos: [-81.3, 2.0, 51], target: [-64, 5.0, -40], fov: 39,
    dir: '朝北偏东 · 方位角约 11° · 垂直视场角 39°',
    desc: '竹里馆云墙之前：延月月洞门以圆形门洞框取西北假山主峰，旁列冰裂纹、海棠式、万字式漏窗，随脚步移动形成连续变化的框景画面。' },
  { id: 'bridge', key: '-', name: '九曲桥 · 荷风四面', pos: [42, 1.7, 18], target: [62, 2.8, 32], fov: 39,
    dir: '朝东南 · 方位角约 125° · 垂直视场角 39°',
    desc: '九曲桥中段贴水低视高：荷叶、睡莲与曲桥折线为前景，东南云墙、垂柳与荷风四面亭层层叠加，检验水面反射与近景植被密度。' },
  { id: 'bamboo', key: '=', name: '竹径幽居 · 竹里馆', pos: [-86, 2.0, 64], target: [-82, 3.6, 32], fov: 39,
    dir: '正北偏东 · 方位角约 7° · 垂直视场角 39°',
    desc: '竹径南端北望：白粉墙、竹影斑驳、碎石花街铺地与六角「听雨亭」，墙隅芭蕉与书带草构成夹景，检验斑驳光影与植被细节。' },
];

export const HOTSPOTS = [
  { name: '照壁与宫门', pos: [0, 4.2, 96], desc: '入园礼序起点，八字砖雕照壁起障景作用。' },
  { name: '澄观堂', pos: [0, 7.6, 58], desc: '前朝主殿，五开间歇山顶，中轴对称。' },
  { name: '远香堂', pos: [0, 6.8, 30], desc: '全园主体厅堂，四面厅式，北临澄碧池。' },
  { name: '见山楼', pos: [20, 12.4, -60], desc: '两层楼阁，园内制高点，二层可俯瞰全园并远借山塔。' },
  { name: '雪香云蔚亭', pos: [-8, 7.2, -12], desc: '蓬莱岛上的六角攒尖亭，与远香堂互为对景。' },
  { name: '云根叠翠', pos: [-62, 8.4, -40], desc: '太湖石假山主峰，高 9.6 m，内含洞壑与蹬道。' },
  { name: '荷风四面亭', pos: [44, 4.6, 6], desc: '东南荷池中的四角亭，借景北寺塔的主要观景点。' },
  { name: '延月洞门', pos: [-80, 3.0, 44], desc: '月洞门框取假山主峰，两侧设冰裂、海棠、万字漏窗。' },
  { name: '小飞虹', pos: [-48, 3.4, 10], desc: '跨西水湾的廊桥，朱栏映水如虹。' },
  { name: '不系舟', pos: [38, 3.0, -34], desc: '石舫，船首朝东南，与见山楼互为对景。' },
  { name: '九曲桥', pos: [46, 1.4, 12], desc: '贴水九折石桥，连接南岸与荷风四面亭。' },
  { name: '竹里馆', pos: [-82, 3.2, 34], desc: '竹径深处的六角听雨亭与粉墙漏窗院。' },
  { name: '小山丛桂', pos: [66, 4.4, -52], desc: '东北秋色景区，扇面亭与爬山廊。' },
  { name: '北寺塔（借景）', pos: [-255, 62, -262], desc: '园外八角九层砖塔，高 76 m，为全园最重要的远处借景。' },
];

/* ================================================================== *
 * 2. 确定性随机与可平铺噪声
 * ================================================================== */
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const R = mulberry32(17451747);
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
 * 3. 程序化 PBR 贴图集（颜色 / 法线 / 粗糙度，DataTexture，无外部文件）
 * ================================================================== */
function makeMaps(size, shade) {
  const n = size * size;
  const col = new Uint8Array(n * 4), nrm = new Uint8Array(n * 4), rgh = new Uint8Array(n * 4);
  const H = new Float32Array(n);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, o = shade(x / size, y / size, x, y, size);
    col[i * 4] = clamp(o[0], 0, 255); col[i * 4 + 1] = clamp(o[1], 0, 255);
    col[i * 4 + 2] = clamp(o[2], 0, 255); col[i * 4 + 3] = 255;
    H[i] = o[3];
    const rv = clamp(o[4] * 255, 0, 255);
    rgh[i * 4] = rv; rgh[i * 4 + 1] = rv; rgh[i * 4 + 2] = rv; rgh[i * 4 + 3] = 255;
  }
  const strength = 2.6;
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
  /* 白粉墙：微裂、雨渍、墙脚苔痕 */
  plaster: { size: 512, fn: (u, v) => {
    const g = fbm(u, v, 11, 4), f = fbm(u, v, 47, 3, 32), stain = fbm(u * 1.6, v * 0.35, 71, 3);
    const crack = smooth(0.90, 0.995, 1 - Math.abs(Math.sin((u * 7 + v * 9 + g * 5) * Math.PI))) * 0.30;
    const moss = smooth(0.52, 0.86, fbm(u, v, 97, 3)) * smooth(0.55, 1.0, v) * 0.35;
    const b = 226 - stain * 26 - crack * 34 - moss * 52 + g * 10;
    return [b, b * 0.988 - moss * 12 + moss * 8, b * 0.955 - stain * 8,
      g * 0.32 + f * 0.28 - crack * 0.9 + moss * 0.2, 0.87 + f * 0.10 + moss * 0.05];
  } },
  /* 青砖：错缝灰缝、砖面斑驳 */
  graybrick: { size: 512, fn: (u, v) => {
    const rows = 14, cols = 6;
    const ry = v * rows, rx = u * cols + (Math.floor(ry) % 2) * 0.5;
    const joint = smooth(0.40, 0.5, Math.max(Math.abs((ry % 1) - 0.5), Math.abs((rx % 1) - 0.5)));
    const g = fbm(u, v, 191, 4), f = fbm(u, v, 211, 3, 32);
    const k = 1 - joint * 0.44;
    return [(126 + g * 32) * k, (130 + g * 30) * k, (124 + g * 26) * k,
      -joint * 0.9 + g * 0.36 + f * 0.2, 0.84 + f * 0.12];
  } },
  /* 黛瓦：筒瓦垄、瓦当横线、釉面微光 */
  tile: { size: 512, fn: (u, v) => {
    const ribs = Math.abs(Math.sin(u * Math.PI * 22));
    const course = Math.abs(Math.sin(v * Math.PI * 14));
    const g = fbm(u, v, 233, 4), f = fbm(u, v, 241, 3, 32);
    const hi = Math.pow(ribs, 0.52), lo = smooth(0.86, 1.0, course);
    const k = 0.66 + hi * 0.46 - lo * 0.24 + g * 0.16;
    return [(54 + g * 16) * k, (64 + g * 16) * k, (66 + g * 16) * k,
      hi * 1.0 - lo * 0.55 + g * 0.22 + f * 0.18, 0.44 + g * 0.18 + lo * 0.12];
  } },
  /* 栗色漆木 */
  wood: { size: 256, fn: (u, v) => {
    const grain = Math.abs(Math.sin((u * 24 + fbm(u, v, 307, 3) * 5) * Math.PI));
    const g = fbm(u, v, 311, 3), f = fbm(u, v, 317, 3, 32);
    return [92 + grain * 24 + g * 12, 52 + grain * 14 + g * 8, 36 + grain * 9 + g * 6,
      grain * 0.42 + g * 0.28 + f * 0.14, 0.52 + g * 0.18];
  } },
  /* 楠木（浅色） */
  woodPale: { size: 256, fn: (u, v) => {
    const grain = Math.abs(Math.sin((u * 19 + fbm(u, v, 331, 3) * 4) * Math.PI));
    const g = fbm(u, v, 337, 3);
    return [150 + grain * 22 + g * 14, 108 + grain * 18 + g * 10, 68 + grain * 12 + g * 8,
      grain * 0.34 + g * 0.28, 0.58 + g * 0.16];
  } },
  /* 条石 / 花岗岩 */
  stone: { size: 512, fn: (u, v) => {
    const g = fbm(u, v, 11, 5), fine = fbm(u, v, 47, 3, 32), stain = fbm(u * 1.7, v * 0.35, 71, 3);
    const vein = Math.abs(Math.sin((u * 11 + v * 5 + g * 4.5) * Math.PI));
    const vline = smooth(0.84, 0.99, 1 - vein) * 0.13;
    const moss = smooth(0.64, 0.84, fbm(u, v, 97, 3)) * 0.34;
    const base = 172 + g * 28 - vline * 108 - stain * 20 - fine * 12;
    return [base - moss * 18, base * 0.99 + moss * 12 - vline * 92, base * 0.96 - moss * 6 - vline * 76,
      g * 0.5 + fine * 0.32 - vline * 1.1, 0.78 + fine * 0.18 + moss * 0.08];
  } },
  /* 太湖石：皴纹 + 涡孔阴影，灰白偏青 */
  taihu: { size: 512, fn: (u, v) => {
    const w = fbm(u, v, 401, 4), g = fbm(u, v, 409, 5), f = fbm(u, v, 419, 3, 32);
    const wrinkle = Math.abs(Math.sin((u * 17 + v * 11 + w * 9) * Math.PI));
    const pit = smooth(0.58, 0.82, Math.pow(wrinkle, 0.6) * g);
    const moss = smooth(0.60, 0.82, fbm(u, v, 431, 3)) * 0.35;
    const base = 168 + g * 32 - pit * 62 - moss * 26;
    return [base - moss * 12, base * 1.005 + moss * 8, base * 0.98 - moss * 4,
      g * 0.55 + f * 0.35 - pit * 1.3, 0.82 + f * 0.14 + moss * 0.06];
  } },
  /* 黄石：层理与砂岩颗粒 */
  huangshi: { size: 512, fn: (u, v) => {
    const g = fbm(u, v, 443, 4), f = fbm(u, v, 449, 3, 32);
    const layer = Math.abs(Math.sin((v * 12 + g * 3.2) * Math.PI));
    const seam = smooth(0.80, 0.98, 1 - layer) * 0.35;
    const base = 176 + g * 26 - seam * 66;
    return [base, base * 0.82 + f * 8 - seam * 46, base * 0.56 + f * 8 - seam * 34,
      g * 0.42 + f * 0.28 - seam * 1.0, 0.86 + f * 0.12];
  } },
  /* 汉白玉 */
  marble: { size: 256, fn: (u, v) => {
    const g = fbm(u, v, 23, 4), warp = fbm(u, v, 61, 3);
    const vein = Math.pow(1 - Math.abs(Math.sin((u * 5.2 + v * 3.1 + warp * 3.4) * Math.PI)), 9);
    const f = fbm(u, v, 89, 3, 32);
    const base = 224 + g * 18 - vein * 38;
    return [base, base * 0.99 - vein * 26, base * 0.96 - vein * 20,
      g * 0.3 + f * 0.22 - vein * 0.45, 0.52 + f * 0.18 + vein * 0.16];
  } },
  /* 花街铺地：碎卵石 / 冰裂嵌石 */
  paving: { size: 512, fn: (u, v) => {
    const g = fbm(u, v, 461, 4), f = fbm(u, v, 467, 3, 32);
    const cx = u * 14, cy = v * 14;
    const jx = cx - Math.floor(cx) - 0.5, jy = cy - Math.floor(cy) - 0.5;
    const jitter = fbm(u, v, 479, 2, 16) * 0.34;
    const pebble = smooth(0.30 + jitter, 0.46 + jitter, Math.hypot(jx, jy));
    const k = 1 - pebble * 0.40;
    return [(146 + g * 30) * k, (140 + g * 28) * k, (124 + g * 24) * k,
      g * 0.36 + f * 0.28 - pebble * 0.7, 0.88 + f * 0.10];
  } },
  /* 地面：草土干湿、苔斑 */
  ground: { size: 512, fn: (u, v) => {
    const g = fbm(u, v, 331, 5), f = fbm(u, v, 347, 3, 32), patch = fbm(u, v, 359, 3);
    const dry = smooth(0.50, 0.78, patch), moss = smooth(0.62, 0.82, fbm(u, v, 367, 3));
    return [112 + g * 44 + dry * 48 - moss * 20, 126 + g * 42 + dry * 26 + moss * 14, 78 + g * 26 + dry * 12 - moss * 8,
      g * 0.52 + f * 0.38, 0.92 + f * 0.08];
  } },
  /* 树皮 */
  bark: { size: 256, fn: (u, v) => {
    const g = fbm(u, v, 487, 4), f = fbm(u, v, 491, 3, 32);
    const ridge = Math.abs(Math.sin((u * 17 + g * 5) * Math.PI));
    const crack = smooth(0.68, 0.96, ridge);
    const b = 92 + g * 34 - crack * 34;
    return [b, b * 0.87 + f * 8, b * 0.72 + f * 6, ridge * 0.6 + g * 0.3 - crack * 0.5, 0.9 + f * 0.1];
  } },
  /* 叶簇：叶脉与色斑 */
  leaf: { size: 256, fn: (u, v) => {
    const g = fbm(u, v, 499, 4), f = fbm(u, v, 503, 3, 32);
    const vein = Math.abs(Math.sin((u * 9 + v * 3 + g * 3) * Math.PI));
    return [72 + g * 66 - vein * 16, 104 + g * 68 - vein * 10, 52 + g * 40 - vein * 16,
      g * 0.42 + f * 0.30 + vein * 0.2, 0.86 + f * 0.12];
  } },
  /* 苔藓 */
  moss: { size: 256, fn: (u, v) => {
    const g = fbm(u, v, 509, 5), f = fbm(u, v, 521, 3, 32);
    return [56 + g * 46, 88 + g * 52, 44 + g * 30, g * 0.6 + f * 0.4, 0.96];
  } },
  /* 窗纸 / 明瓦 */
  paper: { size: 256, fn: (u, v) => {
    const g = fbm(u, v, 541, 3), fiber = Math.abs(Math.sin((u * 34 + v * 7 + g * 4) * Math.PI));
    return [222 + g * 14 - fiber * 6, 210 + g * 14 - fiber * 6, 184 + g * 14 - fiber * 5,
      g * 0.2 + fiber * 0.12, 0.94];
  } },
};

export function buildTextures(onProgress, texScale = 1) {
  const out = {}, keys = Object.keys(TEXDEF);
  keys.forEach((k, i) => {
    const def = TEXDEF[k];
    const size = Math.max(128, Math.pow(2, Math.round(Math.log2(def.size * texScale))));
    out[k] = makeMaps(size, def.fn);
    if (onProgress) onProgress((i + 1) / keys.length, k);
  });
  return out;
}

/* ================================================================== *
 * 4. 材质库
 * ================================================================== */
export function buildMaterials(T) {
  const std = (name, key, o = {}) => {
    const t = T[key];
    const m = new THREE.MeshStandardMaterial({
      map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap,
      normalScale: new THREE.Vector2(o.ns ?? 0.55, o.ns ?? 0.55),
      roughness: o.roughness ?? 0.9, metalness: o.metalness ?? 0.0,
      color: o.color ?? 0xffffff, side: o.side ?? THREE.FrontSide,
      transparent: o.transparent ?? false, opacity: o.opacity ?? 1,
      vertexColors: o.vertexColors ?? false, flatShading: o.flat ?? false,
    });
    m.name = name; return m;
  };
  const M = {
    plaster:   std('plaster', 'plaster', { roughness: 0.94, ns: 0.36 }),
    plasterWarm: std('plasterWarm', 'plaster', { roughness: 0.94, ns: 0.36, color: 0xf1e6cc }),
    graybrick: std('graybrick', 'graybrick', { roughness: 0.95, ns: 0.72 }),
    tile:      std('tile', 'tile', { roughness: 0.52, ns: 0.85, metalness: 0.08 }),
    tileLight: std('tileLight', 'tile', { roughness: 0.54, ns: 0.8, color: 0xb9c4c2 }),
    wood:      std('wood', 'wood', { roughness: 0.62, ns: 0.4 }),
    woodPale:  std('woodPale', 'woodPale', { roughness: 0.66, ns: 0.38 }),
    stone:     std('stone', 'stone', { roughness: 0.9, ns: 0.62 }),
    stoneDark: std('stoneDark', 'stone', { roughness: 0.92, ns: 0.6, color: 0xb4b6ac }),
    taihu:     std('taihu', 'taihu', { roughness: 0.88, ns: 0.85 }),
    taihuDark: std('taihuDark', 'taihu', { roughness: 0.9, ns: 0.8, color: 0xb9c0bb }),
    huangshi:  std('huangshi', 'huangshi', { roughness: 0.94, ns: 0.7 }),
    marble:    std('marble', 'marble', { roughness: 0.62, ns: 0.32 }),
    paving:    std('paving', 'paving', { roughness: 0.96, ns: 0.55 }),
    ground:    std('ground', 'ground', { roughness: 1.0, ns: 0.34, vertexColors: true }),
    bark:      std('bark', 'bark', { roughness: 0.96, ns: 0.7 }),
    leaf:      std('leaf', 'leaf', { roughness: 0.9, ns: 0.35, side: THREE.DoubleSide, vertexColors: true }),
    moss:      std('moss', 'moss', { roughness: 1.0, ns: 0.6 }),
    paper:     std('paper', 'paper', { roughness: 0.96, ns: 0.15, transparent: true, opacity: 0.88, side: THREE.DoubleSide }),
  };
  const solid = (name, color, roughness = 0.8, metalness = 0) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness }); m.name = name; return m;
  };
  M.ridge = solid('ridge', 0x353f40, 0.52, 0.12);
  M.darkWood = solid('darkWood', 0x3a2a20, 0.72);
  M.lacquer = solid('lacquer', 0x7a3226, 0.46);
  M.gold = solid('gold', 0xc9a75e, 0.34, 0.78);
  M.bronze = solid('bronze', 0x7c7658, 0.52, 0.55);
  M.white = solid('white', 0xeae6d8, 0.9);
  M.ink = solid('ink', 0x252d2b, 0.86);
  M.lantern = new THREE.MeshStandardMaterial({ color: 0xffb765, emissive: 0xff9a3c, emissiveIntensity: 1.1, roughness: 0.7 });
  M.lantern.name = 'lantern';
  M.glass = new THREE.MeshPhysicalMaterial({ color: 0x9fb6b2, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.30, side: THREE.DoubleSide });
  M.glass.name = 'glass';
  M.petal = new THREE.MeshStandardMaterial({ color: 0xf2d4d8, roughness: 0.82, side: THREE.DoubleSide, vertexColors: true });
  M.petal.name = 'petal';
  M.lotus = new THREE.MeshStandardMaterial({ color: 0x4e8248, roughness: 0.86, side: THREE.DoubleSide, vertexColors: true });
  M.lotus.name = 'lotus';
  return M;
}

/* ================================================================== *
 * 5. 几何工具
 * ================================================================== */
export function boxGeo(w, h, d, uvPerMeter = 0.5) {
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
export function lathe(points, seg = 24) {
  return new THREE.LatheGeometry(points.map(p => new THREE.Vector2(p[0], p[1])), seg);
}
/** 带窗洞的墙（Shape + holes），用于月洞门、漏窗、格扇框 */
export function wallWithHoles(w, h, d, holes) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h); s.lineTo(-w / 2, h); s.closePath();
  (holes || []).forEach(o => {
    const p = new THREE.Path();
    if (o.type === 'circle') {
      const r = o.r || 1;
      p.absarc(o.x, o.y + r, r, 0, Math.PI * 2, true);
    } else if (o.type === 'rect') {
      const hw = o.w / 2;
      if (o.arch) {
        const spring = o.h - hw;
        p.moveTo(o.x - hw, o.y); p.lineTo(o.x - hw, o.y + spring);
        p.absarc(o.x, o.y + spring, hw, Math.PI, 0, true);
        p.lineTo(o.x + hw, o.y); p.closePath();
      } else {
        p.moveTo(o.x - hw, o.y); p.lineTo(o.x - hw, o.y + o.h);
        p.lineTo(o.x + hw, o.y + o.h); p.lineTo(o.x + hw, o.y); p.closePath();
      }
    } else if (o.type === 'hex') {
      const r = o.r || 1;
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + i * Math.PI / 3;
        const x = o.x + Math.cos(a) * r, y = o.y + Math.sin(a) * r;
        if (i === 0) p.moveTo(x, y); else p.lineTo(x, y);
      }
      p.closePath();
    }
    s.holes.push(p);
  });
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 20, steps: 1 });
  g.translate(0, 0, -d / 2);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.35, uv.getY(i) * 0.35);
  return g;
}
/** 不规则多边形挤出（用于台基、池岸条石、云墙顶） */
export function extrudePolygon(points, depth, bevel = 0) {
  const s = new THREE.Shape();
  points.forEach((p, i) => i === 0 ? s.moveTo(p[0], p[1]) : s.lineTo(p[0], p[1]));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 8 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/* ================================================================== *
 * 6. 静态几何合批：材质 + 32 m 空间格 + LOD 细节层
 * 每个 add 可指定 lod（0 核心体量 / 1 L0 专属细节 / 2 L1 专属细节 / 3 L2 专属细节）
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
  if (src !== g) src.dispose();
  return out;
}
export class Batch {
  constructor(zone = 32) { this.groups = new Map(); this.zone = zone; }
  add(geo, mat, matrix, opts = {}) {
    if (!geo || !geo.getAttribute('position')) return;
    const g = normalizeGeo(geo);
    g.applyMatrix4(matrix);
    const e = matrix.elements;
    const zx = Math.floor(e[12] / this.zone), zz = Math.floor(e[14] / this.zone);
    const lod = opts.lod ?? 0;
    const key = (opts.noZone ? 'all' : `${zx}_${zz}`) + '|' + mat.name + '|L' + lod;
    if (!this.groups.has(key)) this.groups.set(key, { mat, lod, list: [], noShadow: false });
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
      mesh.name = 'batch_' + grp.mat.name + '_L' + grp.lod;
      merged.computeBoundingSphere();
      const sph = merged.boundingSphere;
      mesh.userData.center = sph.center.clone();
      mesh.userData.radius = sph.radius;
      mesh.userData.lodTag = grp.lod;
      mesh.userData.baseMat = grp.mat;
      parent.add(mesh);
      meshes++; tris += merged.getAttribute('position').count / 3;
      if (grp.list.length > 1) grp.list.forEach(g => g.dispose());
    });
    this.groups.clear();
    return { meshes, tris };
  }
}

/* ================================================================== *
 * 7. 水系与地形场函数（供水面 shader、地形、植被、建筑布点共用）
 * ================================================================== */
const POOLS = [
  { x: 0,   z: -12, rx: 62, rz: 35 },   // 澄碧池主湖
  { x: -52, z: 6,   rx: 22, rz: 20 },   // 西水湾（小飞虹跨其上）
  { x: 46,  z: 8,   rx: 21, rz: 16 },   // 东南荷花池
  { x: 16,  z: -42, rx: 27, rz: 14 },   // 北溪（见山楼前）
  { x: -28, z: -46, rx: 19, rz: 12 },   // 西山脚水湾
];
const ISLES = [
  { x: -8,  z: -12, rx: 11.5, rz: 8.2 },  // 蓬莱（雪香云蔚亭）
  { x: -34, z: -24, rx: 7.2,  rz: 5.0 },  // 方丈
  { x: 28,  z: -18, rx: 7.4,  rz: 5.2 },  // 瀛洲
  { x: 44,  z: 6,   rx: 4.0,  rz: 3.6 },  // 荷风四面亭台基
];
export { POOLS, ISLES };
const ellDist = (x, z, e) => {
  const q = Math.hypot((x - e.x) / e.rx, (z - e.z) / e.rz);
  return (q - 1) * Math.min(e.rx, e.rz);
};
/** 水岸有符号距离：<0 位于水中；>0 位于陆地 */
export function waterSDF(x, z) {
  let d = 1e5;
  for (let i = 0; i < POOLS.length; i++) d = Math.min(d, ellDist(x, z, POOLS[i]));
  for (let i = 0; i < ISLES.length; i++) d = Math.max(d, -ellDist(x, z, ISLES[i]));
  return d;
}
export const inWater = (x, z) => waterSDF(x, z) < 0;
export const onIsle = (x, z) => ISLES.some(e => ellDist(x, z, e) < -0.4);

/** 地形高度：微起伏 + 西北山地基底抬升 + 池底下挖，水岸平滑过渡 */
export function terrainHeight(x, z) {
  const base = (fbm(x * 0.0042 + 3.1, z * 0.0042 + 7.7, 13, 4) - 0.5) * 1.5
             + (fbm(x * 0.012 + 1.3, z * 0.012 + 2.9, 17, 3) - 0.5) * 0.32;
  // 西北假山区域缓丘（最高约 +3.4 m）
  const hill = Math.exp(-((x + 66) ** 2 / 1900 + (z + 40) ** 2 / 1500)) * 3.1;
  // 东北桂花坡
  const hill2 = Math.exp(-((x - 68) ** 2 / 1500 + (z + 56) ** 2 / 1200)) * 1.35;
  // 园外北侧远山基底（仅在园墙外生效）
  let outer = 0;
  const oz = -z - 110;
  if (oz > 0) outer = Math.min(1, oz / 150) * (5 + Math.sin(x * 0.019) * 2.4 + Math.sin(x * 0.047 + 2) * 1.2);
  // 池底下挖
  const w = waterSDF(x, z);
  const dig = -2.15 * (1 - smooth(-1.2, 3.2, w));
  // 园墙内整体压平至 ±0.4 m，便于建筑布点
  const inside = (Math.abs(x) < 112 && Math.abs(z) < 97) ? 0.28 : 1;
  return (base + hill + hill2 + outer) * inside + dig + 0.10;
}

/** 生成水面/岸线裁剪 mask 纹理（RGBA，R 通道 = 水域覆盖率 0..255） */
export function buildWaterMask(size = 512) {
  const data = new Uint8Array(size * size * 4);
  const half = WORLD.total[0] / 2, halfZ = WORLD.total[1] / 2;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = (i / (size - 1) - 0.5) * WORLD.total[0];
    const z = (j / (size - 1) - 0.5) * WORLD.total[1];
    const d = waterSDF(x, z);
    const a = clamp(0.5 - d / 2.6, 0, 1);
    const k = j * size + i;
    data[k * 4] = a * 255; data[k * 4 + 1] = a * 255; data[k * 4 + 2] = a * 255; data[k * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}
