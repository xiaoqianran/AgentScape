/* 良渚 · 水城 —— 外围水利系统
 * 11 条人工坝：6 条谷口高坝（坝顶 30–35 m、相对高 10–15 m、底宽近 100 m）、
 * 4 条平原低坝（坝顶约 10 m、长 35–360 m）、1 条山前长堤塘山（5 km，
 * 西段矩尺形单坝 / 中段南北双坝夹 7.6 m 渠底 / 东段单坝）。
 * 断面严格按「青淤泥基础 → 草裹泥坝芯 → 纯黄土外壳 → 块石/卵石护坡」分层，
 * 老虎岭、鲤鱼山设考古探沟式剖面并附高程标尺。
 */
import * as THREE from 'three';
import {
  SURVEY, WORLD, boxGeo, put, sweepProfile, clamp, lerp, mulberry32,
} from './core.js';
import { HIGH_DAMS, LOW_DAMS, TANGSHAN, HILLOCKS } from './hydro.js';
import { makeElevationRuler } from './detail.js';

const rnd = mulberry32(47005100);
const rr = (a, b) => a + (b - a) * rnd();

function axisPath(x, z, ang, len, step = 8) {
  const n = Math.max(3, Math.round(len / step));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n - 0.5) * len;
    out.push([x + Math.cos(ang) * t, z + Math.sin(ang) * t]);
  }
  return out;
}
function linePath(x1, z1, x2, z2, step = 10) {
  const len = Math.hypot(x2 - x1, z2 - z1), n = Math.max(3, Math.round(len / step));
  const out = [];
  for (let i = 0; i <= n; i++) out.push([x1 + (x2 - x1) * i / n, z1 + (z2 - z1) * i / n]);
  return out;
}
function offsetPath(path, delta) {
  return path.map((p, i) => {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    return [p[0] - tz * delta, p[1] + tx * delta];
  });
}
function damProfile(baseW, crestW, baseY, crest) {
  const hb = baseW / 2, hc = crestW / 2;
  return [
    [-hb, baseY],
    [-hb * 0.78, lerp(baseY, crest, 0.16)],
    [-hc, crest],
    [hc, crest],
    [hb * 0.78, lerp(baseY, crest, 0.16)],
    [hb, baseY],
  ];
}
function damColor(j, u, y, i, dist) {
  const h = (y - SURVEY.lowDam.crest) * 0;
  return h;
}
function colorFor(baseY, crest) {
  return (j, u, y, i, dist) => {
    const h = clamp((y - baseY) / Math.max(0.1, crest - baseY), 0, 1);
    if (h < 0.14) return [0.48, 0.50, 0.47];                    // 块石 / 卵石护坡
    if (h > 0.91) return [0.66, 0.78, 0.52];                    // 坝顶草被
    const lam = 0.79 + 0.21 * (0.5 + 0.5 * Math.sin(y * 5.6 + Math.sin(dist * 0.07) * 0.8));
    return [lam, lam * 0.94, lam * 0.80];                        // 纯黄土外壳夯层
  };
}

/** 生成一条坝，返回剖面盖面几何供考古探沟使用 */
function buildDam(B, M, revet, cfg, opts = {}) {
  const path = cfg.path;
  const profile = damProfile(cfg.baseW, cfg.crestW, cfg.baseY, cfg.crest);
  const capUV = (u, y) => [u * 0.045, clamp((y - cfg.baseY) / (cfg.crest - cfg.baseY), 0, 1)];
  const sw = sweepProfile(path, profile, {
    colorFn: colorFor(cfg.baseY, cfg.crest), capUV, uvU: 0.13, uvV: 0.13,
  });
  put(B, sw.surface, M.yellowClay);
  sw.caps.forEach(g => put(B, g, M.strata));
  /* 迎水面块石护坡 + 坝脚卵石 */
  for (let i = 0; i < path.length; i += 2) {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const nx = -tz, nz = tx;
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
      const u = s * (cfg.crestW / 2 + 3 + k * (cfg.baseW / 2 - cfg.crestW / 2) / 3 + rr(-1.2, 1.2));
      const y = cfg.baseY + (cfg.crest - cfg.baseY) * (1 - k / 3) * 0.72 + rr(-0.3, 0.3);
      revet.push({ x: path[i][0] + nx * u, y: y + 0.18, z: path[i][1] + nz * u, s: rr(0.38, 1.15) });
    }
  }
  return sw;
}

