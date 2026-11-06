/* 吴苑澄观 · 建筑与景区组装
 * 前朝 190 m 礼序中轴 + 后苑「一池三山」九个园中园景区；
 * 含厅、堂、楼、阁、亭（四角/六角/扇面）、榭、舫、廊（水廊/曲廊/爬山廊）、
 * 桥（九曲/拱桥/廊桥）、门楼、云墙、漏窗、月洞门与园外借景北寺塔。
 */
import * as THREE from 'three';
import {
  boxGeo, transform, tube, lathe, extrudePolygon, clamp, mulberry32, rr,
  WORLD, waterSDF, terrainHeight,
} from './core.js';
import {
  put, roofGeo, addHipRoof, addPyramidRoof, addColumn, addDougong, addGeWindow,
  addGualuo, addRailing, addWall, addLeakWindowCore, addMoonGate, addBrickGate,
  addPavingPatch, addLantern, makePlaque, addStoneLantern,
} from './arch.js';

const P = (ctx, geo, mat, pos, rot = [0, 0, 0], lod = 0, opts = {}) => put(ctx.B, geo, mat, pos, rot, lod, opts);

function plaque(ctx, text, pos, rotY = 0, w = 2.8, h = 0.72, maxLevel = 1) {
  const m = makePlaque(text, w, h);
  m.position.set(pos[0], pos[1], pos[2]);
  m.rotation.y = rotY;
  ctx.scene.add(m);
  ctx.plaques.push(m);
  if (ctx.lod) ctx.lod.addDetail(m, pos, 0.5, maxLevel);
}

/* ------------------------------------------------------------------ *
 * 建筑原型
 * ------------------------------------------------------------------ */
