/* 吴苑澄观 · 主程序
 * 渲染器 / 后处理、分阶段加载、双模式漫游、12 个定点观察视角、
 * 景点标注、小地图、性能 HUD、画质与天气自适应。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  WORLD, QUALITY, POIS, HOTSPOTS, LOD_LEVELS,
  buildTextures, buildMaterials, Batch, waterSDF, terrainHeight, clamp,
} from './core.js';
import { buildBuildings } from './buildings.js';
import { buildRockery } from './rockery.js';
import { createWater } from './water.js';
import { createNature } from './nature.js';
import { createSky } from './sky.js';
import { LODManager } from './lod.js';

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
const lerp = THREE.MathUtils.lerp;

/* 电影调色：轻微 S 曲线、冷暖分离、暗角与胶片颗粒 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) }, uStrength: { value: 1 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    precision highp float;
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uResolution; uniform float uStrength;
    varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      vec3 o = c;
      c = clamp((c - 0.5) * 1.052 + 0.5, 0.0, 1.0);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c += vec3(0.015, 0.005, -0.012) * smoothstep(0.55, 1.0, l);
      c += vec3(-0.007, 0.001, 0.016) * (1.0 - smoothstep(0.0, 0.45, l));
      vec2 q = vUv - 0.5;
      c *= 1.0 - dot(q, q) * 0.46;
      float g = fract(sin(dot(vUv * uResolution + uTime * 29.0, vec2(12.9898, 78.233))) * 43758.5453);
      c += (g - 0.5) * 0.009;
      gl_FragColor = vec4(mix(o, c, uStrength), 1.0);
    }`,
};

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
  quality: guessInitialQuality(), auto: true, walk: false, labels: true,
  hour: WORLD.sunDefaultHour, weather: 'clear', poi: 'overview',
  fps: 60, frames: 0, acc: 0, lowFor: 0, highFor: 0, cooldown: 0,
  started: false, lodViz: false, lodVizParam: new URLSearchParams(location.search).get('lod') === '1',
};

let renderer, scene, camera, controls, composer, bloomPass, gradePass, outputPass, renderPass;
let sky, water, nature, lod, mainGroup, plaques = [], labelEls = [], gpuTimer = null;
let tween = null, toastTimer = null;
let labelT = 0, mapT = 0;
const keys = new Set();
const clock = new THREE.Clock();
const walkState = { yaw: 0, pitch: -0.10, eye: 1.70, vx: 0, vz: 0, locked: false };

function progress(p, text) {
  const bar = $('#load-bar'), pct = $('#load-pct'), label = $('#load-label');
  if (bar) bar.style.width = `${Math.round(p * 100)}%`;
  if (pct) pct.textContent = `${Math.round(p * 100)}%`;
  if (label) label.textContent = text;
}

/* ================================================================== *
 * 启动
 * ================================================================== */