/** 考古探沟：在坝体中段切开 16 m 缺口，露出完整坝体断面与草裹泥坝芯 */
function buildCutaway(B, M, revet, cfg, gapCenter, onProgress) {
  const len = cfg.len;
  const half = len / 2, gap = 16;
  const a0 = -half, a1 = gapCenter - gap / 2, a2 = gapCenter + gap / 2, a3 = half;
  const seg = (t0, t1) => {
    const n = Math.max(3, Math.round((t1 - t0) / 7)), out = [];
    for (let i = 0; i <= n; i++) {
      const t = t0 + (t1 - t0) * i / n;
      out.push([cfg.x + Math.cos(cfg.ang) * t, cfg.z + Math.sin(cfg.ang) * t]);
    }
    return out;
  };
  const left = { ...cfg, path: seg(a0, a1) }, right = { ...cfg, path: seg(a2, a3) };
  const swL = buildDam(B, M, revet, left);
  const swR = buildDam(B, M, revet, right);
  /* 探沟底：青淤泥 / 砂砾基础 */
  const floor = boxGeo(gap, 0.18, cfg.baseW * 0.72);
  put(B, floor, M.blueSilt,
    [cfg.x + Math.cos(cfg.ang) * gapCenter, cfg.baseY - 0.08, cfg.z + Math.sin(cfg.ang) * gapCenter],
    [0, -cfg.ang, 0]);
  /* 草裹泥坝芯：纵横交错的草包块体，沿断面两侧堆垒 */
  const ca = Math.cos(cfg.ang), sa = Math.sin(cfg.ang);
  for (let row = 0; row < 5; row++) for (let k = 0; k < 7; k++) {
    const u = -cfg.baseW * 0.30 + k * (cfg.baseW * 0.60 / 7);
    const y = cfg.baseY + 0.9 + row * 1.35;
    if (y > cfg.crest - 1.6) continue;
    for (const side of [-1, 1]) {
      const t = gapCenter + side * (gap / 2 - 0.9);
      const x = cfg.x + ca * t - sa * u, z = cfg.z + sa * t + ca * u;
      put(B, boxGeo(1.9, 1.05, 2.4, 0.5), M.grassMud, [x, y, z], [0, -cfg.ang, 0]);
    }
  }
  /* 西端剖面外侧：草裹泥工艺展示堆（考古探沟常见的一坨坨草包） */
  for (let row = 0; row < 4; row++) for (let k = 0; k < 6; k++) {
    const t = a0 - 5 - k * 2.5;
    const u = 31 + row * 8.2;
    const x = cfg.x + ca * t - sa * u, z = cfg.z + sa * t + ca * u;
    put(B, boxGeo(2.3, 0.92, 2.6, 0.5), M.grassMud,
      [x, cfg.baseY + 0.55 + row * 0.94, z], [0, -cfg.ang, 0]);
  }
  /* 高程标尺与地层标签柱 */
  const rx = cfg.x + ca * (gapCenter - gap / 2 - 3) - sa * (cfg.baseW / 2 + 3);
  const rz = cfg.z + sa * (gapCenter - gap / 2 - 3) + ca * (cfg.baseW / 2 + 3);
  makeElevationRuler(B, M, rx, cfg.baseY, rz, cfg.crest - cfg.baseY, 2);
  /* 探沟两侧挡土木板 */
  for (const side of [-1, 1]) {
    const t = gapCenter + side * (gap / 2 + 1.2);
    put(B, boxGeo(gap * 0.1, 1.6, cfg.baseW * 0.78), M.darkWood,
      [cfg.x + ca * t, cfg.baseY + 0.8, cfg.z + sa * t], [0, -cfg.ang, 0]);
  }
  onProgress && onProgress();
}

function buildHighDams(B, M, revet, onProgress) {
  HIGH_DAMS.forEach((d, i) => {
    const cfg = {
      x: d.x, z: d.z, ang: d.ang, len: d.len,
      crest: d.crest, baseY: d.baseY, baseW: d.baseW, crestW: d.crestW,
      path: axisPath(d.x, d.z, d.ang, d.len),
    };
    if (d.id === 'lhl') buildCutaway(B, M, revet, cfg, 6, () => {});   // 老虎岭标准剖面
    else buildDam(B, M, revet, cfg);
    onProgress((i + 1) / HIGH_DAMS.length * 0.5, `${d.group} · ${d.name}`);
  });
}
function buildLowDams(B, M, revet, onProgress) {
  LOW_DAMS.forEach((d, i) => {
    const ang = Math.atan2(d.z2 - d.z1, d.x2 - d.x1);
    const cx = (d.x1 + d.x2) / 2, cz = (d.z1 + d.z2) / 2;
    const len = Math.hypot(d.x2 - d.x1, d.z2 - d.z1);
    const cfg = { x: cx, z: cz, ang, len, crest: d.crest, baseY: d.baseY,
      baseW: d.baseW, crestW: d.crestW, path: linePath(d.x1, d.z1, d.x2, d.z2) };
    if (d.id === 'lys') buildCutaway(B, M, revet, cfg, 0, () => {});   // 鲤鱼山剖面
    else buildDam(B, M, revet, cfg);
    onProgress(0.5 + (i + 1) / LOW_DAMS.length * 0.25, `平原低坝 · ${d.name}`);
  });
}