/** 厅堂：台基 + 柱列 + 粉墙 + 格扇 + 斗拱挂落 + 歇山/卷棚顶 + 月台 */
function hall(ctx, o) {
  const { B, M } = ctx;
  const x = o.x, z = o.z, w = o.w, d = o.d;
  const base = o.base ?? 0.86, colH = o.colH ?? 5.6, eaveY = base + colH;
  const rot = o.rot ?? 0, face = o.face ?? -1;   // face=-1 正面朝北（-Z）
  const bays = o.bays ?? 5;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const G = (g, m, px, py, pz, L = 0, r2 = [0, 0, 0], op = {}) =>
    P(ctx, g, m, [x + px * cs + pz * sn, py, z - px * sn + pz * cs], [r2[0], rot + r2[1], r2[2]], L, op);

  // 台基与踏跺
  G(boxGeo(w + 1.6, base, d + 1.6, 0.4), M.stone, 0, base / 2, 0);
  G(boxGeo(w + 1.9, 0.12, d + 1.9, 0.4), M.stoneDark, 0, base - 0.04, 0);
  G(boxGeo(w + 2.2, 0.10, d + 2.2, 0.4), M.graybrick, 0, 0.05, 0);
  const steps = 4;
  for (let s = 0; s < steps; s++) {
    G(boxGeo(o.stairW ?? 5.2, 0.16, 0.52), M.stone,
      0, base - (s + 0.5) * base / steps, -face * (d / 2 + 0.85 + s * 0.5));
  }
  // 柱列（前后檐 + 山面）
  const xs = [], zs = [-d / 2, d / 2];
  for (let i = 0; i <= bays; i++) xs.push(-w / 2 + i * w / bays);
  const colAt = (px, pz, r = 0.17) => {
    G(new THREE.CylinderGeometry(r * 0.92, r, colH, 10), M.wood, px, base + colH / 2, pz);
    G(new THREE.CylinderGeometry(r * 1.42, r * 1.55, 0.12, 10), M.stone, px, base + 0.06, pz);
    G(new THREE.CylinderGeometry(r * 1.18, r * 1.05, 0.10, 10), M.darkWood, px, eaveY - 0.05, pz, 1);
  };
  for (const px of xs) for (const pz of zs) colAt(px, pz);
  for (const pz of [-d / 4, d / 4]) for (const px of [-w / 2, w / 2]) colAt(px, pz, 0.15);
  // 檐枋（四周）
  G(boxGeo(w + 0.5, 0.28, 0.24), M.wood, 0, eaveY - 0.22, -d / 2);
  G(boxGeo(w + 0.5, 0.28, 0.24), M.wood, 0, eaveY - 0.22, d / 2);
  G(boxGeo(0.24, 0.28, d + 0.4), M.wood, -w / 2, eaveY - 0.22, 0);
  G(boxGeo(0.24, 0.28, d + 0.4), M.wood, w / 2, eaveY - 0.22, 0);
  // 斗拱（L0 细节）
  if (o.dougong !== false) {
    for (const px of xs) for (const pz of zs) {
      const wx = x + px * cs + pz * sn, wz = z - px * sn + pz * cs;
      addDougong(B, M, wx, eaveY - 0.16, wz, 1, 1);
    }
  }
  // 墙体：两山墙 + 背立面
  G(boxGeo(0.30, colH - 0.3, d - 0.5), M.plaster, -w / 2, base + (colH - 0.3) / 2, 0);
  G(boxGeo(0.30, colH - 0.3, d - 0.5), M.plaster, w / 2, base + (colH - 0.3) / 2, 0);
  G(boxGeo(w - 0.4, colH - 0.3, 0.30), M.plaster, 0, base + (colH - 0.3) / 2, -face * d / 2);
  // 背立面方窗
  for (let i = 1; i < bays; i += 2) {
    const px = -w / 2 + i * w / bays;
    G(boxGeo(1.5, 1.6, 0.12), M.darkWood, px, base + colH * 0.55, -face * d / 2 - 0.02, 2);
    G(boxGeo(1.35, 1.45, 0.06), M.paper, px, base + colH * 0.55, -face * d / 2 - 0.09, 2);
  }
  // 正面整排格扇长窗
  if (o.windows !== false) {
    for (let i = 0; i < bays; i++) {
      const px = -w / 2 + (i + 0.5) * w / bays;
      const wx = x + px * cs + (face * d / 2) * sn;
      const wz = z - px * sn + (face * d / 2) * cs;
      addGeWindow(B, M, {
        x: wx, y: base + colH * 0.50, z: wz,
        w: w / bays - 0.22, h: colH - 0.55, rot,
        pattern: i % 3 === 0 ? 'binglie' : 'jin',
      });
    }
    // 挂落
    for (let i = 0; i < bays; i++) {
      const px = -w / 2 + (i + 0.5) * w / bays;
      const wx = x + px * cs + (face * d / 2) * sn;
      const wz = z - px * sn + (face * d / 2) * cs;
      addGualuo(B, M, wx, eaveY - 0.52, wz, w / bays - 0.2, rot, 1);
    }
  }
  // 屋顶
  addHipRoof(B, M, {
    cx: x, cz: z, w: w + 1.8, d: d + 1.8, eaveY, rise: o.rise ?? 3.2,
    lift: o.lift ?? 0.70, type: o.type ?? 'xieshan', rot,
    tileMat: o.tileMat || M.tile, nx: o.nx ?? 44, nz: o.nz ?? 28,
  });
  // 匾额与灯笼
  if (o.name) {
    const pz = face * (d / 2 + 0.36);
    plaque(ctx, o.name, [x + pz * sn, eaveY - 0.72, z + pz * cs],
      rot + (face === -1 ? Math.PI : 0), o.plaqueW ?? 2.8, 0.72);
  }
  for (const s of [-1, 1]) {
    const px = s * (w / 2 - 0.8), pz = face * (d / 2 + 0.25);
    addLantern(B, M, x + px * cs + pz * sn, eaveY - 0.72, z - px * sn + pz * cs, 0.9, 1);
  }
  // 月台 / 临水平台
  if (o.terrace) {
    const tz = face * (d / 2 + o.terrace.d / 2 + 0.2);
    G(boxGeo(w + 2.4, 0.24, o.terrace.d, 0.4), M.stone, 0, base - 0.02, tz);
    G(boxGeo(w + 2.4, 0.10, o.terrace.d + 0.2, 0.4), M.paving, 0, base + 0.14, tz, 1);
    const wx1 = x + (-w / 2) * cs + (face * (d / 2 + o.terrace.d)) * sn;
    const wz1 = z - (-w / 2) * sn + (face * (d / 2 + o.terrace.d)) * cs;
    const wx2 = x + (w / 2) * cs + (face * (d / 2 + o.terrace.d)) * sn;
    const wz2 = z - (w / 2) * sn + (face * (d / 2 + o.terrace.d)) * cs;
    addRailing(B, M, { x1: wx1, z1: wz1, x2: wx2, z2: wz2, y: base + 0.14, kind: o.terrace.rail || 'stone' });
  }
  return { x, z, w, d, eaveY, rot, face };
}
/** 两层楼阁（见山楼）：一层厅 + 二层四周外廊 + 歇山顶 */
function twoStorey(ctx, o) {
  const { B, M } = ctx;
  const { x, z } = o, rot = o.rot ?? 0, face = o.face ?? -1;
  const w1 = o.w, d1 = o.d, base = 0.9, h1 = o.h1 ?? 5.4, e1 = base + h1;
  const w2 = w1 - 3.2, d2 = d1 - 2.4, h2 = o.h2 ?? 4.2, e2 = e1 + h2;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const G = (g, m, px, py, pz, L = 0, r2 = [0, 0, 0]) =>
    P(ctx, g, m, [x + px * cs + pz * sn, py, z - px * sn + pz * cs], [r2[0], rot + r2[1], r2[2]], L);
  // 一层
  G(boxGeo(w1 + 1.8, base, d1 + 1.8), M.stone, 0, base / 2, 0);
  G(boxGeo(w1, h1, d1), M.plaster, 0, base + h1 / 2, 0);
  G(boxGeo(w1 + 0.6, 0.30, d1 + 0.6), M.wood, 0, e1 - 0.18, 0);
  for (let i = 0; i <= 5; i++) {
    const px = -w1 / 2 + i * w1 / 5;
    for (const pz of [-d1 / 2, d1 / 2]) addColumn(B, M, x + px * cs + pz * sn, base, z - px * sn + pz * cs, h1, 0.17, M.wood, 0);
  }
  // 一层腰檐（四面披檐）
  G(roofGeo(w1 / 2 + 1.15, d1 / 2 + 1.15, 0, 1.35, { lift: 0.42, eave: 0.5, nx: 40, nz: 26 }), M.tile, 0, e1 - 0.15, 0);
  // 二层
  G(boxGeo(w2, h2, d2), M.plaster, 0, e1 + h2 / 2, 0);
  G(boxGeo(w2 + 0.5, 0.28, d2 + 0.5), M.wood, 0, e2 - 0.18, 0);
  for (let i = 0; i <= 4; i++) {
    const px = -w2 / 2 + i * w2 / 4;
    for (const pz of [-d2 / 2, d2 / 2]) addColumn(B, M, x + px * cs + pz * sn, e1, z - px * sn + pz * cs, h2, 0.15, M.wood, 0);
    addGeWindow(B, M, {
      x: x + px * cs + (-d2 / 2) * sn, y: e1 + h2 * 0.52, z: z - px * sn + (-d2 / 2) * cs,
      w: w2 / 4 - 0.24, h: h2 - 0.6, rot, pattern: 'jin',
    });
  }
  // 二层外廊与栏杆（制高点俯瞰站位点）
  G(boxGeo(w1 + 1.4, 0.18, d1 + 1.4), M.woodPale, 0, e1 + 0.06, 0);
  const railY = e1 + 0.16;
  for (const [a, b, c, e] of [
    [-w1 / 2 - 0.6, -d1 / 2 - 0.6, w1 / 2 + 0.6, -d1 / 2 - 0.6],
    [-w1 / 2 - 0.6, d1 / 2 + 0.6, w1 / 2 + 0.6, d1 / 2 + 0.6],
    [-w1 / 2 - 0.6, -d1 / 2 - 0.6, -w1 / 2 - 0.6, d1 / 2 + 0.6],
    [w1 / 2 + 0.6, -d1 / 2 - 0.6, w1 / 2 + 0.6, d1 / 2 + 0.6],
  ]) {
    addRailing(B, M, {
      x1: x + a * cs + b * sn, z1: z - a * sn + b * cs,
      x2: x + c * cs + e * sn, z2: z - c * sn + e * cs, y: railY, kind: 'mei',
    });
  }
  // 屋顶
  addHipRoof(B, M, { cx: x, cz: z, w: w2 + 2.2, d: d2 + 2.2, eaveY: e2, rise: o.rise ?? 3.0, lift: 0.66, type: 'xieshan', rot });
  plaque(ctx, o.name || '见山楼',
    [x + (face * (d2 / 2 + 0.4)) * sn, e2 - 0.74, z + (face * (d2 / 2 + 0.4)) * cs],
    rot + (face === -1 ? Math.PI : 0), 3.0, 0.78);
  for (const s of [-1, 1]) {
    const px = s * (w2 / 2 - 0.5), pz = face * (d2 / 2 + 0.2);
    addLantern(B, M, x + px * cs + pz * sn, e2 - 0.7, z - px * sn + pz * cs, 0.85, 1);
  }
  return { e1, e2 };
}

