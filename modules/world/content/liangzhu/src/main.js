/* 良渚 · 水城 —— 主程序
 * 渲染器 / 后处理、分阶段加载、轨道·步行·乘船·航拍四模式漫游、
 * 14 个定点视角、景点与高程标注、全流域小地图、坝体高程剖面图、
 * 性能 HUD、天气 / 时辰 / 水汽 / 画质联动与自适应降级。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  WORLD, SURVEY, SURVEY_TABLE, QUALITY, buildTextures, buildMaterials, Batch, clamp, lerp,
} from './core.js';
import {
  BOAT_ROUTES, GATES, RINGS, TRUNKS, LAKES, HIGH_DAMS, LOW_DAMS, TANGSHAN,
  buildWaterMasks, waterSDF,
} from './hydro.js';
import { createTerrain, terrainHeight } from './terrain.js';
import { createWater } from './water.js';
import { createSky } from './sky.js';
import { createNature } from './nature.js';
import { buildCity, GUO } from './city.js';
import { buildDams, DAM_LABELS } from './dams.js';
import { createRevetment, makeCanoe } from './detail.js';

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
const UP = new THREE.Vector3(0, 1, 0);

/* 电影调色：轻微 S 曲线、冷暖分离、航拍水汽、暗角与胶片颗粒 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) }, uStrength: { value: 1 },
    uHaze: { value: new THREE.Color(0xc3ccc5) }, uAerial: { value: 0.14 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    precision highp float;
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uResolution;
    uniform float uStrength; uniform vec3 uHaze; uniform float uAerial;
    varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      vec3 o = c;
      c = clamp((c - 0.5) * 1.045 + 0.5, 0.0, 1.0);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c += vec3(0.012, 0.006, -0.010) * smoothstep(0.56, 1.0, l);
      c += vec3(-0.006, 0.002, 0.014) * (1.0 - smoothstep(0.0, 0.46, l));
      // 航拍水汽：亮部轻微抬灰蓝，压低远景对比
      c = mix(c, mix(c, uHaze, 0.10), uAerial * smoothstep(0.42, 0.96, l));
      vec2 q = vUv - 0.5;
      c *= 1.0 - dot(q, q) * 0.42;
      float g = fract(sin(dot(vUv * uResolution + uTime * 29.0, vec2(12.9898, 78.233))) * 43758.5453);
      c += (g - 0.5) * 0.0075;
      gl_FragColor = vec4(mix(o, c, uStrength), 1.0);
    }`,
};

/* ------------------------------------------------------------------ *
 * 定点视角（14 处）
 * ------------------------------------------------------------------ */
export const POIS = [
  { id: 'aerial', key: '1', name: '全城航拍 · 水网', pos: [1500, 1350, 2100], target: [-100, 6, -100], fov: 42,
    dir: '自东南上空朝西北 · 方位角约 315° · 35 mm 等效',
    desc: '内城 1770×1910 m 的圆角长方形轮廓完整入画：内外两道城河、8 座水门、内外环水网与 51 条古河道构成「水城」格局；中央莫角山台基与西侧王陵长垄、南面皇坟山、外围断续外郭台地依次展开，远处可见大遮山与谷口高坝群。' },
  { id: 'topdown', key: '2', name: '内城正俯瞰', pos: [0, 2050, 620], target: [0, 4, 0], fov: 45,
    dir: '正俯视 · 偏北 12°',
    desc: '垂直俯视内城：莫角山 670×450 m 覆斗台基居于正中，大/小莫角山与乌龟山呈品字形；西侧南北向王陵长垄上的反山、姜家山、桑树头清晰可辨；四面城墙与内外城河闭合，南墙中部可见唯一陆城门。' },
  { id: 'palace', key: '3', name: '莫角山宫殿台基', pos: [540, 118, 660], target: [0, 12, -60], fov: 40,
    dir: '自东南斜俯 · 方位角约 320°',
    desc: '莫角山为人工堆筑的长方形覆斗状土台，台底东西 670 m、南北 450 m、约 30 万 m²，台顶海拔 12 m（高出周边稻田 9–15 m），土方约 211–228 万 m³；坡面可见夯层与卵石护坡，台顶为 7 万 m² 沙土广场与三座宫殿台基。' },
  { id: 'damojiao', key: '4', name: '大莫角山 · 18 m', pos: [-130, 27, 70], target: [0, 17, -190], fov: 44,
    dir: '自台顶广场朝北 · 50 mm 等效',
    desc: '大莫角山 175×88 m、约 1.5 万 m²，相对高度 6 m、海拔 18 m，为全城制高点；台基上南北两排共 7 座房址，以干栏式木构与茅草双坡顶作研究性复原，前方为砂砾与粘土分层夯筑的沙土广场。' },
  { id: 'wall', key: '5', name: '城墙与东水门', pos: [1240, 52, 120], target: [885, 7, -450], fov: 40,
    dir: '自城外朝西 · 方位角约 270°',
    desc: '城墙底部普遍铺垫块石作基础，其上用较纯净黄土堆筑；一般宽 40–60 m（最宽逾 100 m），保存较好处高约 4 m、复原约 5 m，坡度约 30°，坡脚卵石护坡。此机位对准东墙北水门（宽 56 m），可见门道木桩护岸与内外城河沟通。' },
  { id: 'landgate', key: '6', name: '南陆城门 · 品字形', pos: [0, 24, 1230], target: [0, 6, 955], fov: 42,
    dir: '正北 · 南城墙中部',
    desc: '良渚古城唯一陆路通道，由三处小型夯土台基呈「品」字形布置，把连续城墙分为四个门道，总宽约 150 m；门前台基与高程标尺可校核 4.2 m 城内地面与 9.0 m 城墙顶的相对关系。' },
  { id: 'fanshan', key: '7', name: '反山王陵', pos: [-700, 36, -150], target: [-400, 9, -340], fov: 40,
    dir: '自西南朝东北',
    desc: '反山紧邻莫角山西北角，人工堆筑土墩高出地表约 4–5 m、面积约 2700 m²，1986 年清理 11 座高等级墓葬，M12 出土「玉琮王」「玉钺王」与完整神徽；其南姜家山 17 墓、桑树头同处一条南北向长垄，形成等级分明的王陵区。' },
  { id: 'yaoshan', key: '8', name: '瑶山祭坛 · 34.8 m', pos: [3260, 118, -3380], target: [3200, 34.6, -3600], fov: 40,
    dir: '自东南斜俯 · 内城东北约 5 km',
    desc: '依托海拔约 35 m 的自然山丘削平山顶筑方形覆斗状祭坛，正南北向，外围约 24×18 m，呈「回」字三重土色：中心红土台（7.6×5.9 m，顶 34.8 m 为制高点）、宽 1.7–2.1 m 深 0.65–0.85 m 的灰土围沟、黄褐色斑土砾石台面；另有 13 座大墓分南北两列、石坎护坡与砾石台阶。' },
  { id: 'reservoir', key: '9', name: '高坝库区 · 8.5 km²', pos: [-2200, 560, -1500], target: [-3100, 10, -3000], fov: 48,
    dir: '自东南高空朝西北',
    desc: '谷口高坝与平原低坝之间略呈三角形的低洼库区，面积约 8.5 km²，至今仍为泄洪区；场景以浅水湿地、淤泥滩涂、芦苇浅滩与孤立孤丘还原其蓄洪景观，远处高坝与塘山长堤共同围合。' },
  { id: 'highdam', key: '0', name: '谷口高坝群', pos: [-3400, 520, -3550], target: [-4200, 32, -4200], fov: 48,
    dir: '自东南朝西北 · 大遮山南麓',
    desc: '6 条谷口高坝分东（岗公岭、老虎岭、周家畈）、西（秋坞、石坞、蜜蜂弄）两组，各封堵一处狭窄谷口形成水库；坝顶海拔 30–35 m（区间 25–40），相对高度 10–15 m，长 50–200 m，坝体厚度近 100 m。坝后山谷水库水面 26 m、谷底 22 m。' },
  { id: 'section', key: '-', name: '老虎岭坝体剖面', pos: [-2880, 47, -4180], target: [-2724, 26, -4240], fov: 42,
    dir: '考古探沟式切口 · 近景',
    desc: '按发掘剖面还原：底部青淤泥 / 砂砾基础 → 下部草裹泥堆筑（草茎加筋、纵横交错如草袋，是良渚人发明的坝体工艺）→ 外部整体覆盖纯黄土夯层 → 迎水面块石 / 卵石护坡。老虎岭坝顶 33.0 m、谷底 19.5 m、底宽 100 m、顶宽 28 m，旁设高程标尺逐米核对。' },
  { id: 'tangshan', key: '=', name: '塘山长堤 · 双坝', pos: [-2180, 215, -2610], target: [-2420, 14, -2900], fov: 42,
    dir: '自东南斜俯 · 古城北 2 km',
    desc: '山前长堤全长约 5 km、宽 20–50 m，西段为矩尺形单层坝、中段为南北双层坝夹渠道、东段为单坝；北坝顶 15–20 m（取 17.5）、南坝顶 12–15 m（取 13.5）、双坝间距 20–30 m（取 26）、渠底海拔 7–8 m（取 7.6），渠中水面 8.2 m。' },
  { id: 'lowdam', key: '[', name: '平原低坝 · 孤丘', pos: [-2600, 260, -1250], target: [-3000, 10, -1880], fov: 46,
    dir: '自东南朝西北 · 平原孤丘间',
    desc: '梧桐弄、官山、鲤鱼山、狮子山 4 条低坝连接栲栳山以西的连续孤丘，坝顶高程约 10 m，长度 35–360 m（场景取 277–332 m）；鲤鱼山坝设剖面探沟，可见草裹泥坝芯与青淤泥基础。' },
  { id: 'wetland', key: ']', name: '城东湿地浅滩', pos: [2300, 420, 1100], target: [2750, 2.6, 300], fov: 42,
    dir: '贴水低视角 · 朝东北',
    desc: '城外东、北、西三面均有几百米宽的水面；此处为芦苇、菰、茭白、莎草、荷叶与浮萍构成的湿地浅滩，水面波纹、水下青淤泥与晨间水汽共同构成江南湿地航拍的照片质感。' },
  { id: 'boat', key: 'b', name: '河道乘船漫游', mode: 'boat', pos: [830, 5, 300], target: [830, 3, 0], fov: 46,
    dir: '独木舟第三人称 · 沿古河道环线',
    desc: '沿内城河环线、宫城内环钟家港或外环水网三条闭合水道自动航行，独木舟随波起伏并留下尾迹，可切换航线、调节航速与拖拽转向，穿行 8 座水门与内外环水网。' },
  { id: 'drone', key: 'p', name: '航拍俯瞰全城', mode: 'aerial', pos: [1800, 1400, 1800], target: [0, 4, 0], fov: 46,
    dir: '无人机式环绕 · 俯角约 40°',
    desc: '以 1200–1500 m 海拔环绕全城缓慢俯拍，完整呈现内外环水网、51 条古河道、8 座水门、莫角山宫殿台基、外郭台地与西北外围水利系统的空间关系。' },
];

