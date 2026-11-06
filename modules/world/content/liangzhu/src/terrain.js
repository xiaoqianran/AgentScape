/* 良渚 · 水城 —— 流域地形
 * 12 km × 10 km 非均匀高度场（内城核心区密、外围疏），
 * 大遮山 / 大雄山 C 形山环、瑶山与汇观山孤丘、凤山雉山、库区孤丘、
 * 谷口高坝上游山谷盆地、塘山双坝渠底（7.6 m），
 * 以及按 51 条古河道 SDF 下挖的水下青淤泥河床。
 * 顶点色承担湿地草甸 / 稻田拼块 / 湿岸 / 淤泥 / 山林的航拍色彩层次。
 */
import * as THREE from 'three';
import {
  WORLD, SURVEY, clamp, smooth, lerp, fbm,
} from './core.js';
import {
  waterSDF, bedElevation, HIGH_DAMS, HILLOCKS, UPLAND_LAKES, TANGSHAN, TANGSHAN_MID,
} from './hydro.js';

const WL = SURVEY.waterLevel;
const hash2 = (a, b) => {
  const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return n - Math.floor(n);
};
const ellQ = (x, z, e) => Math.hypot((x - e.x) / e.rx, (z - e.z) / e.rz);
function segD(x, z, x1, z1, x2, z2) {
  const dx = x2 - x1, dz = z2 - z1, l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? clamp(((x - x1) * dx + (z - z1) * dz) / l2, 0, 1) : 0;
  return Math.hypot(x - x1 - t * dx, z - z1 - t * dz);
}

/* ------------------------------------------------------------------ *
 * 自然地形基面（未挖河床）
 * ------------------------------------------------------------------ */
function naturalHeight(x, z) {
  const n1 = fbm(x * 0.0016 + 2.1, z * 0.0016 + 5.3, 611, 4);
  const n2 = fbm(x * 0.0075 + 1.7, z * 0.0075 + 9.1, 617, 3);
  let h = SURVEY.wetlandGround + (n1 - 0.5) * 1.35 + (n2 - 0.5) * 0.38;

  /* 内城及近郊压平至 4.2 m */
  const cityR = Math.max(Math.abs(x) / WORLD.city.hx, Math.abs(z) / WORLD.city.hz);
  h = lerp(h, SURVEY.cityGround + (n2 - 0.5) * 0.30, 1 - smooth(0.92, 1.32, cityR));

  /* 北面大遮山：随 −Z 抬升的山脊，构成 C 形盆地北臂 */
  const zn = -z;
  if (zn > 3050) {
    const u = clamp((zn - 3050) / 1950, 0, 1);
    let ridge = 14 + 82 * smooth(0, 1, u);
    ridge += 15 * Math.sin(x * 0.0019 + 0.6) + 9 * Math.sin(x * 0.0053 + 2.2) + 4 * Math.sin(x * 0.0117);
    ridge *= 0.80 + 0.40 * fbm(x * 0.0014 + 1, z * 0.0014 + 3, 619, 3);
    h = lerp(h, Math.max(h, ridge), smooth(3050, 3820, zn));
  }
  /* 南面大雄山 */
  if (z > 2750) {
    const u = clamp((z - 2750) / 2100, 0, 1);
    let ridge = 12 + 76 * smooth(0, 1, u);
    ridge += 13 * Math.sin(x * 0.0022 + 1.9) + 8 * Math.sin(x * 0.0061 + 0.4);
    ridge *= 0.82 + 0.36 * fbm(x * 0.0015, z * 0.0015 + 8, 631, 3);
    h = lerp(h, Math.max(h, ridge), smooth(2750, 3550, z));
  }
  /* 西侧山体与北臂合围 */
  if (x < -4900) h += 24 * smooth(-4900, -5900, x) * (0.6 + 0.6 * fbm(x * 0.003, z * 0.003, 641, 2));

  /* 谷口高坝上游：两处山谷盆地，谷底 22 m、谷坡在库岸处抬至 33 m 以上 */
  for (let i = 0; i < UPLAND_LAKES.length; i++) {
    const e = UPLAND_LAKES[i], qn = ellQ(x, z, e);
    if (qn > 2.0) continue;
    const floor = 22.0 + 11.5 * smooth(0.70, 1.02, qn) + 34 * smooth(1.02, 1.85, qn)
                + (fbm(x * 0.006, z * 0.006, 647, 3) - 0.5) * 2.2;
    h = lerp(h, floor, 1 - smooth(1.02, 1.92, qn));
  }
  /* 高坝坝基：把坝轴附近整平到考古相对高度所要求的谷底（18.5–20 m） */
  for (let i = 0; i < HIGH_DAMS.length; i++) {
    const d = HIGH_DAMS[i];
    const dx = x - d.x, dz = z - d.z, ca = Math.cos(d.ang), sa = Math.sin(d.ang);
    const lx = dx * ca + dz * sa, lz = -dx * sa + dz * ca;
    const q = Math.hypot(lx / (d.len / 2 + 70), lz / 155);
    if (q < 1.5) h = lerp(h, d.baseY - 0.4, 1 - smooth(0.55, 1.45, q));
  }

  /* 塘山双坝：渠底抬至海拔 7.6 m 的带状平台 */
  let dt = 1e5;
  for (let i = 0; i < TANGSHAN_MID.length - 1; i++) {
    const a = TANGSHAN_MID[i], b = TANGSHAN_MID[i + 1];
    dt = Math.min(dt, segD(x, z, a[0], a[1], b[0], b[1]));
  }
  if (dt < 210) h = lerp(h, TANGSHAN.channelBottom, 1 - smooth(70, 205, dt));

  /* 瑶山（35 m）/ 汇观山（22 m）/ 凤山、雉山 / 库区孤丘 */
  const ys = Math.hypot((x - 3200) / 430, (z + 3600) / 420);
  if (ys < 1.25) h = Math.max(h, 2.0 + 31.4 * (1 - smooth(0.16, 1.10, ys)) + (n2 - 0.5) * 1.6);
  const hg = Math.hypot((x - 2480) / 360, (z + 4230) / 330);
  if (hg < 1.2) h = Math.max(h, 2.0 + 19.0 * (1 - smooth(0.14, 1.10, hg)));
  const fs = Math.hypot((x - 885) / 190, (z + 955) / 170);
  if (fs < 1.3) h = Math.max(h, 3.6 + 8.6 * (1 - smooth(0.20, 1.15, fs)));
  const zs = Math.hypot((x + 885) / 175, (z - 955) / 165);
  if (zs < 1.3) h = Math.max(h, 3.6 + 7.6 * (1 - smooth(0.20, 1.15, zs)));
  for (let i = 0; i < HILLOCKS.length; i++) {
    const [hx, hz, hh] = HILLOCKS[i];
    const q = Math.hypot((x - hx) / (hh * 4.6), (z - hz) / (hh * 4.2));
    if (q < 1.15) h = Math.max(h, 3.0 + hh * (1 - smooth(0.10, 1.05, q)) + (n2 - 0.5) * 1.8);
  }
  return h;
}