/** 亭：四角 / 六角 / 八角攒尖，可带坐凳与美人靠 */
function pavilion(ctx, o) {
  const { B, M } = ctx;
  const { x, z } = o, sides = o.sides ?? 4, r = o.r ?? 3.2;
  const base = o.base ?? 0.45, colH = o.colH ?? 3.4, eaveY = base + colH;
  const rot = o.rot ?? 0;
  // 台基
  P(ctx, new THREE.CylinderGeometry(r + 0.45, r + 0.55, base, sides === 4 ? 8 : sides), M.stone, [x, base / 2, z], [0, rot, 0]);
  P(ctx, new THREE.CylinderGeometry(r + 0.30, r + 0.36, 0.10, sides === 4 ? 8 : sides), M.stoneDark, [x, base + 0.02, z], [0, rot, 0]);
  // 柱
  for (let i = 0; i < sides; i++) {
    const a = rot + Math.PI / sides + i * Math.PI * 2 / sides;
    addColumn(B, M, x + Math.cos(a) * r * 0.86, base, z + Math.sin(a) * r * 0.86, colH, 0.14, o.woodMat || M.wood, 0);
  }
  // 檐枋 + 斗拱 + 挂落
  for (let i = 0; i < sides; i++) {
    const a0 = rot + Math.PI / sides + i * Math.PI * 2 / sides;
    const a1 = rot + Math.PI / sides + (i + 1) * Math.PI * 2 / sides;
    const p0 = [x + Math.cos(a0) * r * 0.86, z + Math.sin(a0) * r * 0.86];
    const p1 = [x + Math.cos(a1) * r * 0.86, z + Math.sin(a1) * r * 0.86];
    const mx = (p0[0] + p1[0]) / 2, mz = (p0[1] + p1[1]) / 2;
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const ang = -Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
    P(ctx, boxGeo(len, 0.24, 0.20), M.wood, [mx, eaveY - 0.20, mz], [0, ang, 0]);
    addGualuo(B, M, mx, eaveY - 0.48, mz, len - 0.25, ang, 1);
    if (o.rail !== false && i < sides) {
      addRailing(B, M, {
        x1: p0[0], z1: p0[1], x2: p1[0], z2: p1[1], y: base + 0.06,
        kind: 'mei', segments: 3,
      });
    }
    addDougong(B, M, p0[0], eaveY - 0.12, p0[1], 0.78, 1);
  }
  addPyramidRoof(B, M, { cx: x, cy: eaveY, cz: z, r: r + 0.9, rise: o.rise ?? r * 0.82, lift: o.lift ?? 0.55, sides, rot, rings: 8, steps: 8 });
  if (o.name) {
    const off = r * 0.88;
    plaque(ctx, o.name, [x + Math.sin(rot) * off, eaveY - 0.62, z + Math.cos(rot) * off], rot, 1.9, 0.52);
  }
  return { eaveY };
}

/** 水榭：临水低台基 + 卷棚歇山 + 美人靠 */
function watersideXie(ctx, o) {
  const h = hall(ctx, {
    x: o.x, z: o.z, w: o.w ?? 12, d: o.d ?? 6.4, base: 0.42, colH: 3.7,
    rise: 1.85, lift: 0.42, bays: 3, rot: o.rot ?? 0, face: o.face ?? -1,
    name: o.name, type: 'xieshan', dougong: false, windows: true,
    terrace: { d: 2.6, rail: 'mei' }, nx: 32, nz: 20,
  });
  return h;
}