const HOTSPOTS = [
  { name: '莫角山宫殿台基', pos: [0, 12.2, -60], elev: '12.0 m', desc: '670×450 m 覆斗土台，约 30 万 m²，台顶高出稻田 9–15 m。' },
  { name: '大莫角山', pos: [0, 18.2, -190], elev: '18.0 m', desc: '全城制高点，175×88 m，相对高 6 m，7 座房址。' },
  { name: '皇坟山台地', pos: [0, 10.7, 435], elev: '10.5 m', desc: '莫角山以南约 24 万 m²，最高处八亩山台基。' },
  { name: '反山王陵', pos: [-400, 9.4, -340], elev: '9.2 m', desc: '高出地表 4–5 m，11 座大墓，M12 出玉琮王。' },
  { name: '南陆城门', pos: [0, 7.6, 955], elev: '4.2→9.0 m', desc: '唯一陆门，品字形三台基、四门道，宽 150 m。' },
  { name: '东水门', pos: [885, 3.4, -450], elev: '2.6 m', desc: '8 座水城门之一，门道宽 56 m，内外城河相通。' },
  { name: '钟家港古河道', pos: [400, 3.0, 300], elev: '2.6 m', desc: '城内水上交通要道，沿岸为玉石、漆木器作坊区。' },
  { name: '宫殿区内环水网', pos: [430, 3.0, -60], elev: '2.6 m', desc: '环绕莫角山的内环水道，与外环、城河共同构成水城。' },
  { name: '池中寺台地', pos: [470, 6.7, 250], elev: '6.5 m', desc: '炭化稻米堆积逾 5000 m²，设高脚粮仓。' },
  { name: '城东湿地湖', pos: [2750, 3.0, 260], elev: '2.6 m', desc: '城外东面数百米宽水面与芦苇浅滩。' },
  { name: '瑶山祭坛', pos: [3200, 35.2, -3600], elev: '34.8 m', desc: '山顶三重土色「回」字祭坛，13 墓，兼观象测年。' },
  { name: '汇观山祭坛', pos: [2480, 22.2, -4230], elev: '22.0 m', desc: '形制与瑶山相似，灰土框内边约 8×10 m。' },
  { name: '高坝—低坝库区', pos: [-3100, 3.0, -3000], elev: '2.6 m', desc: '约 8.5 km² 低洼泄洪库区，淤泥滩涂与孤丘。' },
  { name: '老虎岭坝体剖面', pos: [-2650, 33.2, -4240], elev: '33.0 m', desc: '草裹泥坝芯 / 青淤泥基础 / 黄土外壳 / 块石护坡。' },
  { name: '塘山双坝长堤', pos: [-2200, 17.7, -2880], elev: '17.5 / 13.5 / 7.6 m', desc: '北坝 15–20、南坝 12–15、渠底 7–8、间距 20–30 m。' },
  { name: '鲤鱼山低坝', pos: [-2885, 10.2, -1860], elev: '10.0 m', desc: '4 条平原低坝之一，坝顶约 10 m，设剖面探沟。' },
  { name: '美人地外郭', pos: [1520, 6.4, -560], elev: '6.2 m', desc: '断续条状台地拱卫内城，为外郭居民区。' },
  { name: '凤山（纳入城墙）', pos: [885, 12.2, -955], elev: '≈12 m', desc: '东北角自然小土山，与西南雉山共同确定古城规模。' },
];

/* ------------------------------------------------------------------ *
 * 状态
 * ------------------------------------------------------------------ */
