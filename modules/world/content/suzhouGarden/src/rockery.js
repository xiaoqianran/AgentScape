/* 吴苑澄观 · 假山与叠石
 * 太湖石以「等值面孔洞 + 多频噪声皴纹」程序化生成，追求皱、漏、瘦、透；
 * 黄石以层理块体拼叠；含主峰群、洞壑、蹬道、峡谷、池岸石矶与庭园特置峰石。
 * 跌水 / 溪流的位置通过 ctx.waterfalls / ctx.streams 交给 water.js 生成水面。
 */
import * as THREE from 'three';
import {
  boxGeo, transform, tube, lathe, clamp, smooth, fbm, mulberry32, rr,
  WORLD, waterSDF, terrainHeight, POOLS, ISLES,
} from './core.js';
import { put } from './arch.js';

/** 3D 近似噪声：以多组可平铺 2D fbm 组合出三向变化 */
function n3(x, y, z, s) {
  return fbm(x + s * 0.13, y + s * 0.07, s, 3)
       * 0.5 + fbm(z + s * 0.21, y + s * 0.17, s + 71, 3) * 0.5;
}
function gyroid(x, y, z, f, phase) {
  const a = x * f + phase, b = y * f + phase * 0.7, c = z * f + phase * 1.3;
  return Math.sin(a) * Math.cos(b) + Math.sin(b) * Math.cos(c) + Math.sin(c) * Math.cos(a);
}

/** 生成一块太湖石：细分球面 + 噪声位移 + gyroid 孔洞筛选 */
export function taihuGeo(seed, w, h, d, opts = {}) {
  const rnd = mulberry32(seed);
  const detail = opts.detail ?? 4;
  const base = new THREE.IcosahedronGeometry(1, detail);
  const src = base.index ? base.toNonIndexed() : base;
  const sp = src.getAttribute('position');
  const n = sp.count;
  const pos = new Float32Array(n * 3);
  const phase = rnd() * Math.PI * 2;
  const f = (opts.holeFreq ?? 2.5) / Math.min(w, h, d);
  const amp = opts.amp ?? 0.34;
  const pitF = opts.pitFreq ?? 2.7;
  for (let i = 0; i < n; i++) {
    const nx = sp.getX(i), ny = sp.getY(i), nz = sp.getZ(i);
    const q = n3(nx * 1.7 + seed * 0.01, ny * 1.7, nz * 1.7, seed % 997);
    const ridge = Math.sin(nx * 8.5 + phase) * Math.sin(ny * 7.1 - phase) * Math.sin(nz * 6.3 + phase);
    // gyroid 零等值面处形成深涡孔与沟壑，保持封闭实体（避免碎裂成三角片）
    const g = Math.abs(gyroid(nx * pitF, ny * pitF, nz * pitF, 1, phase));
    const pit = 1 - smooth(0.05, 0.46, g);
    const wrinkle = Math.sin(nx * 13.0 + phase) * Math.sin(ny * 11.0 - phase)
                  * Math.sin(nz * 12.0 + phase * 0.6) * 0.07;
    const r = 1 + (q - 0.5) * amp * 2 + ridge * 0.10 + wrinkle - pit * 0.32;
    pos[i * 3] = nx * r * w * 0.5;
    pos[i * 3 + 1] = ny * r * h * 0.5;
    pos[i * 3 + 2] = nz * r * d * 0.5;
  }
  // 仅少量三角面被穿透，形成「漏、透」的零星孔洞，主体仍是完整石体
  const pierce = opts.pierce ?? 0.075;
  const keep = [];
  for (let i = 0; i < n; i += 3) {
    const cx = (pos[i * 3] + pos[(i + 1) * 3] + pos[(i + 2) * 3]) / 3;
    const cy = (pos[i * 3 + 1] + pos[(i + 1) * 3 + 1] + pos[(i + 2) * 3 + 1]) / 3;
    const cz = (pos[i * 3 + 2] + pos[(i + 1) * 3 + 2] + pos[(i + 2) * 3 + 2]) / 3;
    const g = Math.abs(gyroid(cx, cy, cz, f, phase));
    if (g > pierce || rnd() > 0.35) {
      for (let k = 0; k < 3; k++) {
        keep.push(pos[(i + k) * 3], pos[(i + k) * 3 + 1], pos[(i + k) * 3 + 2]);
      }
    }
  }
  const out = new THREE.BufferGeometry();
  const arr = new Float32Array(keep);
  out.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  const uv = new Float32Array((arr.length / 3) * 2);
  for (let i = 0; i < arr.length / 3; i++) {
    uv[i * 2] = arr[i * 3] * 0.34 + arr[i * 3 + 2] * 0.12;
    uv[i * 2 + 1] = arr[i * 3 + 1] * 0.34;
  }
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.computeVertexNormals();
  if (src !== base) src.dispose();
  base.dispose();
  return out;
}