async function boot() {
  const canvas = $('#scene');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[state.quality].dpr));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;   // 静态场景：仅时辰 / 画质变化时重绘阴影
  renderer.shadowMap.needsUpdate = true;
  renderer.info.autoReset = false;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(POIS[0].fov, window.innerWidth / window.innerHeight, 0.1, 3200);
  camera.position.set(...POIS[0].pos);
  camera.lookAt(...POIS[0].target);

  progress(0.04, '初始化渲染器与相机');
  await nextFrame();

  /* 材质贴图集 */
  progress(0.09, '生成白粉墙 / 黛瓦 / 太湖石等 PBR 纹理');
  await nextFrame();
  const T = buildTextures((p, k) => progress(0.09 + p * 0.17, `生成程序化材质：${k}`), QUALITY[state.quality].texScale);
  const M = buildMaterials(T);
  T && Object.values(T).forEach(t => {
    t.map.anisotropy = QUALITY[state.quality].aniso;
    t.normalMap.anisotropy = QUALITY[state.quality].aniso;
    t.roughnessMap.anisotropy = QUALITY[state.quality].aniso;
  });
  await nextFrame();

  /* 天空与光照 */
  progress(0.28, '布置江南午后天光、软阴影与大气雾');
  await nextFrame();
  sky = createSky(scene, renderer, M);
  sky.setHour(state.hour);
  sky.setQuality(QUALITY[state.quality]);

  /* 分批构建：建筑 → 假山 → 植被 → 水体 */
  lod = new LODManager(camera, scene);
  lod.setQuality(QUALITY[state.quality]);
  const B = new Batch(40);
  mainGroup = new THREE.Group(); mainGroup.name = '园林静态几何'; scene.add(mainGroup);
  const ctx = {
    B, M, scene, plaques, lod, BatchClass: Batch, quality: QUALITY[state.quality],
    waterfalls: [], streams: [],
    onProgress: (p, name) => progress(0.31 + p * 0.25, `构建建筑：${name}`),
  };

  progress(0.31, '构建中轴礼序与九大景区建筑群');
  await nextFrame();
  buildBuildings(ctx);
  await nextFrame();

  progress(0.57, '生成太湖石假山、洞壑与池岸驳岸');
  await nextFrame();
  ctx.onProgress = (p, name) => progress(0.57 + p * 0.13, `${name}`);
  buildRockery(ctx);
  const buildStats = B.build(mainGroup);
  console.log(`[场景] 静态合批 ${buildStats.meshes} 组 / ${Math.round(buildStats.tris)} 三角形`);
  await nextFrame();

  progress(0.71, '生成地形、园路、林木花木与远景借景');
  await nextFrame();
  nature = createNature(scene, M, ctx);

  progress(0.84, '布置水面、跌水与天气联动');
  await nextFrame();
  water = createWater(scene, ctx);
  water.setSky(sky.getState());

  /* LOD 注册 */
  [mainGroup, nature.trunkGroup, nature.pathGroup].forEach(g => g && lod.addBatchGroup(g));
  lod.setQuality(QUALITY[state.quality]);
  if (state.lodVizParam) setLodViz(true);

  progress(0.90, '装配漫游交互、后处理与画质分级');
  await nextFrame();
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.055;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.9;
  controls.panSpeed = 0.75;
  controls.screenSpacePanning = false;
  controls.minDistance = 2.5;
  controls.maxDistance = 420;
  // 允许适度仰视（定点视角常需从人眼高度仰望檐口与远塔），
  // 过严的 89° 上限会把相机强行抬到目标之上，破坏人眼视高构图
  controls.minPolarAngle = 0.05;
  controls.maxPolarAngle = Math.PI * 0.62;
  controls.target.set(...POIS[0].target);
  controls.update();

  composer = new EffectComposer(renderer);
  renderPass = new RenderPass(scene, camera);
  bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.26, 0.66, 0.92);
  outputPass = new OutputPass();
  gradePass = new ShaderPass(GradeShader);
  gradePass.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(outputPass);
  composer.addPass(gradePass);
  composer.setSize(window.innerWidth, window.innerHeight);

  buildLabels();
  bindUI();
  applyQuality(state.quality, true);
  setWeather(state.weather, true);
  onResize();
  window.addEventListener('resize', onResize);

  progress(1, '场景就绪');
  await nextFrame();
  $('#loader').classList.add('hidden');
  setTimeout(() => { const l = $('#loader'); if (l) l.style.display = 'none'; }, 900);
  state.started = true;
  state.loadedAt = performance.now();
  gpuTimer = initGpuTimer();
  lod.update(0, true);

  window.__garden = {
    goToPOI, applyQuality, setWeather, setLodViz, state, camera, controls, renderer,
    scene, sky, water, nature, lod, M, POIS, QUALITY, LOD_LEVELS,
    setHour: h => { state.hour = h; sky.setHour(h); water.setSky(sky.getState()); $('#time-slider').value = h; $('#time-val').textContent = fmtHour(h); },
    stats: buildStats,
  };
  clock.start();
  requestAnimationFrame(loop);
  const p = new URLSearchParams(location.search).get('poi');
  if (p && POIS.some(v => v.id === p)) goToPOI(p, true);
  toast('场景已就绪 · 拖拽旋转 / 滚轮缩放 / WASD 平移 / F 漫游 / 1–9 定点观察');
}

/* ================================================================== *
 * 景点标注
 * ================================================================== */