function guessInitialQuality() {
  const p = new URLSearchParams(location.search);
  const forced = p.get('q');
  if (QUALITY[forced]) return forced;
  const dpr = window.devicePixelRatio || 1;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  const area = window.innerWidth * window.innerHeight;
  if (cores <= 2 || mem <= 2 || /Android|iPhone|iPad/i.test(navigator.userAgent)) return 'low';
  if (cores <= 4 || mem <= 4 || area > 2600000 || dpr > 2.5) return 'medium';
  return 'high';
}
const state = {
  quality: guessInitialQuality(), auto: true, mode: 'orbit', labels: true, elev: true,
  hour: WORLD.sunDefaultHour, weather: 'mist', vapor: 1.0, poi: 'aerial',
  fps: 60, frames: 0, acc: 0, lowFor: 0, highFor: 0, cooldown: 0,
  started: false, loadedAt: 0,
  boat: { t: 0, speed: 7, yaw: 0, pitch: 0, side: 0, route: 'moat', curve: null, length: 1, drag: false, lx: 0, ly: 0 },
  aerial: { t: 0.55, speed: 1, altOffset: 0 },
  walk: { yaw: 0, pitch: -0.10, eye: 1.70, vx: 0, vz: 0, locked: false },
};
let renderer, scene, camera, controls, composer, bloomPass, gradePass;
let sky, water, nature, terrain, boat, wake = [], mainGroup;
let labelEls = [], tween = null, toastTimer = null, gpuTimer = null;
let labelT = 0, mapT = 0;
const keys = new Set();
const clock = new THREE.Clock();
const projV = new THREE.Vector3();
const tmpV = new THREE.Vector3();

function progress(p, text) {
  const bar = $('#load-bar'), pct = $('#load-pct'), label = $('#load-label');
  if (bar) bar.style.width = `${Math.round(p * 100)}%`;
  if (pct) pct.textContent = `${Math.round(p * 100)}%`;
  if (label) label.textContent = text;
}

/* ------------------------------------------------------------------ *
 * 启动
 * ------------------------------------------------------------------ */
async function boot() {
  const canvas = $('#scene');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[state.quality].dpr));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.info.autoReset = false;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(POIS[0].fov, window.innerWidth / window.innerHeight, 0.5, WORLD.far);
  camera.position.set(...POIS[0].pos);
  camera.lookAt(...POIS[0].target);

  progress(0.03, '初始化渲染器与相机');
  await nextFrame();

  const q = QUALITY[state.quality];
  progress(0.07, '生成夯土 / 草裹泥 / 卵石 / 青淤泥 PBR 纹理');
  await nextFrame();
  const T = buildTextures((p, k) => progress(0.07 + p * 0.13, `程序化材质：${k}`), q.texScale);
  const M = buildMaterials(T);
  Object.values(T).forEach(t => {
    t.map.anisotropy = q.aniso; t.normalMap.anisotropy = q.aniso; t.roughnessMap.anisotropy = q.aniso;
  });
  await nextFrame();

  progress(0.22, '布置江南湿地柔和漫射天光与水汽');
  await nextFrame();
  sky = createSky(scene, renderer, M, q);
  sky.setHour(state.hour);
  sky.setVapor(state.vapor);

  progress(0.27, '生成 12 km × 10 km 流域地形与水下淤泥河床');
  await nextFrame();
  terrain = createTerrain(scene, M, q);

  const B = new Batch(180);
  mainGroup = new THREE.Group(); mainGroup.name = '良渚城址静态几何'; scene.add(mainGroup);
  const ctx = { B, M, scene, revet: [], q,
    onProgress: (p, name) => progress(0.31 + p * 0.26, `构建城址：${name}`) };
  progress(0.31, '构建莫角山、城墙、王陵、祭坛与外郭');
  await nextFrame();
  buildCity(ctx);
  await nextFrame();
  ctx.onProgress = (p, name) => progress(0.57 + p * 0.12, `构建水利系统：${name}`);
  buildDams(ctx);
  const stats = B.build(mainGroup);
  console.log(`[场景] 静态合批 ${stats.meshes} 组 / ${Math.round(stats.tris)} 三角形`);
  await nextFrame();

  progress(0.70, '铺设城墙 / 台基 / 坝体卵石护坡');
  await nextFrame();
  createRevetment(scene, M, ctx.revet, q.cobble);

  progress(0.76, '生成芦苇 / 荷叶 / 垂柳等湿地植被');
  await nextFrame();
  nature = createNature(scene, M, q);

  progress(0.83, '计算内外环水网、城河与水面 mask');
  await nextFrame();
  const masks = buildWaterMasks(q, (p, n) => progress(0.83 + p * 0.07, `水面：${n}`));
  water = createWater(scene, masks, q);
  water.setSky(sky.getState());
  water.setWind(state.weather === 'rain' ? 1.4 : 0.75);

  /* 乘船独木舟与尾迹 */
  boat = makeCanoe(M);
  boat.name = '独木舟 · 乘船漫游';
  boat.visible = false;
  scene.add(boat);
  for (let i = 0; i < 5; i++) {
    const mat = M.foam.clone();
    mat.opacity = 0.30 - i * 0.045;
    const g = new THREE.PlaneGeometry(1.6 + i * 0.9, 5 + i * 3.4);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat);
    m.visible = false; m.renderOrder = 3;
    scene.add(m); wake.push(m);
  }
  setRoute(state.boat.route);
  await nextFrame();

  progress(0.92, '装配四模式漫游、后处理与 HUD');
  await nextFrame();
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.055;
  controls.rotateSpeed = 0.5; controls.zoomSpeed = 0.9; controls.panSpeed = 0.8;
  controls.screenSpacePanning = false;
  controls.minDistance = 4; controls.maxDistance = 7200;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.target.set(...POIS[0].target);
  controls.update();

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.18, 0.72, 0.94);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  gradePass = new ShaderPass(GradeShader);
  gradePass.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
  composer.addPass(gradePass);
  composer.setSize(window.innerWidth, window.innerHeight);

  buildLabels();
  bindUI();
  applyQuality(state.quality, true);
  setWeather(state.weather, true);
  drawSection();
  onResize();
  window.addEventListener('resize', onResize);

  progress(1, '场景就绪');
  await nextFrame();
  $('#loader').classList.add('hidden');
  setTimeout(() => { const l = $('#loader'); if (l) l.style.display = 'none'; }, 900);
  state.started = true;
  state.loadedAt = performance.now();
  gpuTimer = initGpuTimer();

  window.__liangzhu = {
    goToPOI, applyQuality, setWeather, setHour, setVapor, setMode, setRoute,
    state, camera, controls, renderer, scene, sky, water, nature, terrain,
    M, POIS, HOTSPOTS, QUALITY, SURVEY, SURVEY_TABLE, stats, boat,
    drawSection, drawMinimap,
  };
  clock.start();
  requestAnimationFrame(loop);
  const p = new URLSearchParams(location.search).get('poi');
  if (p && POIS.some(v => v.id === p)) goToPOI(p, true);
  toast('场景就绪 · 1–9 定点视角 / B 乘船 / P 航拍 / F 步行 / V 高程剖面');
}

/* ------------------------------------------------------------------ *
 * 景点与高程标注
 * ------------------------------------------------------------------ */
function buildLabels() {
  const wrap = $('#labels');
  wrap.innerHTML = '';
  labelEls = HOTSPOTS.map(h => {
    const el = document.createElement('div');
    el.className = 'poi-label';
    el.innerHTML = `<span class="dot"></span><span class="txt">${h.name} <span class="elev">${h.elev}</span></span>`;
    el.addEventListener('click', e => { e.stopPropagation(); showInfo(h.name, `考古高程 ${h.elev}`, h.desc); });
    wrap.appendChild(el);
    return { el, data: h };
  });
}
function updateLabels() {
  const wrap = $('#labels');
  if (!state.labels) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  const w = window.innerWidth, h = window.innerHeight;
  labelEls.forEach(({ el, data }) => {
    projV.set(...data.pos).project(camera);
    const d = camera.position.distanceTo(tmpV.set(...data.pos));
    const lim = state.mode === 'aerial' ? 6500 : 2600;
    if (projV.z > 1 || projV.z < -1 || d > lim || Math.abs(projV.x) > 1.02 || Math.abs(projV.y) > 1.02) {
      el.style.opacity = '0'; el.style.pointerEvents = 'none'; return;
    }
    el.style.transform = `translate(-50%, -50%) translate(${(projV.x * 0.5 + 0.5) * w}px, ${(-projV.y * 0.5 + 0.5) * h}px)`;
    el.style.opacity = String(clamp((lim - d) / (lim * 0.55), 0.20, 0.96));
    el.style.pointerEvents = 'auto';
  });
}