/** 黄石层理块体 */
export function huangshiGeo(seed, w, h, d) {
  const rnd = mulberry32(seed);
  const g = new THREE.BoxGeometry(w, h, d, 5, 5, 4).toNonIndexed();
  const p = g.getAttribute('position');
  const phase = rnd() * 6.28;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const layer = Math.sin(y * 5.2 + phase) * 0.055;
    const n = n3(x, y, z, seed % 331);
    p.setXYZ(i, x + (n - 0.5) * 0.16 + layer, y + (n - 0.5) * 0.08, z + (n - 0.5) * 0.16 - layer);
  }
  p.needsUpdate = true;
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w * 0.32, uv.getY(i) * h * 0.32);
  g.computeVertexNormals();
  return g;
}

function stone(ctx, geo, mat, x, y, z, rot = [0, 0, 0], lod = 0) {
  put(ctx.B, geo, mat, [x, y, z], rot, lod);
}

/** 主峰群：(-62,-40) 一带，最高 9.6 m */
function buildMainPeaks(ctx) {
  const { M } = ctx;
  const prog = ctx.onProgress || (() => {});
  const cx = -64, cz = -40;
  // 山体基底：以灰白湖石与条石层叠，避免大面积黄砂岩破坏江南山石灰调
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI * 2 / 12;
    const r = 12.4 + Math.sin(i * 2.1) * 2.0;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    stone(ctx, huangshiGeo(900 + i, 5.2 + (i % 3), 1.6 + (i % 4) * 0.42, 4.2 + (i % 3)),
      i % 3 === 0 ? M.stoneDark : M.taihuDark, x, 0.42, z, [0, a, 0]);
  }
  // 太湖石主峰群（分层堆叠，越高越瘦）
  const peaks = [
    { x: cx, z: cz, w: 9.5, h: 9.2, d: 8.0, y: 4.4, s: 1 },
    { x: cx - 5.0, z: cz + 3.0, w: 7.0, h: 7.0, d: 6.2, y: 3.3, s: 2 },
    { x: cx + 5.2, z: cz + 1.8, w: 6.6, h: 6.4, d: 6.0, y: 3.0, s: 3 },
    { x: cx + 2.0, z: cz - 5.0, w: 7.4, h: 6.8, d: 6.4, y: 3.2, s: 4 },
    { x: cx - 4.0, z: cz - 5.4, w: 6.2, h: 5.6, d: 5.4, y: 2.7, s: 5 },
    { x: cx - 9.0, z: cz - 1.0, w: 5.4, h: 4.8, d: 5.0, y: 2.3, s: 6 },
    { x: cx + 9.0, z: cz - 3.0, w: 5.0, h: 4.4, d: 4.6, y: 2.1, s: 7 },
    { x: cx + 1.0, z: cz + 6.5, w: 5.8, h: 4.2, d: 5.0, y: 2.0, s: 8 },
    { x: cx - 8.0, z: cz + 7.0, w: 4.6, h: 3.6, d: 4.4, y: 1.7, s: 9 },
  ];
  peaks.forEach((p, i) => {
    const g = taihuGeo(1100 + p.s * 37, p.w, p.h, p.d, { detail: 4, hole: 0.46, amp: 0.36 });
    stone(ctx, g, i < 3 ? M.taihu : M.taihuDark, p.x, p.y, p.z, [0, p.s * 0.7, p.s * 0.04]);
    prog((i + 1) / (peaks.length + 12), `叠石主峰 ${i + 1}`);
  });
  // 次级配峰与散石（近景细节层，LOD 可剔除）
  const rnd = mulberry32(2024);
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2, r = 6 + rnd() * 15;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    if (waterSDF(x, z) < -0.6) continue;
    const w = 1.2 + rnd() * 3.0, h = 1.0 + rnd() * 2.8;
    const g = taihuGeo(2200 + i * 17, w, h, w * (0.7 + rnd() * 0.5), { detail: 3, hole: 0.58, amp: 0.40 });
    stone(ctx, g, M.taihuDark, x, h * 0.38, z, [rnd() * 0.2, rnd() * 6.28, rnd() * 0.2], i < 10 ? 1 : 2);
  }
  // 崖壁沟壑与皴纹线（苔痕）
  for (let i = 0; i < 18; i++) {
    const a = rnd() * Math.PI * 2, r = 3 + rnd() * 11;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    stone(ctx, new THREE.IcosahedronGeometry(0.35 + rnd() * 0.45, 1), M.moss,
      x, 0.8 + rnd() * 2.2, z, [0, rnd() * 6.28, 0], 1);
  }
  // 洞壑：两块巨石之间以暗色内腔与券口石表达
  const caveX = cx - 2.0, caveZ = cz + 8.6;
  stone(ctx, new THREE.SphereGeometry(2.1, 12, 8), M.ink, caveX, 1.55, caveZ);
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (i + 0.5) / 9;
    stone(ctx, huangshiGeo(3300 + i, 1.0, 0.65, 0.7), M.huangshi,
      caveX - Math.cos(a) * 2.35, 1.3 + Math.sin(a) * 2.1, caveZ + 0.35, [0, 0, -a + Math.PI / 2], 1);
  }
  // 蹬道：从水湾 (-46,-18) 盘旋至山顶 (-64,-40)
  const path = [
    [-46, -18], [-50, -22], [-53, -26], [-55, -30], [-58, -33],
    [-61, -36], [-64, -38], [-67, -40], [-64, -43], [-62, -40],
  ];
  for (let i = 0; i < path.length - 1; i++) {
    const [x1, z1] = path[i], [x2, z2] = path[i + 1];
    const steps = 5;
    const y0 = 0.35 + i * 0.72, y1 = 0.35 + (i + 1) * 0.72;
    for (let k = 0; k < steps; k++) {
      const t = (k + 0.5) / steps;
      const x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
      const y = y0 + (y1 - y0) * t;
      const a = -Math.atan2(z2 - z1, x2 - x1);
      stone(ctx, boxGeo(1.9, 0.16, 0.72, 0.5), M.huangshi, x, y, z, [0, a, 0]);
    }
  }
  // 峡谷两侧岩壁
  for (let i = 0; i < 8; i++) {
    const x = -50 - i * 1.5, z = -22 - i * 1.8;
    const h = 2.4 + i * 0.42;
    const g = taihuGeo(4400 + i, 3.2, h, 2.6, { detail: 3, hole: 0.62, amp: 0.30 });
    stone(ctx, g, M.taihuDark, x - 2.4, h * 0.42, z, [0, i * 0.5, 0]);
    stone(ctx, taihuGeo(4500 + i, 2.8, h * 0.8, 2.4, { detail: 3, hole: 0.62, amp: 0.30 }),
      M.taihuDark, x + 2.4, h * 0.34, z + 1.0, [0, i * 0.6, 0]);
  }
  // 跌水与山涧（位置交给 water.js）
  ctx.waterfalls.push({ x: -53.2, z: -30.5, yTop: 5.8, yBottom: -0.30, width: 2.5, depth: 0.35 });
  ctx.waterfalls.push({ x: -47.5, z: -22.0, yTop: 2.4, yBottom: -0.30, width: 1.5, depth: 0.25 });
  ctx.streams.push({ points: [[-53, -30], [-50, -26], [-47, -22], [-44, -18]], width: 1.8 });
}