/** 石舫「不系舟」：船身石台 + 前舱 / 中舱 / 后舱楼 + 卷棚顶 */
function stoneBoat(ctx, o) {
  const { B, M } = ctx;
  const x = o.x, z = o.z, rot = o.rot ?? 0;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const G = (g, m, px, py, pz, L = 0, r2 = [0, 0, 0]) =>
    P(ctx, g, m, [x + px * cs + pz * sn, py, z - px * sn + pz * cs], [r2[0], rot + r2[1], r2[2]], L);
  // 船身：前窄后宽的花岗岩船体
  const hull = extrudePolygon([
    [-9.0, -1.5], [-7.4, -2.35], [5.6, -2.35], [8.8, -1.15],
    [9.4, 0], [8.8, 1.15], [5.6, 2.35], [-7.4, 2.35], [-9.0, 1.5],
  ], 0.72);
  G(hull, M.stone, 0, -0.28, 0, 0, [-Math.PI / 2, 0, 0]);
  G(boxGeo(16.5, 0.18, 4.6), M.woodPale, 0, 0.52, 0);
  // 船首石雕与缆桩
  for (const s of [-1, 1]) {
    G(new THREE.CylinderGeometry(0.16, 0.20, 0.85, 8), M.stoneDark, 7.2, 0.85, s * 1.55, 1);
    G(new THREE.SphereGeometry(0.20, 8, 6), M.stoneDark, 7.2, 1.30, s * 1.55, 1);
  }
  // 中舱（低）
  G(boxGeo(7.6, 2.6, 3.8), M.plaster, -0.6, 1.9, 0);
  for (let i = 0; i < 4; i++) {
    G(boxGeo(1.45, 1.7, 0.08), M.darkWood, -3.5 + i * 1.9, 2.0, 1.92, 2);
    G(boxGeo(1.32, 1.55, 0.05), M.paper, -3.5 + i * 1.9, 2.0, 1.97, 2);
  }
  G(roofGeo(4.7, 2.5, 0, 1.25, { lift: 0.34, eave: 0.5, nx: 32, nz: 20 }), M.tile, -0.6, 3.25, 0, 0, [0, 0, 0]);
  // 后舱楼（高）
  G(boxGeo(5.2, 3.3, 3.9), M.plaster, 5.0, 2.25, 0);
  G(roofGeo(3.3, 2.5, 0, 1.55, { lift: 0.40, eave: 0.5, nx: 28, nz: 18 }), M.tile, 5.0, 3.92, 0);
  for (let i = 0; i < 3; i++) {
    G(boxGeo(1.25, 1.9, 0.08), M.darkWood, 3.6 + i * 1.45, 2.35, 1.98, 2);
    G(boxGeo(1.12, 1.75, 0.05), M.paper, 3.6 + i * 1.45, 2.35, 2.03, 2);
  }
  // 舷侧美人靠
  for (const s of [-1, 1]) {
    addRailing(B, M, {
      x1: x + (-6.5) * cs + (s * 2.1) * sn, z1: z - (-6.5) * sn + (s * 2.1) * cs,
      x2: x + (2.6) * cs + (s * 2.1) * sn, z2: z - (2.6) * sn + (s * 2.1) * cs,
      y: 0.62, kind: 'mei',
    });
  }
  plaque(ctx, o.name || '不系舟', [x + 0 * cs + 2.02 * sn, 2.9, z + 2.02 * cs], rot, 1.9, 0.55);
}

/** 廊：沿折线生成柱列、铺地、卷棚屋面、挂落与美人靠 */
function corridor(ctx, points, o = {}) {
  const { B, M } = ctx;
  const width = o.width ?? 2.5, colH = o.colH ?? 2.9, rise = o.rise ?? 0.85;
  for (let s = 0; s < points.length - 1; s++) {
    const [x1, z1] = points[s], [x2, z2] = points[s + 1];
    const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz);
    if (len < 0.5) continue;
    const a = Math.atan2(dz, dx), rot = -a;
    const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
    const y0 = o.y0 ?? 0.18;
    P(ctx, boxGeo(len + 0.2, 0.14, width + 0.3, 0.45), M.paving, [mx, y0, mz], [0, rot, 0], 0, { noShadow: true });
    P(ctx, boxGeo(len + 0.2, 0.22, width + 0.5), M.graybrick, [mx, y0 - 0.12, mz], [0, rot, 0]);
    // 柱
    const n = Math.max(2, Math.round(len / 2.8));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const px = x1 + dx * t, pz = z1 + dz * t;
      for (const side of [-1, 1]) {
        const wx = px - Math.sin(a) * side * width / 2, wz = pz + Math.cos(a) * side * width / 2;
        P(ctx, new THREE.CylinderGeometry(0.11, 0.12, colH, 8), M.wood, [wx, y0 + colH / 2, wz]);
        P(ctx, new THREE.CylinderGeometry(0.19, 0.21, 0.10, 8), M.stone, [wx, y0 + 0.05, wz]);
      }
    }
    P(ctx, boxGeo(len, 0.20, 0.16), M.wood, [mx, y0 + colH - 0.14, mz - Math.cos(a) * width / 2], [0, rot, 0]);
    P(ctx, boxGeo(len, 0.20, 0.16), M.wood, [mx, y0 + colH - 0.14, mz + Math.cos(a) * width / 2], [0, rot, 0]);
    // 美人靠（单侧或双侧）
    const sideList = o.bothRails === false ? [1] : [-1, 1];
    for (const side of sideList) {
      addRailing(B, M, {
        x1: x1 - Math.sin(a) * side * width / 2, z1: z1 + Math.cos(a) * side * width / 2,
        x2: x2 - Math.sin(a) * side * width / 2, z2: z2 + Math.cos(a) * side * width / 2,
        y: y0, kind: 'mei',
      });
    }
    // 挂落
    for (const side of [-1, 1]) {
      const wx = mx - Math.sin(a) * side * width / 2, wz = mz + Math.cos(a) * side * width / 2;
      addGualuo(B, M, wx, y0 + colH - 0.48, wz, len - 0.2, rot, 1);
    }
    // 卷棚小屋顶
    addHipRoof(B, M, {
      cx: mx, cz: mz, w: len + 0.7, d: width + 0.8, eaveY: y0 + colH,
      rise, lift: 0.22, eave: 0.45, type: 'juanpeng', rot,
      nx: Math.max(12, Math.round(len * 1.4)), nz: 12,
    });
  }
}

/** 九折石桥 */
function zigzagBridge(ctx, points, o = {}) {
  const { B, M } = ctx;
  const y = o.y ?? 0.38, width = o.width ?? 1.9;
  for (let s = 0; s < points.length - 1; s++) {
    const [x1, z1] = points[s], [x2, z2] = points[s + 1];
    const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz);
    const a = Math.atan2(dz, dx), rot = -a;
    const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
    P(ctx, boxGeo(len + 0.25, 0.20, width), M.stone, [mx, y, mz], [0, rot, 0]);
    P(ctx, boxGeo(len + 0.25, 0.06, width - 0.16), M.stoneDark, [mx, y + 0.13, mz], [0, rot, 0], 1);
    for (const side of [-1, 1]) {
      addRailing(B, M, {
        x1: x1 - Math.sin(a) * side * width / 2, z1: z1 + Math.cos(a) * side * width / 2,
        x2: x2 - Math.sin(a) * side * width / 2, z2: z2 + Math.cos(a) * side * width / 2,
        y: y + 0.10, kind: 'stone', segments: Math.max(2, Math.round(len / 1.6)),
      });
    }
    // 桥墩
    for (const t of [0.15, 0.85]) {
      P(ctx, new THREE.CylinderGeometry(0.26, 0.32, y + 0.9, 8), M.stoneDark,
        [x1 + dx * t, (y - 0.9) / 2, z1 + dz * t]);
    }
  }
}