/* ------------------------------------------------------------------ *
 * 定点视角
 * ------------------------------------------------------------------ */
function buildViewButtons() {
  $('#view-grid').innerHTML = POIS.map((p, i) =>
    `<button class="view-btn${i === 0 ? ' active' : ''}" data-poi="${p.id}" title="${p.dir}">${p.key.toUpperCase()} · ${p.name}</button>`
  ).join('');
  $('#route-seg').innerHTML = BOAT_ROUTES.map(r =>
    `<button class="r-btn${r.id === state.boat.route ? ' active' : ''}" data-route="${r.id}">${r.name.split(' · ')[0]}</button>`
  ).join('');
}
function goToPOI(id, instant) {
  const p = POIS.find(v => v.id === id) || POIS[0];
  state.poi = id;
  $$('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.poi === id));
  if (p.mode) { setMode(p.mode); showInfo(p.name, p.dir, p.desc, true); return; }
  if (state.mode !== 'orbit') setMode('orbit');
  if (instant) {
    camera.position.set(...p.pos);
    controls.target.set(...p.target);
    camera.fov = p.fov; camera.updateProjectionMatrix();
    camera.lookAt(controls.target);
    controls.update(); tween = null;
  } else {
    tween = { t: 0, dur: 1.6,
      fromPos: camera.position.clone(), toPos: new THREE.Vector3(...p.pos),
      fromTarget: controls.target.clone(), toTarget: new THREE.Vector3(...p.target),
      fromFov: camera.fov, toFov: p.fov };
  }
  showInfo(p.name, p.dir, p.desc, true);
}
function updateTween(dt) {
  if (!tween) return;
  tween.t = Math.min(1, tween.t + dt / tween.dur);
  const k = tween.t < 0.5 ? 4 * tween.t ** 3 : 1 - Math.pow(-2 * tween.t + 2, 3) / 2;
  camera.position.lerpVectors(tween.fromPos, tween.toPos, k);
  controls.target.lerpVectors(tween.fromTarget, tween.toTarget, k);
  camera.fov = lerp(tween.fromFov, tween.toFov, k);
  camera.updateProjectionMatrix();
  camera.lookAt(controls.target);
  if (tween.t >= 1) tween = null;
}

/* ------------------------------------------------------------------ *
 * 四模式漫游
 * ------------------------------------------------------------------ */
function setRoute(id) {
  const r = BOAT_ROUTES.find(v => v.id === id) || BOAT_ROUTES[0];
  state.boat.route = id;
  state.boat.curve = new THREE.CatmullRomCurve3(
    r.points.map(([x, z]) => new THREE.Vector3(x, WORLD.waterY, z)), true, 'centripetal', 0.5);
  state.boat.length = state.boat.curve.getLength();
  $('#route-val').textContent = r.name;
  $$('.r-btn').forEach(b => b.classList.toggle('active', b.dataset.route === id));
}
function setMode(m) {
  if (!['orbit', 'walk', 'boat', 'aerial'].includes(m)) return;
  if (state.mode === m) return;
  if (state.mode === 'walk' && document.pointerLockElement) document.exitPointerLock();
  state.mode = m;
  tween = null;
  controls.enabled = (m === 'orbit');
  boat.visible = (m === 'boat');
  wake.forEach(w => { w.visible = (m === 'boat'); });
  $('#walk-hint').classList.toggle('show', m === 'walk');
  $('#boat-panel').classList.toggle('show', m === 'boat' || m === 'aerial');
  $('#boat-title').innerHTML = m === 'aerial'
    ? '航拍俯瞰全城水网 <span class="hint">W/S 速度 · A/D 高度</span>'
    : '河道乘船漫游 <span class="hint">W/S 航速 · 拖拽转向</span>';
  $('#speed-label').textContent = m === 'aerial' ? '环绕速度' : '航速';
  $('#speed-val').textContent = m === 'aerial' ? `${state.aerial.speed.toFixed(1)}×` : `${state.boat.speed.toFixed(1)} m/s`;
  $('#speed-slider').value = m === 'aerial' ? state.aerial.speed : state.boat.speed;
  $('#speed-slider').min = m === 'aerial' ? '0.2' : '1';
  $('#speed-slider').max = m === 'aerial' ? '4' : '22';
  $('#speed-slider').step = m === 'aerial' ? '0.1' : '0.5';
  $$('.m-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  const tag = { orbit: '轨道', walk: '步行', boat: '乘船', aerial: '航拍' }[m];
  $('#mode-val').textContent = tag;
  $('#modetag').textContent = tag;
  gradePass.uniforms.uAerial.value = m === 'aerial' ? 0.38 : 0.14;
  if (m === 'orbit') {
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    controls.target.copy(camera.position).addScaledVector(dir, 60);
    controls.update();
  } else if (m === 'walk') {
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    state.walk.yaw = Math.atan2(dir.x, -dir.z);
    state.walk.pitch = Math.asin(clamp(dir.y, -1, 1));
    state.walk.locked = false;
    toast('步行模式：点击画面锁定鼠标，WASD 行走，Shift 加速，Q/E 视高');
  } else if (m === 'boat') {
    toast('乘船漫游：沿古河道自动航行，W/S 调速，拖拽或 A/D 转向');
  } else {
    state.aerial.t = Math.atan2(camera.position.z, camera.position.x);
    toast('航拍模式：环绕俯瞰全城水网，W/S 调速，A/D 调整高度');
  }
}
function updateWalk(dt) {
  const s = state.walk;
  const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? 26 : 8.5;
  const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const r = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const fx = Math.sin(s.yaw), fz = -Math.cos(s.yaw);
  const rx = Math.cos(s.yaw), rz = Math.sin(s.yaw);
  const tx = fx * f + rx * r, tz = fz * f + rz * r;
  const l = Math.hypot(tx, tz) || 1;
  const mag = Math.min(1, Math.hypot(f, r));
  s.vx = lerp(s.vx, tx / l * speed * mag, 1 - Math.exp(-dt * 9));
  s.vz = lerp(s.vz, tz / l * speed * mag, 1 - Math.exp(-dt * 9));
  camera.position.x = clamp(camera.position.x + s.vx * dt, -5700, 5700);
  camera.position.z = clamp(camera.position.z + s.vz * dt, -4700, 4700);
  if (keys.has('KeyQ')) s.eye = clamp(s.eye - dt * 5, 0.9, 26);
  if (keys.has('KeyE')) s.eye = clamp(s.eye + dt * 5, 0.9, 26);
  const ground = Math.max(terrainHeight(camera.position.x, camera.position.z), WORLD.waterY + 0.1);
  camera.position.y = lerp(camera.position.y, ground + s.eye, 1 - Math.exp(-dt * 10));
  const cp = Math.cos(s.pitch);
  const dir = new THREE.Vector3(Math.sin(s.yaw) * cp, Math.sin(s.pitch), -Math.cos(s.yaw) * cp);
  camera.lookAt(camera.position.clone().add(dir));
}
function updateBoat(dt) {
  const b = state.boat, t = clock.elapsedTime;
  if (!b.curve) return;
  b.t = (b.t + dt * b.speed / b.length) % 1;
  const p = b.curve.getPointAt(b.t);
  const tan = b.curve.getTangentAt(b.t).normalize();
  const bob = Math.sin(t * 1.35) * 0.055 + Math.sin(t * 2.7 + 1.1) * 0.025;
  boat.position.set(p.x, WORLD.waterY + 0.10 + bob, p.z);
  boat.rotation.set(Math.sin(t * 0.9) * 0.012, -Math.atan2(tan.z, tan.x), Math.sin(t * 1.1) * 0.020);
  const dir = new THREE.Vector3(tan.x, 0, tan.z).applyAxisAngle(UP, b.yaw);
  const right = new THREE.Vector3(-dir.z, 0, dir.x);
  camera.position.copy(p).addScaledVector(dir, -8.6).addScaledVector(right, b.side)
    .add(new THREE.Vector3(0, 3.15 + bob, 0));
  const target = p.clone().addScaledVector(dir, 28).add(new THREE.Vector3(0, 1.35 + b.pitch * 16, 0));
  camera.lookAt(target);
  wake.forEach((w, i) => {
    w.position.copy(p).addScaledVector(dir, -(2.5 + i * 2.4));
    w.position.y = WORLD.waterY + 0.055 + i * 0.002;
    w.rotation.y = -Math.atan2(tan.z, tan.x);
    w.material.opacity = (0.30 - i * 0.045) * (0.75 + 0.25 * Math.sin(t * 3 + i));
  });
  $('#boat-bar').style.width = `${Math.round(b.t * 100)}%`;
  $('#boat-pct').textContent = `${Math.round(b.t * 100)}%`;
  $('#boat-pos').textContent = `海拔 ${(WORLD.waterY + bob).toFixed(2)} m · 航程 ${(b.t * b.length / 1000).toFixed(2)} km`;
}
function updateAerial(dt) {
  const a = state.aerial;
  a.t += dt * 0.042 * a.speed;
  const r = 2050 + 300 * Math.sin(a.t * 0.63 + 0.4);
  const alt = 1330 + 240 * Math.sin(a.t * 1.21 + 0.7) + a.altOffset;
  camera.position.set(Math.cos(a.t) * r - 120, alt, Math.sin(a.t) * r + 120);
  camera.lookAt(-120, 6, -120);
  $('#boat-bar').style.width = `${Math.round(((a.t / (Math.PI * 2)) % 1 + 1) % 1 * 100)}%`;
  $('#boat-pct').textContent = `${Math.round(alt)} m`;
  $('#boat-pos').textContent = `航拍海拔 ${Math.round(alt)} m · 俯瞰全城水网`;
}
function panOrbit(dt) {
  if (state.mode !== 'orbit' || tween) return;
  const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  if (!f && !s) return;
  const d = new THREE.Vector3().subVectors(controls.target, camera.position).normalize();
  d.y = 0; d.normalize();
  const right = new THREE.Vector3(-d.z, 0, d.x);
  const v = d.multiplyScalar(f).add(right.multiplyScalar(s)).multiplyScalar(dt * 90);
  camera.position.add(v); controls.target.add(v);
  controls.target.x = clamp(controls.target.x, -5600, 5600);
  controls.target.z = clamp(controls.target.z, -4600, 4600);
}

/* ------------------------------------------------------------------ *
 * 画质 / 天气 / 时辰
 * ------------------------------------------------------------------ */
function applyQuality(name, silent) {
  state.quality = name;
  const q = QUALITY[name];
  const pr = Math.min(window.devicePixelRatio || 1, q.dpr);
  renderer.setPixelRatio(pr);
  composer && composer.setPixelRatio(pr);
  sky && sky.setQuality(q);
  nature && nature.applyQuality(q);
  if (bloomPass) bloomPass.enabled = q.bloom;
  if (gradePass) gradePass.enabled = q.grade;
  $$('.q-btn').forEach(b => b.classList.toggle('active', b.dataset.quality === name));
  $('#quality-val').textContent = q.label;
  onResize();
  if (!silent) toast(`画质「${q.label}」· 阴影 ${q.shadow}² · 像素比 ${pr.toFixed(1)} · 地形 ${q.terrain[0]}×${q.terrain[1]}`);
}
function setWeather(w, silent) {
  state.weather = w;
  sky.setWeather(w);
  water && water.setSky(sky.getState());
  water && water.setWind(w === 'rain' ? 1.4 : w === 'mist' ? 0.62 : 0.85);
  nature && nature.setWeather(w);
  $$('.w-btn').forEach(b => b.classList.toggle('active', b.dataset.weather === w));
  $('#weather-val').textContent = { clear: '晴', mist: '湿地水汽', rain: '细雨' }[w];
  gradePass && (gradePass.uniforms.uHaze.value.copy(sky.getState().fogColor));
  if (!silent) toast(`天气「${{ clear: '晴', mist: '湿地水汽', rain: '细雨' }[w]}」· 云量、雾密度与水汽已联动`);
}
function setHour(h) {
  state.hour = clamp(h, 5.5, 19.0);
  sky.setHour(state.hour);
  water && water.setSky(sky.getState());
  gradePass && (gradePass.uniforms.uHaze.value.copy(sky.getState().fogColor));
  $('#time-slider').value = state.hour;
  $('#time-val').textContent = fmtHour(state.hour);
}
function setVapor(v) {
  state.vapor = clamp(v, 0, 1.6);
  sky.setVapor(state.vapor);
  water && water.setSky(sky.getState());
  $('#vapor-slider').value = state.vapor;
  $('#vapor-val').textContent = `${Math.round(state.vapor * 100)}%`;
}
const fmtHour = h => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

/* ------------------------------------------------------------------ *
 * UI
 * ------------------------------------------------------------------ */
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3800);
}
function showInfo(title, dir, desc, quiet) {
  $('#info-title').textContent = title;
  $('#info-dir').textContent = dir || '';
  $('#info-dir').style.display = dir ? 'block' : 'none';
  $('#info-desc').textContent = desc || '';
  $('#info-card').classList.add('show');
  if (!quiet) $('#info-card').scrollTop = 0;
}
function bindUI() {
  buildViewButtons();
  $$('.view-btn').forEach(b => b.addEventListener('click', () => goToPOI(b.dataset.poi)));
  $$('.q-btn').forEach(b => b.addEventListener('click', () => applyQuality(b.dataset.quality)));
  $$('.w-btn').forEach(b => b.addEventListener('click', () => setWeather(b.dataset.weather)));
  $$('.m-btn').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $$('.r-btn').forEach(b => b.addEventListener('click', () => setRoute(b.dataset.route)));
  $('#time-slider').addEventListener('input', e => setHour(parseFloat(e.target.value)));
  $('#vapor-slider').addEventListener('input', e => setVapor(parseFloat(e.target.value)));
  $('#speed-slider').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (state.mode === 'aerial') {
      state.aerial.speed = v; $('#speed-val').textContent = `${v.toFixed(1)}×`;
    } else {
      state.boat.speed = v; $('#speed-val').textContent = `${v.toFixed(1)} m/s`;
    }
  });
  $('#labels-toggle').addEventListener('click', () => {
    state.labels = !state.labels;
    $('#labels-toggle').classList.toggle('active', state.labels);
    $('#labels-toggle').textContent = state.labels ? '景点标注 [L]' : '标注已关';
  });
  $('#elev-toggle').addEventListener('click', () => {
    state.elev = !state.elev;
    $('#elev-toggle').classList.toggle('active', state.elev);
    document.body.classList.toggle('no-elev', !state.elev);
    toast(state.elev ? '已开启考古高程标注' : '已关闭高程数字');
  });
  $('#auto-toggle').addEventListener('click', () => {
    state.auto = !state.auto;
    $('#auto-toggle').classList.toggle('active', state.auto);
  });
  $('#section-btn').addEventListener('click', () => {
    const p = $('#section-panel'); p.classList.toggle('show');
    if (p.classList.contains('show')) drawSection();
  });
  $('#section-close').addEventListener('click', () => $('#section-panel').classList.remove('show'));
  $('#info-close').addEventListener('click', () => $('#info-card').classList.remove('show'));
  $('#help-btn').addEventListener('click', () => $('#spec-modal').classList.add('show'));
  $('#spec-close').addEventListener('click', () => $('#spec-modal').classList.remove('show'));
  $('#spec-modal').addEventListener('click', e => { if (e.target.id === 'spec-modal') e.currentTarget.classList.remove('show'); });
  $('#reset-btn').addEventListener('click', () => goToPOI('aerial'));
  $$('.fold-head').forEach(h => h.addEventListener('click', () => h.parentElement.classList.toggle('folded')));

  const keyMap = {};
  POIS.forEach(p => { keyMap[p.key] = p.id; });
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    keys.add(e.code);
    if (e.code === 'KeyF') setMode(state.mode === 'walk' ? 'orbit' : 'walk');
    if (e.code === 'KeyB') setMode(state.mode === 'boat' ? 'orbit' : 'boat');
    if (e.code === 'KeyP') setMode(state.mode === 'aerial' ? 'orbit' : 'aerial');
    if (e.code === 'KeyV') $('#section-btn').click();
    if (e.code === 'KeyC') $('#elev-toggle').click();
    if (e.code === 'KeyL') $('#labels-toggle').click();
    if (e.code === 'KeyH') $('#help-btn').click();
    if (e.code === 'KeyR') goToPOI('aerial');
    if (e.code === 'Escape') {
      $('#spec-modal').classList.remove('show');
      $('#section-panel').classList.remove('show');
      if (state.mode !== 'orbit') setMode('orbit');
    }
    const k = e.key.toLowerCase();
    if (keyMap[k]) goToPOI(keyMap[k]);
  });
  window.addEventListener('keyup', e => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
  renderer.domElement.addEventListener('click', () => {
    if (state.mode === 'walk' && !state.walk.locked && document.pointerLockElement !== renderer.domElement)
      renderer.domElement.requestPointerLock?.();
  });
  renderer.domElement.addEventListener('pointerdown', e => {
    if (state.mode !== 'boat') return;
    state.boat.drag = true; state.boat.lx = e.clientX; state.boat.ly = e.clientY;
    renderer.domElement.setPointerCapture?.(e.pointerId);
  });
  renderer.domElement.addEventListener('pointerup', e => {
    state.boat.drag = false;
    renderer.domElement.releasePointerCapture?.(e.pointerId);
  });
  document.addEventListener('pointerlockchange', () => {
    state.walk.locked = document.pointerLockElement === renderer.domElement;
  });
  document.addEventListener('mousemove', e => {
    if (state.mode === 'walk' && state.walk.locked) {
      state.walk.yaw -= e.movementX * 0.0022;
      state.walk.pitch = clamp(state.walk.pitch - e.movementY * 0.0022, -1.35, 1.35);
    } else if (state.mode === 'boat' && state.boat.drag) {
      state.boat.yaw = clamp(state.boat.yaw + (e.clientX - state.boat.lx) * 0.0035, -1.25, 1.25);
      state.boat.pitch = clamp(state.boat.pitch - (e.clientY - state.boat.ly) * 0.0022, -0.5, 0.5);
      state.boat.lx = e.clientX; state.boat.ly = e.clientY;
    }
  });
}