/** 池岸：沿水系等值线布置黄石驳岸、太湖石石矶与湿苔 */
function buildShore(ctx) {
  const { M } = ctx;
  const rnd = mulberry32(7717);
  // 沿园墙内水岸采样（角度采样 + 椭圆参数）
  const samples = [];
  POOLS.forEach((p, pi) => {
    const N = pi === 0 ? 96 : 40;
    for (let i = 0; i < N; i++) {
      const a = i * Math.PI * 2 / N + rnd() * 0.02;
      const jitter = 1 + (rnd() - 0.5) * 0.10;
      const x = p.x + Math.cos(a) * p.rx * jitter;
      const z = p.z + Math.sin(a) * p.rz * jitter;
      if (waterSDF(x, z) > -1.6 && waterSDF(x, z) < 1.6) samples.push([x, z, a]);
    }
  });
  samples.forEach(([x, z, a], i) => {
    if (rnd() < 0.16) return;
    const w = 1.0 + rnd() * 1.5, h = 0.45 + rnd() * 0.75;
    // 条石驳岸
    stone(ctx, boxGeo(w, h, 0.75, 0.55), i % 3 === 0 ? M.stoneDark : M.huangshi,
      x, h * 0.22 - 0.10, z, [0, -a + Math.PI / 2, 0]);
    if (i % 7 === 0) {
      // 石矶：稍大的太湖石挑出水面
      const g = taihuGeo(6100 + i, 1.6 + rnd() * 1.3, 1.1 + rnd() * 1.2, 1.4 + rnd(),
        { detail: 3, hole: 0.60, amp: 0.38 });
      stone(ctx, g, M.taihuDark, x + Math.cos(a) * 0.9, 0.42, z + Math.sin(a) * 0.9, [0, rnd() * 6.28, 0], 1);
    }
    if (i % 5 === 0) {
      stone(ctx, new THREE.IcosahedronGeometry(0.24 + rnd() * 0.2, 1), M.moss,
        x, 0.32, z, [0, rnd() * 6.28, 0], 1);
    }
  });
  // 岛屿岸壁加石
  ISLES.forEach((is, k) => {
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI * 2 / 16;
      const x = is.x + Math.cos(a) * (is.rx + 0.35), z = is.z + Math.sin(a) * (is.rz + 0.35);
      stone(ctx, huangshiGeo(7000 + k * 20 + i, 1.5, 0.7 + (i % 3) * 0.18, 0.9), M.huangshi,
        x, 0.05, z, [0, -a, 0]);
    }
  });
}