/** 最终地形高程：叠加古河道下挖与水下淤泥河床 */
export function terrainHeight(x, z) {
  let h = naturalHeight(x, z);
  const d = waterSDF(x, z);
  if (d < 9) {
    const bed = bedElevation(x, z, WL, waterSDF);
    const canDig = 1 - smooth(WL + 1.2, WL + 6.5, h);
    const target = lerp(h, Math.min(h, bed), canDig);
    h = lerp(target, h, smooth(-0.8, 8.0, d));
  }
  return h;
}

/** 地形顶点色：湿地草甸、稻田拼块、湿岸、水下淤泥、山林 */
const C = {
  grass: new THREE.Color(0x788e58), dry: new THREE.Color(0x9b9966),
  wet: new THREE.Color(0x756e58), silt: new THREE.Color(0x434e47),
  paddyA: new THREE.Color(0x95a663), paddyB: new THREE.Color(0x6b8248),
  paddyC: new THREE.Color(0x7a8e74), forestLow: new THREE.Color(0x567045),
  forestHigh: new THREE.Color(0x3b5238), city: new THREE.Color(0x888a61),
  rock: new THREE.Color(0x888a78),
};
const tmpC = new THREE.Color();
function terrainColor(x, z, h, out) {
  const d = waterSDF(x, z);
  const n = fbm(x * 0.004 + 4.2, z * 0.004 + 8.8, 653, 4);
  const patch = fbm(Math.floor(x / 210) * 0.17 + 1.3, Math.floor(z / 210) * 0.17 + 4.7, 659, 2);
  tmpC.copy(C.grass).lerp(C.dry, clamp((n - 0.44) * 1.35, 0, 0.62));
  /* 城外稻田拼块：180–230 m 田块，色调按地块哈希分层 */
  const fx = Math.floor((x + 6000) / 205), fz = Math.floor((z + 5000) / 205);
  const fid = hash2(fx, fz);
  const inCity = Math.abs(x) < 1600 && Math.abs(z) < 1650;
  if (!inCity && h < 12) {
    const pc = fid < 0.34 ? C.paddyA : fid < 0.68 ? C.paddyB : C.paddyC;
    tmpC.lerp(pc, 0.42 + patch * 0.22);
  }
  if (inCity) tmpC.lerp(C.city, 0.44);
  /* 山体林被 */
  if (h > 11) {
    const fw = smooth(10, 46, h);
    tmpC.lerp(C.forestLow.clone().lerp(C.forestHigh, smooth(28, 88, h)), fw * 0.92);
    if (h > 58) tmpC.lerp(C.rock, smooth(58, 110, h) * 0.38);
  }
  /* 高程 20–26 m 的山谷盆地：裸露黄褐土 */
  if (h > 18 && h < 27 && z < -3900 && x < -1800) tmpC.lerp(C.dry, 0.30);
  /* 湿岸与水下淤泥 */
  if (d < 7) tmpC.lerp(C.wet, 1 - smooth(-0.5, 7, d));
  if (d < 0) tmpC.lerp(C.silt, 1 - smooth(-0.4, -9, d));
  const fine = fbm(x * 0.031 + 2.7, z * 0.031 + 6.1, 661, 3);
  const border = Math.min(Math.abs(((x + 6000) % 205) / 205 - 0.5),
                          Math.abs(((z + 5000) % 205) / 205 - 0.5));
  const fieldEdge = inCity ? 1 : (0.93 + 0.07 * smooth(0.42, 0.49, border));
  const shade = (0.70 + n * 0.56 + (fid - 0.5) * 0.10) * (0.86 + fine * 0.28) * fieldEdge;
  out[0] = tmpC.r * shade; out[1] = tmpC.g * shade; out[2] = tmpC.b * shade;
}