function buildLabels() {
  const wrap = $('#labels');
  wrap.innerHTML = '';
  labelEls = HOTSPOTS.map(h => {
    const el = document.createElement('div');
    el.className = 'poi-label';
    el.innerHTML = `<span class="dot"></span><span class="txt">${h.name}</span>`;
    el.addEventListener('click', e => { e.stopPropagation(); showInfo(h.name, '', h.desc); });
    wrap.appendChild(el);
    return { el, data: h };
  });
}
const projV = new THREE.Vector3();
function updateLabels() {
  const wrap = $('#labels');
  if (!state.labels) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  const w = window.innerWidth, h = window.innerHeight;
  labelEls.forEach(({ el, data }) => {
    projV.set(...data.pos).project(camera);
    const d = camera.position.distanceTo(new THREE.Vector3(...data.pos));
    if (projV.z > 1 || projV.z < -1 || d > 180 || Math.abs(projV.x) > 1.05 || Math.abs(projV.y) > 1.05) {
      el.style.opacity = '0'; el.style.pointerEvents = 'none'; return;
    }
    el.style.transform = `translate(-50%, -50%) translate(${(projV.x * 0.5 + 0.5) * w}px, ${(-projV.y * 0.5 + 0.5) * h}px)`;
    el.style.opacity = String(clamp((180 - d) / 90, 0.15, 0.95));
    el.style.pointerEvents = 'auto';
  });
}

/* ================================================================== *
 * 定点观察视角
 * ================================================================== */