/* ------------------------------------------------------------------ *
 * 小地图：12 km × 10 km 全流域
 * ------------------------------------------------------------------ */
const mini = { ctx: null };
function drawMinimap() {
  if (!mini.ctx) mini.ctx = $('#minimap').getContext('2d');
  const c = mini.ctx, W = 236, H = 196;
  const [EW, NS] = WORLD.extent;
  const mx = x => (x / EW + 0.5) * W, mz = z => (z / NS + 0.5) * H;
  const sx = W / EW, sz = H / NS;
  c.clearRect(0, 0, W, H);
  c.fillStyle = '#16261f'; c.fillRect(0, 0, W, H);
  /* 山地晕染 */
  c.fillStyle = 'rgba(60,88,62,.36)';
  c.fillRect(0, 0, W, (mz(-3300)));
  c.fillRect(0, mz(2900), W, H - mz(2900));
  /* 湖沼 / 库区 */
  c.fillStyle = '#2c5759';
  LAKES.slice(0, 5).forEach(e => {
    c.beginPath(); c.ellipse(mx(e.x), mz(e.z), e.rx * sx, e.rz * sz, 0, 0, Math.PI * 2); c.fill();
  });
  /* 环形水系 */
  c.strokeStyle = '#376a6c'; c.lineJoin = 'round'; c.lineCap = 'round';
  RINGS.forEach(r => {
    const pts = roundRect(r.cx, r.cz, r.hx, r.hz, r.r);
    c.lineWidth = Math.max(1, r.hw * 2 * sx);
    c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(mx(p[0]), mz(p[1])) : c.moveTo(mx(p[0]), mz(p[1])));
    c.closePath(); c.stroke();
  });
  /* 51 条古河道 */
  c.strokeStyle = '#3e797b'; c.lineWidth = Math.max(0.7, 16 * sx);
  TRUNKS.forEach(t => {
    c.beginPath(); c.moveTo(mx(t.x1), mz(t.z1)); c.lineTo(mx(t.x2), mz(t.z2)); c.stroke();
  });
  /* 城墙 */
  c.strokeStyle = '#d8bc7e'; c.lineWidth = 2.2;
  const wall = roundRect(0, 0, WORLD.city.hx, WORLD.city.hz, WORLD.city.corner);
  c.beginPath(); wall.forEach((p, i) => i ? c.lineTo(mx(p[0]), mz(p[1])) : c.moveTo(mx(p[0]), mz(p[1])));
  c.closePath(); c.stroke();
  /* 莫角山 / 皇坟山 / 王陵长垄 */
  c.fillStyle = '#a8a06f';
  [[0, -60, 335, 225], [0, 435, 310, 210], [-400, -130, 52, 380]].forEach(([x, z, hx, hz]) => {
    c.fillRect(mx(x - hx), mz(z - hz), hx * 2 * sx, hz * 2 * sz);
  });
  /* 外郭台地 */
  c.fillStyle = 'rgba(150,170,110,.55)';
  GUO.forEach(g => c.fillRect(mx(g.x - g.w / 2), mz(g.z - g.d / 2), g.w * sx, Math.max(1.2, g.d * sz)));
  /* 坝体 */
  c.strokeStyle = '#e0a872'; c.lineWidth = 3;
  HIGH_DAMS.forEach(d => {
    const h = d.len / 2;
    c.beginPath();
    c.moveTo(mx(d.x - Math.cos(d.ang) * h), mz(d.z - Math.sin(d.ang) * h));
    c.lineTo(mx(d.x + Math.cos(d.ang) * h), mz(d.z + Math.sin(d.ang) * h));
    c.stroke();
  });
  c.strokeStyle = '#cf8f5c'; c.lineWidth = 2;
  LOW_DAMS.forEach(d => {
    c.beginPath(); c.moveTo(mx(d.x1), mz(d.z1)); c.lineTo(mx(d.x2), mz(d.z2)); c.stroke();
  });
  c.strokeStyle = '#e6c58a'; c.lineWidth = 2.6;
  [TANGSHAN.west, TANGSHAN.east].forEach(seg => {
    for (let i = 1; i < seg.length; i++) {
      c.beginPath(); c.moveTo(mx(seg[i - 1][0]), mz(seg[i - 1][1]));
      c.lineTo(mx(seg[i][0]), mz(seg[i][1])); c.stroke();
    }
  });
  c.beginPath();
  TANGSHAN.middle.forEach((p, i) => i ? c.lineTo(mx(p[0]), mz(p[1])) : c.moveTo(mx(p[0]), mz(p[1])));
  c.stroke();
  /* 瑶山 */
  c.fillStyle = '#c8a86a';
  c.beginPath(); c.arc(mx(3200), mz(-3600), 3, 0, Math.PI * 2); c.fill();
  /* 水门 */
  c.fillStyle = '#8fd0c8';
  GATES.forEach(g => { c.fillRect(mx(g.x) - 1.4, mz(g.z) - 1.4, 2.8, 2.8); });
  /* 乘船位置 */
  if (state.mode === 'boat' && state.boat.curve) {
    const bp = state.boat.curve.getPointAt(state.boat.t);
    c.fillStyle = '#ffe09a';
    c.beginPath(); c.arc(mx(bp.x), mz(bp.z), 3.2, 0, Math.PI * 2); c.fill();
  }
  /* 相机 */
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  const a = Math.atan2(dir.x, -dir.z);
  const cx = mx(camera.position.x), cy = mz(camera.position.z);
  c.save(); c.translate(cx, cy); c.rotate(a);
  c.fillStyle = '#ffcf7a'; c.beginPath(); c.moveTo(0, -8); c.lineTo(5, 6); c.lineTo(-5, 6); c.closePath(); c.fill();
  c.restore();
  c.strokeStyle = 'rgba(255,207,122,.42)'; c.lineWidth = 1;
  c.beginPath(); c.arc(cx, cy, 10, 0, Math.PI * 2); c.stroke();
  /* 注记与比例尺 */
  c.fillStyle = '#9fb8a8'; c.font = '9px system-ui'; c.textAlign = 'left';
  c.fillText('N ↑', 6, 12);
  c.fillText('0', 6, H - 7);
  c.strokeStyle = '#9fb8a8'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(18, H - 10); c.lineTo(18 + 1000 * sx, H - 10); c.stroke();
  c.fillText('1 km', 20 + 1000 * sx, H - 7);
  c.textAlign = 'right'; c.fillText('12 km × 10 km', W - 6, 12);
}
function roundRect(cx, cz, hx, hz, r) {
  const pts = [], step = 60;
  const push = (x, z) => pts.push([cx + x, cz + z]);
  const line = (x1, z1, x2, z2) => {
    const n = Math.max(1, Math.round(Math.hypot(x2 - x1, z2 - z1) / step));
    for (let i = 0; i < n; i++) push(x1 + (x2 - x1) * i / n, z1 + (z2 - z1) * i / n);
  };
  const arc = (ox, oz, a0, a1) => {
    const n = 5;
    for (let i = 0; i < n; i++) { const a = a0 + (a1 - a0) * i / n; push(ox + Math.cos(a) * r, oz + Math.sin(a) * r); }
  };
  line(-(hx - r), hz, hx - r, hz); arc(hx - r, hz - r, Math.PI / 2, 0);
  line(hx, hz - r, hx, -(hz - r)); arc(hx - r, -(hz - r), 0, -Math.PI / 2);
  line(hx - r, -hz, -(hx - r), -hz); arc(-(hx - r), -(hz - r), -Math.PI / 2, -Math.PI);
  line(-hx, -(hz - r), -hx, hz - r); arc(-(hx - r), hz - r, Math.PI, Math.PI / 2);
  return pts;
}