/** 拱桥（半圆券 + 弧面桥身） */
function archBridge(ctx, o) {
  const { B, M } = ctx;
  const { x, z, len = 12, w = 2.8, rot = 0, rise = 2.0 } = o;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const G = (g, m, px, py, pz, L = 0, r2 = [0, 0, 0]) =>
    P(ctx, g, m, [x + px * cs + pz * sn, py, z - px * sn + pz * cs], [r2[0], rot + r2[1], r2[2]], L);
  // 桥券（半圆拱石）
  const N = 16;
  for (let i = 0; i < N; i++) {
    const a0 = Math.PI * i / N, a1 = Math.PI * (i + 1) / N;
    const px = ((a0 + a1) / 2 - Math.PI / 2) / (Math.PI / 2) * (len / 2);
    const py = Math.sin((a0 + a1) / 2) * rise * 0.62;
    G(boxGeo(len / N + 0.12, 0.34, w + 0.3), M.stoneDark, px, py - 0.3, 0, 0, [0, 0, -(a0 + a1) / 2 + Math.PI / 2]);
  }
  // 弧面桥面
  const M2 = 14;
  for (let i = 0; i < M2; i++) {
    const t0 = i / M2, t1 = (i + 1) / M2;
    const p0 = (t0 - 0.5) * len, p1 = (t1 - 0.5) * len;
    const y0 = 0.42 + (1 - Math.pow((t0 - 0.5) * 2, 2)) * rise * 0.55;
    const y1 = 0.42 + (1 - Math.pow((t1 - 0.5) * 2, 2)) * rise * 0.55;
    const seg = boxGeo(Math.hypot(p1 - p0, y1 - y0), 0.20, w);
    G(seg, M.stone, (p0 + p1) / 2, (y0 + y1) / 2, 0, 0, [0, 0, Math.atan2(y1 - y0, p1 - p0)]);
  }
  // 栏杆沿弧线
  for (const side of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push([x + ((t - 0.5) * len) * cs + (side * w / 2) * sn,
        0.55 + (1 - Math.pow((t - 0.5) * 2, 2)) * rise * 0.55,
        z - ((t - 0.5) * len) * sn + (side * w / 2) * cs]);
    }
    P(ctx, tube(pts, 0.075, 20, 6), M.marble, [0, 0, 0], [0, 0, 0], 1);
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      G(boxGeo(0.10, 0.72, 0.10), M.marble, (t - 0.5) * len, 0.9 + (1 - Math.pow((t - 0.5) * 2, 2)) * rise * 0.55, side * w / 2, 1);
    }
  }
}

/* ------------------------------------------------------------------ *
 * 园外借景：北寺塔（八角九层，76 m）与远村（LOD 三档）
 * ------------------------------------------------------------------ */
function buildPagoda(ctx) {
  const { M } = ctx;
  const [tx, tz] = WORLD.borrowPagoda;
  const levels = [new THREE.Group(), new THREE.Group(), new THREE.Group()];
  levels.forEach((g, i) => { g.name = 'borrowPagoda_L' + i; ctx.scene.add(g); });

  const B0 = [], B1 = [];
  const add = (arr, geo, mat, pos, rot = [0, 0, 0]) =>
    arr.push({ geo, mat, matrix: transform([tx + pos[0], pos[1], tz + pos[2]], rot) });
  const R0 = 7.2, floors = 9, floorH = 7.1;
  // 台基
  for (const arr of [B0, B1]) {
    add(arr, new THREE.CylinderGeometry(R0 + 1.6, R0 + 2.0, 1.2, 8), M.stone, [0, 0.6, 0]);
    add(arr, new THREE.CylinderGeometry(R0 + 1.0, R0 + 1.4, 0.7, 8), M.graybrick, [0, 1.55, 0]);
  }
  for (let f = 0; f < floors; f++) {
    const y = 2.0 + f * floorH;
    const r = R0 - f * 0.50;
    const h = 4.9;
    for (const arr of [B0, B1]) {
      add(arr, new THREE.CylinderGeometry(r, r * 1.03, h, 8), M.plasterWarm, [0, y + h / 2, 0], [0, Math.PI / 8, 0]);
      add(arr, new THREE.CylinderGeometry(r + 0.28, r + 0.28, 0.36, 8), M.wood, [0, y + h - 0.1, 0], [0, Math.PI / 8, 0]);
      // 平座与腰檐
      add(arr, new THREE.CylinderGeometry(r + 1.05, r + 0.8, 0.32, 8), M.graybrick, [0, y + h + 0.12, 0], [0, Math.PI / 8, 0]);
      const roof = require_pyramid(r + 1.5, 1.5, 8);
      add(arr, roof, M.tile, [0, y + h + 0.28, 0]);
    }
    // L0 细节：门窗、平座栏杆、角铃、瓦当
    for (let k = 0; k < 8; k++) {
      const a = Math.PI / 8 + k * Math.PI / 4;
      add(B0, boxGeo(1.05, 2.5, 0.14), M.darkWood, [Math.cos(a) * (r + 0.03), y + 2.7, Math.sin(a) * (r + 0.03)], [0, -a + Math.PI / 2, 0]);
      add(B0, boxGeo(0.9, 2.3, 0.08), M.paper, [Math.cos(a) * (r + 0.12), y + 2.7, Math.sin(a) * (r + 0.12)], [0, -a + Math.PI / 2, 0]);
      add(B0, boxGeo(0.10, 0.95, 0.10), M.marble, [Math.cos(a) * (r + 0.9), y + h + 0.62, Math.sin(a) * (r + 0.9)]);
      add(B0, new THREE.SphereGeometry(0.11, 6, 5), M.gold, [Math.cos(a) * (r + 1.42), y + h + 0.38, Math.sin(a) * (r + 1.42)]);
    }
    add(B0, boxGeo((r + 1.0) * 1.7, 0.09, 0.10), M.marble, [0, y + h + 0.82, 0]);
  }
  // 塔刹
  const topY = 2.0 + floors * floorH;
  for (const arr of [B0, B1]) {
    add(arr, new THREE.CylinderGeometry(1.5, 2.4, 1.1, 8), M.graybrick, [0, topY + 0.5, 0]);
    add(arr, lathe([[0.55, 0], [0.85, 1.0], [0.55, 2.0], [0.95, 3.0], [0.4, 4.0], [0.22, 5.4], [0.05, 6.2]], 12), M.gold, [0, topY + 1.1, 0]);
  }
  // L3 剪影
  const B2 = [];
  add(B2, new THREE.CylinderGeometry(4.6, 7.0, topY, 8), M.plasterWarm, [0, topY / 2, 0]);
  for (let f = 0; f < floors; f++) {
    const r = R0 + 1.4 - f * 0.52;
    add(B2, new THREE.ConeGeometry(r, 1.9, 8), M.tile, [0, 2.0 + f * floorH + 5.5, 0], [0, Math.PI / 8, 0]);
  }
  add(B2, lathe([[0.5, 0], [0.8, 1.0], [0.3, 3.0], [0.05, 6.0]], 10), M.gold, [0, topY + 1.0, 0]);

  [B0, B1, B2].forEach((arr, i) => {
    const batch = new (ctx.BatchClass)(64);
    arr.forEach(e => batch.add(e.geo, e.mat, e.matrix, { noZone: true }));
    const st = batch.build(levels[i]);
    levels[i].userData.stats = st;
  });
  // 塔是核心借景：距离按 0.16 权重折算，使园内 300–420 m 视距仍落在 L2（九层中模）
  if (ctx.lod) ctx.lod.addLevels(levels, [tx, 30, tz], 10, { distanceScale: 0.16 });
  return { levels, height: topY + 7.2 };
}
/* 轻量攒尖几何（避免重复 import 造成循环） */
function require_pyramid(r, rise, sides) {
  return new THREE.CylinderGeometry(0.15, r, rise, sides, 1, false);
}