function buildViewButtons() {
  const grid = $('#view-grid');
  grid.innerHTML = POIS.map((p, i) =>
    `<button class="view-btn${i === 0 ? ' active' : ''}" data-poi="${p.id}" title="${p.dir}">${p.key} · ${p.name}</button>`
  ).join('');
}
function goToPOI(id, instant) {
  const p = POIS.find(v => v.id === id) || POIS[0];
  state.poi = id;
  $$('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.poi === id));
  if (state.walk) toggleWalk(false);
  if (instant) {
    camera.position.set(...p.pos);
    controls.target.set(...p.target);
    camera.fov = p.fov; camera.updateProjectionMatrix();
    camera.lookAt(controls.target);
    controls.update(); tween = null;
  } else {
    tween = {
      t: 0, dur: 1.45,
      fromPos: camera.position.clone(), toPos: new THREE.Vector3(...p.pos),
      fromTarget: controls.target.clone(), toTarget: new THREE.Vector3(...p.target),
      fromFov: camera.fov, toFov: p.fov,
    };
  }
  showInfo(p.name, p.dir, p.desc, true);
  lod && lod.update(0, true);
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

/* ================================================================== *
 * 漫游
 * ================================================================== */
function toggleWalk(on) {
  const target = on === undefined ? !state.walk : on;
  state.walk = target;
  controls.enabled = !target;
  $('#walk-btn').classList.toggle('active', target);
  $('#walk-btn').textContent = target ? '退出漫游 [F]' : '自由漫游 [F]';
  $('#walk-hint').classList.toggle('show', target);
  if (target) {
    const dir = new THREE.Vector3().subVectors(controls.target, camera.position).normalize();
    walkState.yaw = Math.atan2(dir.x, -dir.z);
    walkState.pitch = Math.asin(clamp(dir.y, -1, 1));
    walkState.locked = false;
    toast('第一人称漫游：点击画面锁定鼠标，WASD 移动，Shift 加速，Q/E 调整视高');
  } else {
    if (document.pointerLockElement) document.exitPointerLock();
    controls.target.copy(camera.position).add(new THREE.Vector3(
      Math.sin(walkState.yaw), Math.tan(walkState.pitch) * 0.4, -Math.cos(walkState.yaw)).multiplyScalar(12));
    controls.update();
  }
}
function updateWalk(dt) {
  if (!state.walk) return;
  const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? 15 : 6.0;
  const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const fx = Math.sin(walkState.yaw), fz = -Math.cos(walkState.yaw);
  const rx = Math.cos(walkState.yaw), rz = Math.sin(walkState.yaw);
  const tx = fx * f + rx * s, tz = fz * f + rz * s;
  const l = Math.hypot(tx, tz) || 1;
  const mag = Math.min(1, Math.hypot(f, s));
  walkState.vx = lerp(walkState.vx, tx / l * speed * mag, 1 - Math.exp(-dt * 9));
  walkState.vz = lerp(walkState.vz, tz / l * speed * mag, 1 - Math.exp(-dt * 9));
  camera.position.x = clamp(camera.position.x + walkState.vx * dt, WORLD.bounds.minX, WORLD.bounds.maxX);
  camera.position.z = clamp(camera.position.z + walkState.vz * dt, WORLD.bounds.minZ, WORLD.bounds.maxZ);
  if (keys.has('KeyQ')) walkState.eye = clamp(walkState.eye - dt * 4, 0.9, 14);
  if (keys.has('KeyE')) walkState.eye = clamp(walkState.eye + dt * 4, 0.9, 14);
  // 水面区域按贴水石桥/平台处理，避免沉入池底
  const ground = waterSDF(camera.position.x, camera.position.z) < 0
    ? WORLD.waterY + 0.12 : terrainHeight(camera.position.x, camera.position.z);
  camera.position.y = lerp(camera.position.y, ground + walkState.eye, 1 - Math.exp(-dt * 10));
  const cp = Math.cos(walkState.pitch);
  const dir = new THREE.Vector3(Math.sin(walkState.yaw) * cp, Math.sin(walkState.pitch), -Math.cos(walkState.yaw) * cp);
  camera.lookAt(camera.position.clone().add(dir));
}
function panOrbit(dt) {
  if (state.walk || tween) return;
  const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  if (!f && !s) return;
  const d = new THREE.Vector3().subVectors(controls.target, camera.position).normalize();
  d.y = 0; d.normalize();
  const right = new THREE.Vector3(-d.z, 0, d.x);
  const v = d.multiplyScalar(f).add(right.multiplyScalar(s)).multiplyScalar(dt * 22);
  camera.position.add(v); controls.target.add(v);
  controls.target.x = clamp(controls.target.x, WORLD.bounds.minX, WORLD.bounds.maxX);
  controls.target.z = clamp(controls.target.z, WORLD.bounds.minZ, WORLD.bounds.maxZ);
}

/* ================================================================== *
 * 画质 / 天气 / LOD 可视化
 * ================================================================== */
function applyQuality(name, silent) {
  state.quality = name;
  const q = QUALITY[name];
  const pr = Math.min(window.devicePixelRatio || 1, q.dpr);
  renderer.setPixelRatio(pr);
  composer && composer.setPixelRatio(pr);
  sky.setQuality(q);
  nature && nature.applyQuality(q);
  lod && lod.setQuality(q);
  if (bloomPass) bloomPass.enabled = q.bloom;
  if (gradePass) gradePass.enabled = q.grade;
  $$('.q-btn').forEach(b => b.classList.toggle('active', b.dataset.quality === name));
  $('#quality-val').textContent = q.label;
  onResize();
  if (!silent) toast(`画质「${q.label}」· 阴影 ${q.shadow}² · 像素比 ${pr.toFixed(1)} · LOD 距离 ×${q.lodScale}`);
}
function setWeather(w, silent) {
  state.weather = w;
  sky.setWeather(w);
  water.setSky(sky.getState());
  nature.setWeather(w, sky.getState());
  $$('.w-btn').forEach(b => b.classList.toggle('active', b.dataset.weather === w));
  $('#weather-val').textContent = { clear: '晴', mist: '薄霭', rain: '细雨' }[w];
  if (!silent) toast(`天气切换为「${{ clear: '晴', mist: '薄霭', rain: '细雨' }[w]}」· 云量、雾密度与湿表面已联动`);
}
function setLodViz(on) {
  state.lodViz = on;
  lod.setVisualize(on);
  $('#lod-btn').classList.toggle('active', on);
  $('#lod-legend').classList.toggle('show', on);
}

/* ================================================================== *
 * UI
 * ================================================================== */
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3600);
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
  $('#time-slider').addEventListener('input', e => {
    state.hour = parseFloat(e.target.value);
    sky.setHour(state.hour);
    water.setSky(sky.getState());
    $('#time-val').textContent = fmtHour(state.hour);
  });
  $('#walk-btn').addEventListener('click', () => toggleWalk());
  $('#lod-btn').addEventListener('click', () => setLodViz(!state.lodViz));
  $('#labels-toggle').addEventListener('click', () => {
    state.labels = !state.labels;
    $('#labels-toggle').classList.toggle('active', state.labels);
    $('#labels-toggle').textContent = state.labels ? '景点标注' : '标注已关';
  });
  $('#auto-toggle').addEventListener('click', () => {
    state.auto = !state.auto;
    $('#auto-toggle').classList.toggle('active', state.auto);
  });
  $('#info-close').addEventListener('click', () => $('#info-card').classList.remove('show'));
  $('#help-btn').addEventListener('click', () => $('#spec-modal').classList.add('show'));
  $('#spec-close').addEventListener('click', () => $('#spec-modal').classList.remove('show'));
  $('#spec-modal').addEventListener('click', e => { if (e.target.id === 'spec-modal') e.currentTarget.classList.remove('show'); });
  $('#reset-btn').addEventListener('click', () => goToPOI('overview'));
  $$('.fold-head').forEach(h => h.addEventListener('click', () => h.parentElement.classList.toggle('folded')));

  const keyMap = {};
  POIS.forEach(p => { keyMap[p.key] = p.id; });
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    keys.add(e.code);
    if (e.code === 'KeyF') toggleWalk();
    if (e.code === 'KeyG') setLodViz(!state.lodViz);
    if (e.code === 'KeyL') $('#labels-toggle').click();
    if (e.code === 'KeyH') $('#help-btn').click();
    if (e.code === 'Escape') $('#spec-modal').classList.remove('show');
    const k = e.key;
    if (keyMap[k]) goToPOI(keyMap[k]);
  });
  window.addEventListener('keyup', e => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
  renderer.domElement.addEventListener('click', () => {
    if (state.walk && !walkState.locked && document.pointerLockElement !== renderer.domElement)
      renderer.domElement.requestPointerLock?.();
  });
  document.addEventListener('pointerlockchange', () => {
    walkState.locked = document.pointerLockElement === renderer.domElement;
  });
  document.addEventListener('mousemove', e => {
    if (!state.walk || !walkState.locked) return;
    walkState.yaw -= e.movementX * 0.0022;
    walkState.pitch = clamp(walkState.pitch - e.movementY * 0.0022, -1.35, 1.35);
  });
}
const fmtHour = h => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