/* 非均匀网格映射：|u| ≤ u0 为核心区线性加密，外围稀疏 */
function axisMap(u, coreHalf, outerHalf, u0) {
  const a = Math.abs(u), s = u < 0 ? -1 : 1;
  if (a <= u0) return s * (a / u0) * coreHalf;
  return s * (coreHalf + (a - u0) / (1 - u0) * (outerHalf - coreHalf));
}

export function createTerrain(scene, M, q) {
  const segX = q.terrain[0], segZ = q.terrain[1];
  const xs = new Float32Array(segX + 1), zs = new Float32Array(segZ + 1);
  const halfX = WORLD.extent[0] / 2, halfZ = WORLD.extent[1] / 2;
  for (let i = 0; i <= segX; i++) xs[i] = axisMap(i / segX * 2 - 1, WORLD.coreHalf[0], halfX, 0.62);
  for (let j = 0; j <= segZ; j++) zs[j] = axisMap(j / segZ * 2 - 1, WORLD.coreHalf[1], halfZ, 0.62);

  const count = (segX + 1) * (segZ + 1);
  const pos = new Float32Array(count * 3), uv = new Float32Array(count * 2), col = new Float32Array(count * 3);
  const idx = new Uint32Array(segX * segZ * 6);
  const c = [0, 0, 0];
  for (let j = 0; j <= segZ; j++) for (let i = 0; i <= segX; i++) {
    const k = j * (segX + 1) + i, x = xs[i], z = zs[j];
    const h = terrainHeight(x, z);
    pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
    uv[k * 2] = x * 0.055; uv[k * 2 + 1] = z * 0.055;
    terrainColor(x, z, h, c);
    col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2];
  }
  let o = 0;
  for (let j = 0; j < segZ; j++) for (let i = 0; i < segX; i++) {
    const a = j * (segX + 1) + i, b = a + segX + 1;
    idx[o++] = a; idx[o++] = b; idx[o++] = a + 1;
    idx[o++] = b; idx[o++] = b + 1; idx[o++] = a + 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, M.ground);
  mesh.name = '流域地形 · 12km × 10km';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  scene.add(mesh);

  /* 水下淤泥质感：在主要水面下另铺一层极薄的青淤泥贴面（避开核心台基） */
  const silt = buildSiltBed(scene, M, q);
  return { mesh, silt };
}

/* 河床淤泥贴面：稀疏网格、只在 SDF 水域内可见，用 alpha 由地形色承担 */
function buildSiltBed(scene, M, q) {
  const seg = Math.round(180 * clamp(q.detail, 0.55, 1));
  const [W, D] = [4800, 4000];
  const geo = new THREE.PlaneGeometry(W, D, seg, Math.round(seg * D / W));
  geo.rotateX(-Math.PI / 2);
  const p = geo.getAttribute('position');
  const a = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, Math.min(terrainHeight(x, z), bedElevation(x, z, WL, waterSDF)) + 0.035);
    a[i] = waterSDF(x, z) < 1.5 ? 1 : 0;
  }
  p.needsUpdate = true;
  geo.setAttribute('aWet', new THREE.BufferAttribute(a, 1));
  const mat = M.blueSilt.clone();
  mat.name = 'siltBed';
  mat.transparent = true;
  mat.depthWrite = false;
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aWet;\nvarying float vWet;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWet = aWet;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWet;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\nif (vWet < 0.5) discard;');
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = '水下青淤泥河床';
  mesh.receiveShadow = false;
  scene.add(mesh);
  return mesh;
}