/* ------------------------------------------------------------------ *
 * 坝体高程剖面图
 * ------------------------------------------------------------------ */
function drawSection() {
  const cv = $('#section-canvas'); if (!cv) return;
  const c = cv.getContext('2d'), W = 520, H = 360;
  c.clearRect(0, 0, W, H);
  c.fillStyle = '#101f1b'; c.fillRect(0, 0, W, H);
  const baseY = 0, topY = 40;                    // 高程轴 0–40 m
  const px = x => x, py = y => H - 42 - (y - baseY) / (topY - baseY) * 244;
  /* 高程网格 */
  c.strokeStyle = 'rgba(200,222,207,.13)'; c.lineWidth = 1;
  c.font = '9px ui-monospace,monospace'; c.textAlign = 'right';
  for (let y = 0; y <= 40; y += 5) {
    c.beginPath(); c.moveTo(44, py(y)); c.lineTo(W - 14, py(y)); c.stroke();
    c.fillStyle = '#8fa99a'; c.fillText(`${y} m`, 39, py(y) + 3);
  }
  /* 坝体梯形 */
  const cx = 268, bw = 168, cw = 48, by = 19.5, cy = 33.0;
  const trap = new Path2D();
  trap.moveTo(cx - bw / 2, py(by)); trap.lineTo(cx - cw / 2, py(cy));
  trap.lineTo(cx + cw / 2, py(cy)); trap.lineTo(cx + bw / 2, py(by)); trap.closePath();
  c.save(); c.clip(trap);
  const bands = [
    [0.00, 0.16, '#4a5c5c', '青淤泥 / 砂砾基础'],
    [0.16, 0.76, '#6b5c43', '草裹泥坝芯'],
    [0.76, 1.00, '#b99b62', '纯黄土夯层'],
  ];
  bands.forEach(([a, b, col]) => {
    const yTop = py(by + (cy - by) * b), yBot = py(by + (cy - by) * a);
    c.fillStyle = col; c.fillRect(cx - bw / 2 - 4, yTop, bw + 8, yBot - yTop);
  });
  /* 草裹泥草茎与夯层线 */
  c.strokeStyle = 'rgba(214,196,140,.42)'; c.lineWidth = 0.7;
  for (let i = 0; i < 24; i++) {
    const y = by + (cy - by) * (0.17 + i * 0.024);
    c.beginPath(); c.moveTo(cx - bw / 2, py(y)); c.lineTo(cx + bw / 2, py(y)); c.stroke();
  }
  c.strokeStyle = 'rgba(60,48,32,.5)';
  for (let i = 0; i < 9; i++) {
    const y = by + (cy - by) * (0.78 + i * 0.024);
    c.beginPath(); c.moveTo(cx - bw / 2, py(y)); c.lineTo(cx + bw / 2, py(y)); c.stroke();
  }
  c.restore();
  c.strokeStyle = '#e2d2a6'; c.lineWidth = 1.6; c.stroke(trap);
  /* 块石护坡示意 */
  c.fillStyle = 'rgba(150,158,148,.85)';
  for (let i = 0; i < 9; i++) {
    const t = i / 9, yy = by + (cy - by) * t * 0.55;
    const xx = cx - bw / 2 + (bw / 2 - cw / 2) * t * 0.55;
    c.beginPath(); c.arc(xx - 4, py(yy) - 2, 2.6, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(cx * 2 - xx + 4, py(yy) - 2, 2.6, 0, Math.PI * 2); c.fill();
  }
  /* 标注 */
  c.textAlign = 'center'; c.font = '10px system-ui'; c.fillStyle = '#f0e8d2';
  c.fillText('老虎岭谷口高坝 · 考古探沟剖面', cx, 22);
  c.font = '9px ui-monospace,monospace'; c.fillStyle = '#e2c98d';
  c.fillText(`坝顶 ${cy.toFixed(1)} m`, cx, py(cy) - 8);
  c.fillText(`相对高 ${(cy - by).toFixed(1)} m`, cx, py(cy) + 12);
  c.textAlign = 'left'; c.fillStyle = '#cfe0d2';
  c.fillText(`底宽 ≈ ${SURVEY.highDam.thickness} m`, cx + bw / 2 + 8, py(by) - 16);
  c.fillText('顶宽 28 m', cx + bw / 2 + 8, py(by) - 2);
  c.fillText('谷底 19.5 m', cx + bw / 2 + 8, py(by) + 12);
  c.fillStyle = '#a9bbae'; c.font = '9px system-ui';
  c.fillText('← 块石 / 卵石护坡', 52, py(by) + 34);
  c.textAlign = 'right';
  c.fillText('草裹泥（草茎加筋）', cx - bw / 2 - 8, py(by + (cy - by) * 0.48));
  c.fillText('纯黄土外壳', cx - bw / 2 - 8, py(by + (cy - by) * 0.90));
  c.fillText('青淤泥基础', cx - bw / 2 - 8, py(by + (cy - by) * 0.06));
  /* 下方：塘山双坝三级高程关系 */
  c.textAlign = 'center'; c.font = '10px system-ui'; c.fillStyle = '#f0e8d2';
  c.fillText('塘山长堤 · 中段南北双坝与渠道（渠底 7.6 m）', cx, H - 84);
  const y0 = H - 30;
  const drawSmallDam = (x, h, col, label) => {
    const w = 34, wTop = 12, hh = h * 3.2;
    const p2 = new Path2D();
    p2.moveTo(x - w / 2, y0); p2.lineTo(x - wTop / 2, y0 - hh);
    p2.lineTo(x + wTop / 2, y0 - hh); p2.lineTo(x + w / 2, y0); p2.closePath();
    c.fillStyle = col; c.fill(p2); c.strokeStyle = '#e2d2a6'; c.lineWidth = 1; c.stroke(p2);
    c.fillStyle = '#e2c98d'; c.font = '9px ui-monospace,monospace';
    c.fillText(label, x, y0 - hh - 6);
  };
  drawSmallDam(cx - 70, 9.9, '#8a805e', '17.5 m');
  drawSmallDam(cx + 70, 5.9, '#8a805e', '13.5 m');
  c.fillStyle = '#376a6c'; c.fillRect(cx - 53, y0 - 4, 106, 4);
  c.fillStyle = '#8fd0c8'; c.font = '9px ui-monospace,monospace';
  c.fillText('渠道 8.2 m / 渠底 7.6 m · 间距 26 m', cx, y0 + 13);
}

/* ------------------------------------------------------------------ *
 * 性能 HUD 与自适应
 * ------------------------------------------------------------------ */
function initGpuTimer() {
  const gl = renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return null;
  return { gl, ext, query: null, lastMs: 0 };
}
function gpuBegin() {
  if (!gpuTimer || gpuTimer.query) return;
  const q = gpuTimer.gl.createQuery();
  gpuTimer.gl.beginQuery(gpuTimer.ext.TIME_ELAPSED_EXT, q);
  gpuTimer.query = q;
}
function gpuEnd() { if (gpuTimer && gpuTimer.query) gpuTimer.gl.endQuery(gpuTimer.ext.TIME_ELAPSED_EXT); }
function gpuPoll() {
  if (!gpuTimer || !gpuTimer.query) return;
  const { gl, ext, query } = gpuTimer;
  if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) return;
  if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) gpuTimer.lastMs = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
  gl.deleteQuery(query); gpuTimer.query = null;
}
let hudT = 0;
function updateHUD(dt) {
  state.frames++; state.acc += dt; hudT += dt;
  if (hudT < 0.35) return;
  const fps = state.frames / state.acc;
  state.fps = lerp(state.fps, fps, 0.5);
  state.frames = 0; state.acc = 0; hudT = 0;
  const frameMs = Math.max(1000 / Math.max(fps, 1), gpuTimer?.lastMs || 0);
  const adaptFps = 1000 / Math.max(frameMs, 1);
  $('#fps').textContent = Math.round(state.fps);
  $('#fps').className = state.fps > 50 ? 'good' : state.fps > 32 ? 'mid' : 'bad';
  $('#ms').textContent = frameMs.toFixed(1);
  $('#calls').textContent = renderer.info.render.calls;
  $('#tris').textContent = (renderer.info.render.triangles / 1000).toFixed(0) + 'k';
  $('#camalt').textContent = camera.position.y.toFixed(1);
  $('#campos').textContent = `${camera.position.x.toFixed(0)}, ${camera.position.z.toFixed(0)}`;
  $('#waterlevel').textContent = WORLD.waterY.toFixed(1);
  state.cooldown = Math.max(0, state.cooldown - 0.35);
  if (!state.auto || state.cooldown > 0) return;
  if (adaptFps < 38) { state.lowFor += 0.35; state.highFor = 0; }
  else if (adaptFps > 56) { state.highFor += 0.35; state.lowFor = 0; }
  else { state.lowFor *= 0.7; state.highFor *= 0.7; }
  if (state.lowFor > 2.1) {
    if (state.quality === 'high') applyQuality('medium');
    else if (state.quality === 'medium') applyQuality('low');
    state.lowFor = 0; state.cooldown = 6;
    toast('检测到帧率偏低，已自动降低细节密度以保证漫游流畅');
  } else if (state.highFor > 12 && state.quality === 'low') {
    applyQuality('medium'); state.highFor = 0; state.cooldown = 10;
  }
}