/* ================================================================== *
 * 小地图
 * ================================================================== */
const mini = { ctx: null };
function drawMinimap() {
  if (!mini.ctx) mini.ctx = $('#minimap').getContext('2d');
  const c = mini.ctx, W = 212, H = 168;
  const mx = x => (x - WORLD.garden.minX - 20) / (WORLD.garden.maxX - WORLD.garden.minX + 40) * W;
  const mz = z => (z - WORLD.garden.minZ - 20) / (WORLD.garden.maxZ - WORLD.garden.minZ + 40) * H;
  c.clearRect(0, 0, W, H);
  c.fillStyle = '#1c2a24'; c.fillRect(0, 0, W, H);
  // 水系
  c.fillStyle = '#2e5559';
  const pools = [[0, -12, 62, 35], [-52, 6, 22, 20], [46, 8, 21, 16], [16, -42, 27, 14], [-28, -46, 19, 12]];
  pools.forEach(([x, z, rx, rz]) => {
    c.beginPath(); c.ellipse(mx(x), mz(z), rx / 260 * W, rz / 230 * H, 0, 0, Math.PI * 2); c.fill();
  });
  // 园墙
  c.strokeStyle = 'rgba(226,216,190,.72)'; c.lineWidth = 1.6;
  c.strokeRect(mx(-110), mz(-95), mx(110) - mx(-110), mz(95) - mz(-95));
  // 中轴
  c.strokeStyle = 'rgba(217,185,121,.55)'; c.lineWidth = 1;
  c.setLineDash([4, 3]);
  c.beginPath(); c.moveTo(mx(0), mz(95)); c.lineTo(mx(0), mz(22)); c.stroke();
  c.setLineDash([]);
  // 三岛
  c.fillStyle = '#6c7a4c';
  [[-8, -12, 11, 8], [-34, -24, 7, 5], [28, -18, 7, 5]].forEach(([x, z, rx, rz]) => {
    c.beginPath(); c.ellipse(mx(x), mz(z), rx / 260 * W, rz / 230 * H, 0, 0, Math.PI * 2); c.fill();
  });
  // 主要建筑
  const bl = [
    [0, 92, 14, 4, '宫门'], [0, 80, 20, 8, '轿厅'], [0, 58, 28, 12, '澄观堂'],
    [0, 30, 24, 10, '远香堂'], [-30, 18, 11, 6, '涵碧榭'], [20, -60, 18, 10, '见山楼'],
    [-8, -12, 7, 7, '雪香云蔚'], [44, 6, 7, 7, '荷风四面'], [-82, 34, 6, 6, '竹里馆'],
    [68, -54, 6, 6, '丛桂'], [-64, -40, 20, 18, '云根叠翠'], [38, -34, 18, 5, '不系舟'],
  ];
  c.font = '8px system-ui, sans-serif'; c.textAlign = 'center';
  bl.forEach(([x, z, w, d, n]) => {
    const px = mx(x - w / 2), py = mz(z - d / 2);
    const pw = w / 260 * W, ph = d / 230 * H;
    c.fillStyle = 'rgba(214,196,156,.80)'; c.fillRect(px, py, pw, ph);
    c.fillStyle = '#f0e6cc'; c.fillText(n, px + pw / 2, py + ph / 2 + 3);
  });
  // 借景塔方向
  c.strokeStyle = 'rgba(135,169,154,.5)'; c.setLineDash([3, 3]);
  c.beginPath(); c.moveTo(mx(44), mz(6)); c.lineTo(mx(-96), mz(-90)); c.stroke();
  c.setLineDash([]);
  c.fillStyle = '#87a99a'; c.fillText('借景 · 北寺塔', mx(-70), mz(-84));
  // 相机
  const dir = new THREE.Vector3().subVectors(controls.target, camera.position);
  const a = Math.atan2(dir.x, -dir.z);
  const cx = mx(camera.position.x), cy = mz(camera.position.z);
  c.save(); c.translate(cx, cy); c.rotate(a);
  c.fillStyle = '#ffcf7a'; c.beginPath(); c.moveTo(0, -8); c.lineTo(5, 6); c.lineTo(-5, 6); c.closePath(); c.fill();
  c.restore();
  c.strokeStyle = 'rgba(255,207,122,.45)'; c.beginPath(); c.arc(cx, cy, 10, 0, Math.PI * 2); c.stroke();
  c.fillStyle = '#9aa894'; c.textAlign = 'left'; c.font = '9px system-ui';
  c.fillText('N ↑', 6, 13); c.fillText('220m × 190m · 4.18ha', 6, H - 7);
}