/** 园外村落剪影（借景层，LOD L2/L3） */
function buildVillage(ctx) {
  const { M } = ctx;
  const houses = [
    [-170, -210, 12, 7], [-148, -224, 9, 6], [-196, -232, 14, 8],
    [-120, -196, 10, 6], [-215, -258, 11, 7], [-88, -188, 8, 5],
    [128, -206, 12, 6], [152, -224, 9, 6],
  ];
  const B = new (ctx.BatchClass)(80);
  houses.forEach(([hx, hz, w, d], i) => {
    const y = terrainHeight(hx, hz);
    B.add(boxGeo(w, 4.2, d, 0.35), M.plasterWarm, transform([hx, y + 2.1, hz]));
    const rg = roofGeo(w / 2 + 0.5, d / 2 + 0.5, 0, 1.5, { lift: 0.25, eave: 0.4, nx: 14, nz: 10 });
    B.add(rg, M.tile, transform([hx, y + 4.2, hz]));
    B.add(boxGeo(1.1, 2.0, 0.10), M.darkWood, transform([hx, y + 1.0, hz + d / 2 + 0.02]), { lod: 2 });
  });
  const g = new THREE.Group(); g.name = 'borrowVillage'; ctx.scene.add(g);
  B.build(g);
  if (ctx.lod) ctx.lod.addDetail(g, [-160, 4, -220], 45, 3);
}

/* ------------------------------------------------------------------ *
 * 景区总装
 * ------------------------------------------------------------------ */