/* ------------------------------------------------------------------ *
 * 主循环
 * ------------------------------------------------------------------ */
function loop() {
  requestAnimationFrame(loop);
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.1), realDt = Math.min(rawDt, 0.5);
  const t = clock.elapsedTime;
  renderer.info.reset();

  if (tween) updateTween(realDt);
  else if (state.mode === 'orbit') { panOrbit(dt); controls.update(); }
  else if (state.mode === 'walk') updateWalk(dt);
  else if (state.mode === 'boat') updateBoat(dt);
  else if (state.mode === 'aerial') updateAerial(dt);
  if (state.mode === 'boat') {
    if (keys.has('KeyA')) state.boat.yaw = clamp(state.boat.yaw - dt * 0.8, -1.25, 1.25);
    if (keys.has('KeyD')) state.boat.yaw = clamp(state.boat.yaw + dt * 0.8, -1.25, 1.25);
    if (keys.has('KeyW')) state.boat.speed = clamp(state.boat.speed + dt * 5, 1, 22);
    if (keys.has('KeyS')) state.boat.speed = clamp(state.boat.speed - dt * 5, 1, 22);
    $('#speed-slider').value = state.boat.speed;
    $('#speed-val').textContent = `${state.boat.speed.toFixed(1)} m/s`;
  }
  if (state.mode === 'aerial') {
    if (keys.has('KeyA')) state.aerial.altOffset = clamp(state.aerial.altOffset - dt * 90, -600, 1200);
    if (keys.has('KeyD')) state.aerial.altOffset = clamp(state.aerial.altOffset + dt * 90, -600, 1200);
  }

  sky.update(t, camera);
  water.setTime(t); water.setCamera(camera); water.setSky(sky.getState());
  nature.update(t, camera);
  if (gradePass) { gradePass.uniforms.uTime.value = t; gradePass.uniforms.uHaze.value.copy(sky.getState().fogColor); }

  labelT += realDt; if (labelT > 1 / 15) { labelT = 0; updateLabels(); }
  mapT += realDt; if (mapT > 1 / 5) { mapT = 0; drawMinimap(); }

  gpuBegin();
  composer.render();
  gpuEnd();
  gpuPoll();
  updateHUD(dt);
}
function onResize() {
  if (!renderer || !camera) return;
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer && composer.setSize(w, h);
  gradePass && gradePass.uniforms.uResolution.value.set(w, h);
  renderer.shadowMap.needsUpdate = true;
}

boot().catch(err => {
  console.error('[场景启动失败]', err);
  const l = $('#load-label');
  if (l) l.textContent = '场景启动失败：' + (err && err.message ? err.message : err);
});