/** 庭园特置峰石与小品（冠云峰式立峰、石笋、石桌凳） */
function buildFeatureStones(ctx) {
  const { B, M } = ctx;
  const features = [
    { x: -93, z: 52, h: 4.6, w: 2.1, d: 1.7, seed: 801 },   // 竹里馆入口立峰（避开框景视线）
    { x: -22, z: 42, h: 3.4, w: 1.8, d: 1.5, seed: 802 },   // 前庭东隅
    { x: 24, z: 44, h: 3.8, w: 2.0, d: 1.6, seed: 803 },    // 前庭西隅
    { x: 74, z: -40, h: 4.1, w: 2.3, d: 1.9, seed: 804 },   // 小山丛桂
    { x: 28, z: -18, h: 5.2, w: 2.6, d: 2.1, seed: 805 },   // 瀛洲岛主峰
    { x: -34, z: -24, h: 3.2, w: 1.6, d: 1.4, seed: 806 },  // 方丈岛
    { x: 62, z: 18, h: 3.0, w: 1.7, d: 1.4, seed: 807 },    // 荷池东岸
    { x: -70, z: 8, h: 3.6, w: 2.0, d: 1.6, seed: 808 },    // 漱石枕流
  ];
  features.forEach(f => {
    const g = taihuGeo(f.seed, f.w, f.h, f.d, { detail: 4, hole: 0.42, amp: 0.32, holeFreq: 2.1 });
    stone(ctx, g, M.taihu, f.x, f.h * 0.47, f.z, [0, f.seed * 0.01, 0]);
    // 石座
    stone(ctx, new THREE.CylinderGeometry(f.w * 0.72, f.w * 0.85, 0.36, 10), M.stoneDark, f.x, 0.18, f.z);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      stone(ctx, new THREE.IcosahedronGeometry(0.30 + i * 0.05, 1), M.moss,
        f.x + Math.cos(a) * f.w * 0.7, 0.30, f.z + Math.sin(a) * f.d * 0.7, [0, a, 0], 1);
    }
  });
  // 石桌石凳（竹里馆 / 扇面亭旁）
  [[-88, 38], [72, -50], [-40, 16]].forEach(([x, z], i) => {
    stone(ctx, new THREE.CylinderGeometry(0.85, 0.72, 0.16, 12), M.stone, x, 0.76, z, [0, 0, 0], 1);
    stone(ctx, new THREE.CylinderGeometry(0.20, 0.30, 0.70, 8), M.stoneDark, x, 0.36, z, [0, 0, 0], 1);
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + 0.4;
      stone(ctx, new THREE.CylinderGeometry(0.30, 0.32, 0.42, 8), M.stoneDark,
        x + Math.cos(a) * 1.4, 0.21, z + Math.sin(a) * 1.4, [0, 0, 0], 1);
    }
  });
}

export function buildRockery(ctx) {
  if (!ctx.waterfalls) ctx.waterfalls = [];
  if (!ctx.streams) ctx.streams = [];
  const prog = ctx.onProgress || (() => {});
  prog(0.02, '太湖石主峰群');
  buildMainPeaks(ctx);
  prog(0.62, '池岸驳岸与石矶');
  buildShore(ctx);
  prog(0.84, '庭园特置峰石');
  buildFeatureStones(ctx);
  prog(1, '假山叠石完成');
}