function buildTangshan(B, M, revet, onProgress) {
  const T = TANGSHAN;
  const cfgFor = (path, crest, baseW = T.baseW, crestW = T.crestW) => ({
    path, crest, baseY: T.channelBottom, baseW, crestW,
  });
  /* 西段：矩尺形单层坝 */
  T.west.forEach((p, i) => {
    if (i === T.west.length - 1) return;
    const path = linePath(p[0], p[1], T.west[i + 1][0], T.west[i + 1][1], 12);
    buildDam(B, M, revet, cfgFor(path, 15.5, 42, 15));
  });
  /* 中段：南北双坝 + 20–30 m 间距渠道 */
  const gapHalf = (T.gap + T.baseW) / 2;      // 两坝中心间距 = 渠宽 + 单坝底宽
  const north = offsetPath(T.middle, -gapHalf);
  const south = offsetPath(T.middle, gapHalf);
  buildDam(B, M, revet, cfgFor(north, T.northCrest));
  buildDam(B, M, revet, cfgFor(south, T.southCrest));
  /* 渠底青淤泥与岸边木桩 */
  for (let i = 0; i < T.middle.length - 1; i++) {
    const a = T.middle[i], b = T.middle[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ang = -Math.atan2(b[1] - a[1], b[0] - a[0]);
    put(B, boxGeo(len + 2, 0.12, T.gap - 2), M.blueSilt,
      [(a[0] + b[0]) / 2, T.channelBottom + 0.05, (a[1] + b[1]) / 2], [0, ang, 0]);
  }
  /* 东段：单坝 */
  T.east.forEach((p, i) => {
    if (i === T.east.length - 1) return;
    const path = linePath(p[0], p[1], T.east[i + 1][0], T.east[i + 1][1], 12);
    buildDam(B, M, revet, cfgFor(path, 14.0, 42, 15));
  });
  /* 东段末端剖面标尺：标注 7.6 / 13.5 / 17.5 m 三级高程 */
  const e = T.middle[2];
  makeElevationRuler(B, M, e[0] - 70, T.channelBottom, e[1] - 60, T.northCrest - T.channelBottom, 2);
  onProgress(0.92, '塘山长堤 5 km / 双坝渠道');
}

/** 谷口山体间的天然溢洪道与孤丘连接段（低模体量） */
function buildValleyLinks(B, M, onProgress) {
  /* 高坝两端与山体衔接的堆筑过渡段 */
  HIGH_DAMS.forEach(d => {
    for (const s of [-1, 1]) {
      const t = s * (d.len / 2 + 24);
      const x = d.x + Math.cos(d.ang) * t, z = d.z + Math.sin(d.ang) * t;
      put(B, boxGeo(46, 5.5, 68), M.yellowClay, [x, d.baseY + 2.4, z], [0, -d.ang, 0]);
    }
  });
  onProgress(1.0, '谷口衔接段与溢洪道');
}

export function buildDams(ctx) {
  const { B, M, revet } = ctx;
  const cb = ctx.onProgress || (() => {});
  buildHighDams(B, M, revet, (p, n) => cb(p * 0.42, n));
  buildLowDams(B, M, revet, (p, n) => cb(0.42 + p * 0.28, n));
  buildTangshan(B, M, revet, (p, n) => cb(0.70 + p * 0.24, n));
  buildValleyLinks(B, M, (p, n) => cb(0.94 + p * 0.06, n));
}

export const DAM_LABELS = [
  ...HIGH_DAMS.map(d => ({ name: `${d.name}坝 · ${d.crest.toFixed(1)} m`, x: d.x, y: d.crest, z: d.z })),
  ...LOW_DAMS.map(d => ({ name: `${d.name}坝 · 10.0 m`, x: (d.x1 + d.x2) / 2, y: 10, z: (d.z1 + d.z2) / 2 })),
  { name: '塘山长堤 · 双坝 17.5 / 13.5 m', x: -2200, y: 17.5, z: -2880 },
];