/* ================================================================== *
 * 性能 HUD 与自适应降级
 * ================================================================== */
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
  $('#lodinfo').textContent = lod.summary();
  $('#campos').textContent = `${camera.position.x.toFixed(0)}, ${camera.position.y.toFixed(0)}, ${camera.position.z.toFixed(0)}`;

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

/* ================================================================== *
 * 主循环
 * ================================================================== */
function loop() {
  requestAnimationFrame(loop);
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.1);
  const realDt = Math.min(rawDt, 0.5);
  const t = clock.elapsedTime;
  renderer.info.reset();

  if (tween) updateTween(realDt);
  else if (!state.walk) { panOrbit(dt); controls.update(); }
  updateWalk(dt);

  sky.update(t, camera);
  water.setTime(t);
  water.setCamera(camera);
  water.setSky(sky.getState());
  nature.update(t, camera);
  if (gradePass) gradePass.uniforms.uTime.value = t;
  lod.update(dt);

  labelT += realDt; if (labelT > 1 / 15) { labelT = 0; updateLabels(); }
  mapT += realDt; if (mapT > 1 / 5) { mapT = 0; drawMinimap(); }

  gpuBegin();
  composer.render();
  gpuEnd();
  gpuPoll();
  updateHUD(dt);   // 在渲染之后读取 renderer.info，保证 draw call / 三角形为真实统计
}

function onResize() {
  if (!renderer || !camera) return;
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
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