export function buildBuildings(ctx) {
  const { B, M } = ctx;
  const prog = ctx.onProgress || (() => {});

  /* —— 景区 1：澄观门庭（前朝礼序中轴，Z 95 → 40） —— */
  prog(0.05, '入口礼序中轴与照壁');
  addPavingPatch(B, M, 0, 104, 30, 18, 0.06);
  // 八字影壁：中轴留通廊，仅以矮石屏作前景障景，保证宫门与礼序纵深可见
  addWall(B, M, { x1: -14, z1: 108, x2: -9, z2: 105, h: 3.8, t: 0.6, mat: M.graybrick });
  addWall(B, M, { x1: 9, z1: 105, x2: 14, z2: 108, h: 3.8, t: 0.6, mat: M.graybrick });
  addWall(B, M, { x1: -4.5, z1: 104, x2: 4.5, z2: 104, h: 0.82, t: 0.7, mat: M.stoneDark });
  P(ctx, boxGeo(7.6, 0.16, 1.1), M.stone, [0, 0.92, 104]);
  for (const s of [-1, 1]) P(ctx, lathe([[0.32, 0], [0.42, 0.22], [0.20, 0.72], [0.06, 1.02]], 12),
    M.stoneDark, [s * 3.0, 0.98, 104], [0, 0, 0], 1);
  addBrickGate(B, M, { x: 0, y: 0, z: 92, w: 14, h: 6.4 });
  plaque(ctx, '吴苑', [0, 5.55, 92.6], 0, 2.2, 0.62);
  addPavingPatch(B, M, 0, 84, 22, 12, 0.06);
  // 轿厅
  hall(ctx, { x: 0, z: 80, w: 20, d: 8, base: 0.6, colH: 4.6, rise: 2.4, bays: 5, face: 1, rot: 0, dougong: false, windows: false, nx: 34, nz: 20 });
  // 前庭
  addPavingPatch(B, M, 0, 68, 30, 16, 0.05);
  for (const s of [-1, 1]) {
    addStoneLantern(B, M, s * 9, 0.1, 68);
    P(ctx, boxGeo(3.2, 0.36, 3.2), M.stoneDark, [s * 9, 0.18, 68]);
  }
  // 东西廊庑
  corridor(ctx, [[-24, 72], [-24, 58]], { width: 2.2, colH: 2.8, bothRails: false });
  corridor(ctx, [[24, 72], [24, 58]], { width: 2.2, colH: 2.8, bothRails: false });
  // 澄观堂（前朝主殿）
  hall(ctx, {
    x: 0, z: 58, w: 28, d: 12, base: 1.12, colH: 6.4, rise: 3.9, lift: 0.85,
    bays: 5, face: 1, name: '澄观堂', plaqueW: 3.4, stairW: 6.4,
    type: 'xieshan', nx: 48, nz: 30,
  });
  addPavingPatch(B, M, 0, 46, 26, 10, 0.05);
  prog(0.20, '远香堂与南岸堂榭');

  /* —— 景区 2：涵碧堂榭（南岸主体建筑群） —— */
  // 远香堂（全园主体厅堂，正面朝北临水）
  hall(ctx, {
    x: 0, z: 30, w: 24, d: 10.5, base: 0.92, colH: 5.8, rise: 3.5, lift: 0.78,
    bays: 5, face: -1, name: '远香堂', plaqueW: 3.2, type: 'xieshan',
    terrace: { d: 4.2, rail: 'stone' }, nx: 48, nz: 30,
  });
  // 南岸水廊分东西两段，中段 X ∈ [−18, 18] 留空，
  // 保证远香堂临水正面与「一池三山」定点视角的视线通廊不被廊屋遮挡
  corridor(ctx, [[-56, 25], [-34, 24], [-18, 24]],
    { width: 2.5, colH: 3.0, rise: 0.9, bothRails: false });
  corridor(ctx, [[18, 24], [30, 23], [52, 21]],
    { width: 2.5, colH: 3.0, rise: 0.9, bothRails: false });
  // 涵碧榭（西南临水水榭）
  watersideXie(ctx, { x: -30, z: 18, w: 11, d: 6, face: -1, name: '涵碧榭' });
  // 东岸小轩
  hall(ctx, { x: 58, z: 26, w: 9, d: 6, base: 0.5, colH: 3.9, rise: 2.0, bays: 3, face: -1, rot: 0, dougong: false, name: '听松轩', nx: 28, nz: 18 });
  prog(0.34, '一池三山：岛屿、曲桥与石舫');

  /* —— 景区 3：一池三山（核心水景） —— */
  // 三岛岸壁与登岛平台
  const isles = [
    { x: -8, z: -12, r: 11.0, name: '蓬莱' },
    { x: -34, z: -24, r: 6.8, name: '方丈' },
    { x: 28, z: -18, r: 7.0, name: '瀛洲' },
  ];
  isles.forEach((is, k) => {
    P(ctx, new THREE.CylinderGeometry(is.r, is.r + 0.5, 1.15, 20), M.huangshi, [is.x, -0.35, is.z]);
    P(ctx, new THREE.CylinderGeometry(is.r - 0.5, is.r - 0.2, 0.25, 20), M.ground, [is.x, 0.30, is.z], [0, 0, 0], 0, {});
    const N = 22;
    for (let i = 0; i < N; i++) {
      const a = i * Math.PI * 2 / N;
      P(ctx, boxGeo(2.1, 0.42 + (i % 3) * 0.07, 0.9), M.stoneDark,
        [is.x + Math.cos(a) * (is.r + 0.15), 0.12, is.z + Math.sin(a) * (is.r + 0.15)], [0, -a, 0]);
    }
  });
  // 蓬莱 · 雪香云蔚亭（六角，对景焦点）
  pavilion(ctx, { x: -8, z: -12, r: 3.5, sides: 6, base: 0.55, colH: 3.7, rise: 3.0, name: '雪香云蔚', lift: 0.62 });
  // 方丈 · 小四角亭
  pavilion(ctx, { x: -34, z: -24, r: 2.3, sides: 4, base: 0.42, colH: 2.9, rise: 2.2, name: '方丈' });
  // 瀛洲 · 石峰与梅（由 rockery/nature 补石与花木）
  // 九曲桥（南岸 → 荷风四面亭）
  zigzagBridge(ctx, [[28, 22], [33, 19], [36, 21], [39, 17], [42, 18], [44, 14], [46, 12], [44, 9]], { y: 0.34, width: 1.8 });
  // 拱桥（蓬莱 → 北岸）
  archBridge(ctx, { x: -8, z: -30, len: 15, w: 2.6, rot: Math.PI / 2, rise: 2.4 });
  // 平桥（南岸 → 蓬莱）：略偏东，避免正对水景定点机位形成遮挡
  zigzagBridge(ctx, [[4, 20], [1, 15], [-3, 7], [-8, -2]], { y: 0.40, width: 2.1 });
  // 不系舟石舫
  stoneBoat(ctx, { x: 38, z: -34, rot: -0.22, name: '不系舟' });
  prog(0.48, '北岸见山楼与东北秋色景区');

  /* —— 景区 9：见山楼（北岸制高点） —— */
  twoStorey(ctx, { x: 20, z: -60, w: 18, d: 10.5, h1: 5.4, h2: 4.2, rise: 3.1, face: -1, name: '见山楼' });
  addPavingPatch(B, M, 20, -52, 24, 8, 0.06);
  // 北岸石栏
  addRailing(B, M, { x1: 4, z1: -49.5, x2: 36, z2: -49.5, y: 0.3, kind: 'stone' });
  // 爬山廊（东北）
  corridor(ctx, [[44, -44], [52, -48], [58, -52], [64, -54]], { width: 2.2, colH: 2.8, rise: 0.8, bothRails: true });

  /* —— 景区 7：小山丛桂（东北秋色） —— */
  pavilion(ctx, { x: 68, z: -54, r: 3.0, sides: 4, rot: Math.PI / 6, base: 0.5, colH: 3.3, rise: 2.4, name: '与谁同坐' });
  addPavingPatch(B, M, 68, -54, 10, 10, 0.08);
  addWall(B, M, { x1: 52, z1: -74, x2: 92, z2: -74, h: 2.7, wave: { count: 3, amp: 0.35, phase: 0.4 } });

  /* —— 景区 4/8：云根叠翠（西北假山）与漱石枕流（西南水院） —— */
  prog(0.62, '云墙、漏窗、月洞门与小飞虹廊桥');
  // 山顶壑云亭
  pavilion(ctx, { x: -64, z: -40, r: 2.5, sides: 4, rot: 0.4, base: 0.4, colH: 2.8, rise: 2.1, name: '壑云' });
  // 小飞虹廊桥（跨西水湾）
  zigzagBridge(ctx, [[-56, 16], [-52, 13], [-48, 10], [-44, 6], [-40, 2]], { y: 0.42, width: 2.6 });
  corridor(ctx, [[-56, 16], [-52, 13], [-48, 10], [-44, 6], [-40, 2]], {
    width: 2.5, colH: 3.1, rise: 1.05, y0: 0.52, bothRails: true,
  });
  plaque(ctx, '小飞虹', [-48, 3.42, 11.0], 0, 1.9, 0.52);
  // 西南水院矮墙与石矶
  addWall(B, M, { x1: -98, z1: 16, x2: -70, z2: 16, h: 2.6, wave: { count: 2, amp: 0.4, phase: 1.0 } });
  addStoneLantern(B, M, -70, 0.1, 4);

  /* —— 景区 5/12：竹里馆（西南竹径院） —— */
  prog(0.74, '竹里馆框景院与园墙');
  // 院墙（带月洞门与漏窗）
  addMoonGate(B, M, { x: -80, z: 44, rot: 0, r: 1.5, h: 3.5, width: 12 });
  plaque(ctx, '延月', [-80, 3.28, 44.35], 0, 1.5, 0.46);
  // 两侧漏窗（在云墙上开窗：用带洞墙段）
  addWall(B, M, {
    x1: -96, z1: 44, x2: -87, z2: 44, h: 3.2,
    holes: [{ type: 'hex', x: 0, y: 1.05, r: 0.85 }],
  });
  addWall(B, M, {
    x1: -73, z1: 44, x2: -64, z2: 44, h: 3.2,
    holes: [{ type: 'rect', x: 0, y: 0.9, w: 1.5, h: 1.5 }],
  });
  addLeakWindowCore(B, M, { x: -91.5, y: 1.9, z: 44, w: 1.5, h: 1.5, kind: 'hex' });
  addLeakWindowCore(B, M, { x: -68.5, y: 1.65, z: 44, w: 1.5, h: 1.5, kind: 'binglie' });
  // 竹径铺地
  addPavingPatch(B, M, -84, 58, 4.2, 34, 0.05);
  for (let i = 0; i < 10; i++) {
    addPavingPatch(B, M, -84 + (i % 2 ? 0.5 : -0.5), 46 + i * 2.6, 3.2, 0.9, 0.055);
  }
  pavilion(ctx, { x: -82, z: 34, r: 2.8, sides: 6, base: 0.4, colH: 3.2, rise: 2.6, name: '听雨' });
  addWall(B, M, { x1: -100, z1: 30, x2: -100, z2: 66, h: 3.0, wave: { count: 2, amp: 0.3, phase: 0 } });
  // 北侧院墙中部留口，保证「延月洞门 → 云根叠翠主峰」的框景视线贯通
  addWall(B, M, { x1: -100, z1: 30, x2: -86, z2: 30, h: 2.8 });
  addWall(B, M, { x1: -72, z1: 30, x2: -66, z2: 30, h: 2.8 });

  /* —— 景区 6：荷风四面（东南荷池） —— */
  prog(0.84, '荷风四面亭与园墙闭合');
  pavilion(ctx, { x: 44, z: 6, r: 3.4, sides: 4, rot: Math.PI / 4, base: 0.5, colH: 3.5, rise: 2.7, name: '荷风四面' });
  P(ctx, new THREE.CylinderGeometry(4.2, 4.6, 0.95, 12), M.stone, [44, 0.05, 6]);
  // 东南曲墙
  addWall(B, M, { x1: 70, z1: 22, x2: 96, z2: 22, h: 2.8, wave: { count: 2, amp: 0.42, phase: 0.6 } });
  addWall(B, M, {
    x1: 84, z1: -6, x2: 84, z2: 22, h: 3.0,
    holes: [{ type: 'rect', x: 0, y: 0.9, w: 1.6, h: 1.5 }, { type: 'rect', x: 6, y: 0.9, w: 1.6, h: 1.5 }],
  });
  addLeakWindowCore(B, M, { x: 84, y: 1.65, z: 8, w: 1.6, h: 1.5, rot: Math.PI / 2, kind: 'wanzi' });
  addLeakWindowCore(B, M, { x: 84, y: 1.65, z: 14, w: 1.6, h: 1.5, rot: Math.PI / 2, kind: 'haitang' });

  /* —— 园墙闭合（云墙随地形起伏） —— */
  const wallSeg = (x1, z1, x2, z2, wave) => addWall(B, M, { x1, z1, x2, z2, h: 3.3, wave });
  wallSeg(-110, 95, -18, 95, { count: 2, amp: 0.32, phase: 0 });
  wallSeg(18, 95, 110, 95, { count: 2, amp: 0.32, phase: 1.2 });
  wallSeg(-110, -95, -30, -95, { count: 2, amp: 0.38, phase: 0.5 });
  wallSeg(-30, -95, 110, -95, { count: 3, amp: 0.38, phase: 1.7 });
  wallSeg(-110, -95, -110, 95, { count: 4, amp: 0.30, phase: 0.9 });
  wallSeg(110, -95, 110, 95, { count: 4, amp: 0.30, phase: 2.1 });
  // 园墙漏窗（临园外，形成框景序列）
  for (let i = 0; i < 6; i++) {
    const z = -72 + i * 24;
    addLeakWindowCore(B, M, { x: -110, y: 1.8, z, w: 1.4, h: 1.4, rot: Math.PI / 2, kind: ['binglie', 'wanzi', 'hex', 'haitang'][i % 4] });
  }

  /* —— 园外借景层：北寺塔与村落 —— */
  prog(0.94, '园外借景：北寺塔与远村');
  buildPagoda(ctx);
  buildVillage(ctx);

  prog(1.0, '建筑群构建完成');
}
