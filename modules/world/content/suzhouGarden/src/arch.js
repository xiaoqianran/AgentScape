/* 吴苑澄观 · 中式建筑语汇
 * 反宇曲面屋顶 / 飞檐翘角 / 筒瓦与脊饰 / 斗拱 / 柱础 / 格扇棂窗 /
 * 挂落雀替 / 美人靠 / 石栏 / 漏窗 / 月洞门 / 云墙 / 花街铺地 / 匾额楹联 / 灯笼。
 * lod 标记：0 = 核心体量（永不剔除）；1 = L0 专属细节；2 = L1 专属细节；3 = L2 专属细节。
 */
import * as THREE from 'three';
import {
  boxGeo, transform, tube, lathe, extrudePolygon, wallWithHoles, clamp, mulberry32,
} from './core.js';

/** 统一放置：几何 + 材质 + 位姿 + LOD 层 */
export function put(B, geo, mat, pos, rot = [0, 0, 0], lod = 0, opts = {}) {
  if (!geo) return;
  B.add(geo, mat, transform(pos, rot, opts.scale || [1, 1, 1]),
    { lod, noZone: !!opts.noZone, noShadow: !!opts.noShadow });
}

/* ------------------------------------------------------------------ *
 * 1. 反宇曲面屋顶（庑殿 / 歇山近似）与四角·六角·八角攒尖顶
 * ------------------------------------------------------------------ */
/** 屋面高度场：到正脊线段的水平距离决定举折，角部起翘 */
function roofHeight(x, z, hx, hz, eaveY, rise, lift) {
  const spineHalf = Math.max(0.2, hx - hz);
  const dx = Math.max(0, Math.abs(x) - spineHalf);
  const L = Math.hypot(dx, Math.abs(z));
  const t = clamp(L / hz, 0, 1.35);
  // 举折：靠近脊陡、靠近檐缓（反宇）
  let y = eaveY + rise * (1 - Math.pow(Math.min(t, 1), 1.42));
  y += 0.075 * Math.pow(t, 6) * rise;                     // 檐口反翘
  const cx = clamp((Math.abs(x) / hx - 0.62) / 0.38, 0, 1);
  const cz = clamp((Math.abs(z) / hz - 0.62) / 0.38, 0, 1);
  y += lift * cx * cx * cz * cz * Math.pow(Math.min(t, 1), 1.4);  // 飞檐翘角
  return y;
}

/** 生成屋面网格（局部坐标，已含绝对 eaveY），法线由 computeVertexNormals 求得 */
export function roofGeo(hx, hz, eaveY, rise, opts = {}) {
  const lift = opts.lift ?? 0.62, eave = opts.eave ?? 0.85;
  const nx = opts.nx ?? 48, nz = opts.nz ?? 32;
  const W = hx + eave, D = hz + eave;
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = -W + (i / nx) * 2 * W;
    const z = -D + (j / nz) * 2 * D;
    // 角部平面出挑
    const fx = clamp((Math.abs(x) / hx - 0.72) / 0.28, 0, 1);
    const fz = clamp((Math.abs(z) / hz - 0.72) / 0.28, 0, 1);
    const ex = x + Math.sign(x) * eave * 0.34 * fx * fz;
    const y = roofHeight(ex, z, hx, hz, eaveY, rise, lift);
    pos.push(ex, y, z);
    uv.push(ex * 0.5, z * 0.5);
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + nx + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 攒尖顶（亭 / 塔）：sides 条戗脊，角部起翘，中心宝顶 */
export function pyramidRoofGeo(r, eaveY, rise, sides = 4, opts = {}) {
  const lift = opts.lift ?? 0.52;
  const rings = opts.rings ?? 9, steps = opts.steps ?? 10;
  const pos = [], uv = [], idx = [];
  const rot = opts.rot ?? Math.PI / sides;
  for (let s = 0; s < sides; s++) {
    const a0 = rot + s * Math.PI * 2 / sides, a1 = rot + (s + 1) * Math.PI * 2 / sides;
    const bx = Math.cos(a0), bz = Math.sin(a0), cx = Math.cos(a1), cz = Math.sin(a1);
    const base = (s * (rings + 1)) * (steps + 1);
    for (let j = 0; j <= rings; j++) {
      const t = j / rings;                       // 0 中心 → 1 檐口
      const rad = r * t * (1 + 0.06 * t * t);
      for (let i = 0; i <= steps; i++) {
        const k = i / steps;
        const x = bx * (1 - k) * rad + cx * k * rad;
        const z = bz * (1 - k) * rad + cz * k * rad;
        // 角部（k 接近 0/1）起翘
        const cor = Math.pow(Math.max(0, 1 - Math.abs(k - 0.5) * 2), 3);
        const y = eaveY + rise * (1 - Math.pow(t, 1.45)) + lift * cor * Math.pow(t, 3.2);
        pos.push(x, y, z); uv.push(x * 0.5, z * 0.5);
      }
    }
    for (let j = 0; j < rings; j++) for (let i = 0; i < steps; i++) {
      const a = base + j * (steps + 1) + i, b = a + steps + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/** 完整坡屋顶：屋面 + 檐板 + 正脊 + 垂脊 + 鸱吻 + 瓦当滴水（细节分层） */
export function addHipRoof(B, M, o) {
  const cx = o.cx, cz = o.cz, w = o.w, d = o.d;
  const hx = w / 2, hz = d / 2;
  const eaveY = o.eaveY, rise = o.rise ?? Math.min(hx, hz) * 0.55;
  const lift = o.lift ?? 0.72, eave = o.eave ?? 0.9;
  const rotY = o.rot || 0;
  const lod = o.lod ?? 0;
  const cs = Math.cos(rotY), sn = Math.sin(rotY);
  const G = (g, m, p = [0, 0, 0], r = [0, 0, 0], L = lod, op = {}) =>
    put(B, g, m, [cx + p[0] * cs + p[2] * sn, eaveY + p[1], cz - p[0] * sn + p[2] * cs],
      [r[0], rotY + r[1], r[2]], L, op);
  // 屋面（局部 y 由 0 起算，整体由 G 抬升至檐口标高）
  const rg = roofGeo(hx, hz, 0, rise, { lift, eave, nx: o.nx ?? 46, nz: o.nz ?? 30 });
  G(rg, o.tileMat || M.tile);

  // 檐板（椽口木质封檐），四边
  const eb = 0.16;
  G(boxGeo(w + eave * 1.7, eb, 0.20), M.darkWood, [0, -0.12, -(hz + eave * 0.82)]);
  G(boxGeo(w + eave * 1.7, eb, 0.20), M.darkWood, [0, -0.12, (hz + eave * 0.82)]);
  G(boxGeo(0.20, eb, d + eave * 1.7), M.darkWood, [-(hx + eave * 0.82), -0.12, 0]);
  G(boxGeo(0.20, eb, d + eave * 1.7), M.darkWood, [(hx + eave * 0.82), -0.12, 0]);

  // 正脊（沿长边 X）与脊饰
  const spineHalf = Math.max(0.2, hx - hz);
  G(boxGeo(spineHalf * 2 + 0.5, 0.34, 0.42), M.ridge, [0, rise + 0.17, 0]);
  G(boxGeo(spineHalf * 2 + 0.7, 0.10, 0.56), M.tile, [0, rise + 0.37, 0]);
  for (const s of [-1, 1]) {
    // 鸱吻：简化为阶梯状吻兽体量
    G(boxGeo(0.62, 0.66, 0.50), M.ridge, [s * (spineHalf + 0.20), rise + 0.40, 0]);
    G(boxGeo(0.30, 0.42, 0.34), M.ridge, [s * (spineHalf + 0.48), rise + 0.74, 0], [0, 0, s * 0.35], 1);
    // 垂脊：正脊端点 → 四角（带起翘曲线）
    for (const sz of [-1, 1]) {
      const pts = [
        [s * spineHalf, rise + 0.16, 0],
        [s * (spineHalf + (hx - spineHalf) * 0.42), rise * 0.64, sz * hz * 0.44],
        [s * (hx + eave * 0.55), rise * 0.20 + lift * 0.36, sz * (hz + eave * 0.55)],
      ];
      const tg = tube(pts, 0.13, 12, 5);
      G(tg, M.ridge, [0, 0, 0]);
      // 脊兽（L0 细节）
      for (let k = 0; k < 3; k++) {
        const t = 0.35 + k * 0.22;
        G(new THREE.ConeGeometry(0.13 - k * 0.02, 0.30, 6), M.ridge,
          [s * (spineHalf + (hx - spineHalf) * t), rise * (1 - t * 0.8) + 0.22, sz * hz * t], [0, 0, s * 0.18], 1);
      }
    }
  }
  // 歇山山花（前后两端三角墙面 + 博风板）
  if (o.type === 'xieshan') {
    for (const sz of [-1, 1]) {
      const sh = extrudePolygon([[-hz * 0.98, 0], [hz * 0.98, 0], [0, rise * 0.50]], 0.16, 0);
      G(sh, M.plasterWarm, [0, rise * 0.46, sz * (hz * 0.02)], [0, Math.PI / 2, 0], 0, {});
      G(boxGeo(hz * 2.0, 0.12, 0.18), M.darkWood, [0, rise * 0.46, sz * (hz * 0.10)]);
    }
  }
  // 瓦当 / 滴水：仅 L0 可见
  const n = Math.floor((w + eave * 2) / 0.46);
  for (let i = 0; i < n; i++) {
    const x = -(hx + eave * 0.82) + (i + 0.5) * (2 * (hx + eave * 0.82)) / n;
    for (const sz of [-1, 1]) {
      G(new THREE.CylinderGeometry(0.075, 0.075, 0.10, 7), M.tileLight,
        [x, -0.19, sz * (hz + eave * 0.82)], [Math.PI / 2, 0, 0], 1, { noShadow: true });
    }
  }
  return { hx, hz, rise, eaveY, lift };
}

/** 攒尖顶完整构件 */
export function addPyramidRoof(B, M, o) {
  const cx = o.cx, cy = o.cy, cz = o.cz, r = o.r, sides = o.sides ?? 4;
  const rise = o.rise ?? r * 0.72, lift = o.lift ?? 0.55;
  const rot = o.rot ?? 0, cs = Math.cos(rot), sn = Math.sin(rot);
  const G = (g, m, p = [0, 0, 0], r2 = [0, 0, 0], L = o.lod ?? 0) =>
    put(B, g, m, [cx + p[0] * cs + p[2] * sn, cy + p[1], cz - p[0] * sn + p[2] * cs],
      [r2[0], rot + r2[1], r2[2]], L);
  const pg = pyramidRoofGeo(r, 0, rise, sides, { lift, rings: o.rings ?? 8, steps: o.steps ?? 8, rot: Math.PI / sides });
  G(pg, o.tileMat || M.tile);
  // 戗脊
  for (let s = 0; s < sides; s++) {
    const a = Math.PI / sides + s * Math.PI * 2 / sides;
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    const tg = tube([[0, rise, 0], [bx * 0.48, rise * 0.52, bz * 0.48], [bx * 1.02, lift * 0.55, bz * 1.02]], 0.09, 10, 5);
    G(tg, M.ridge);
  }
  // 宝顶
  G(lathe([[0.22, 0], [0.30, 0.16], [0.16, 0.42], [0.28, 0.62], [0.06, 1.10], [0, 1.22]], 12), M.gold, [0, rise - 0.02, 0]);
  // 檐板
  if (o.eaveBoard !== false) {
    for (let s = 0; s < sides; s++) {
      const a0 = Math.PI / sides + s * Math.PI * 2 / sides, a1 = Math.PI / sides + (s + 1) * Math.PI * 2 / sides;
      const mx = (Math.cos(a0) + Math.cos(a1)) / 2 * r, mz = (Math.sin(a0) + Math.sin(a1)) / 2 * r;
      const len = 2 * r * Math.sin(Math.PI / sides);
      G(boxGeo(len, 0.15, 0.16), M.darkWood, [mx, -0.11, mz], [0, -Math.atan2(mz, mx) + Math.PI / 2, 0]);
    }
  }
  // 瓦当
  if (o.lod === undefined || o.lod === 0) {
    for (let s = 0; s < sides; s++) {
      const a0 = Math.PI / sides + s * Math.PI * 2 / sides, a1 = Math.PI / sides + (s + 1) * Math.PI * 2 / sides;
      for (let k = 0; k < Math.max(4, Math.floor(r / 0.4)); k++) {
        const t = (k + 0.5) / Math.max(4, Math.floor(r / 0.4));
        const x = Math.cos(a0) * (1 - t) * r + Math.cos(a1) * t * r;
        const z = Math.sin(a0) * (1 - t) * r + Math.sin(a1) * t * r;
        G(new THREE.CylinderGeometry(0.06, 0.06, 0.09, 6), M.tileLight, [x, -0.18, z], [Math.PI / 2, 0, 0], 1, { noShadow: true });
      }
    }
  }
  return { rise };
}

/* ------------------------------------------------------------------ *
 * 2. 木构：柱、枋、斗拱、格扇、挂落、雀替、美人靠、栏杆
 * ------------------------------------------------------------------ */
export function addColumn(B, M, x, y, z, h, r = 0.16, mat = null, lod = 0) {
  put(B, new THREE.CylinderGeometry(r * 0.92, r, h, 12), mat || M.wood, [x, y + h / 2, z], [0, 0, 0], lod);
  put(B, new THREE.CylinderGeometry(r * 1.42, r * 1.55, 0.12, 12), M.stone, [x, y + 0.06, z], [0, 0, 0], lod);
  put(B, new THREE.CylinderGeometry(r * 1.18, r * 1.05, 0.10, 12), M.darkWood, [x, y + h - 0.05, z], [0, 0, 0], lod);
}
/** 斗拱：栌斗 + 三层华拱 + 昂 + 升，近景细节 */
export function addDougong(B, M, x, y, z, s = 1, lod = 1) {
  const b = (w, h, d, px, py, pz, m, L = lod) => put(B, boxGeo(w, h, d), m, [x + px * s, y + py * s, z + pz * s], [0, 0, 0], L);
  b(0.46, 0.16, 0.46, 0, 0.08, 0, M.darkWood);
  b(0.78, 0.10, 0.24, 0, 0.21, 0, M.wood);
  b(0.24, 0.10, 0.82, 0, 0.32, 0, M.wood);
  b(1.02, 0.10, 0.24, 0, 0.43, 0, M.wood);
  b(0.24, 0.10, 1.06, 0, 0.54, 0, M.wood);
  b(0.34, 0.12, 0.34, 0, 0.65, 0, M.darkWood);
  for (const dx of [-0.42, 0.42]) b(0.12, 0.12, 0.12, dx, 0.65, 0, M.wood);
  // 昂（斜出）
  put(B, boxGeo(0.12, 0.10, 0.76), M.woodPale, [x, y + 0.36 * s, z + 0.30 * s], [0.34, 0, 0], lod);
}
/** 格扇长窗：边框 + 棂条（步步锦 / 冰裂） + 明纸 */
export function addGeWindow(B, M, o) {
  const { x, y, z, w, h, rot = 0, pattern = 'jin', lod = 0 } = o;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const G = (g, m, p, L = lod, r2 = [0, 0, 0]) =>
    put(B, g, m, [x + p[0] * cs + p[2] * sn, y + p[1], z - p[0] * sn + p[2] * cs],
      [r2[0], rot + r2[1], r2[2]], L);
  G(boxGeo(w, h, 0.055), M.paper, [0, 0, 0], 2); // 纸面归中景层
  G(boxGeo(w, 0.075, 0.11), M.wood, [0, h / 2, 0]);
  G(boxGeo(w, 0.075, 0.11), M.wood, [0, -h / 2, 0]);
  G(boxGeo(0.075, h, 0.11), M.wood, [-w / 2, 0, 0]);
  G(boxGeo(0.075, h, 0.11), M.wood, [w / 2, 0, 0]);
  G(boxGeo(w, 0.055, 0.09), M.wood, [0, -h * 0.20, 0]);
  // 棂条：L1 层（18–55 m 仍可见），极细部分归 L0
  const rows = Math.max(3, Math.round(h / 0.38)), cols = Math.max(2, Math.round(w / 0.42));
  for (let i = 1; i < cols; i++) G(boxGeo(0.038, h, 0.065), M.darkWood, [-w / 2 + i * w / cols, 0, 0], 2);
  for (let j = 1; j < rows; j++) G(boxGeo(w, 0.038, 0.065), M.darkWood, [0, -h / 2 + j * h / rows, 0], 2);
  if (pattern === 'binglie') {
    const rnd = mulberry32(Math.round((x + z + 100) * 97));
    for (let k = 0; k < 14; k++) {
      const px = (rnd() - 0.5) * (w - 0.3), py = (rnd() - 0.5) * (h - 0.3);
      const len = 0.22 + rnd() * 0.36, a = rnd() * Math.PI;
      G(boxGeo(len, 0.032, 0.06), M.darkWood, [px, py, 0], 1, [0, 0, a]);
    }
  }
}
/** 挂落（檐下镂空木饰） */
export function addGualuo(B, M, x, y, z, w, rot = 0, lod = 1) {
  const G = (g, p, L = lod) => put(B, g, M.darkWood, [x + p[0], y + p[1], z + p[2]], [0, rot, 0], L);
  G(boxGeo(w, 0.075, 0.07), [0, 0, 0]);
  G(boxGeo(w, 0.06, 0.07), [0, -0.36, 0]);
  const n = Math.max(4, Math.round(w / 0.42));
  for (let i = 0; i <= n; i++) G(boxGeo(0.05, 0.36, 0.06), [-w / 2 + i * w / n, -0.18, 0]);
  for (let i = 0; i < n; i++) {
    const px = -w / 2 + (i + 0.5) * w / n;
    G(boxGeo(w / n * 0.56, 0.045, 0.05), [px, -0.18, 0]);
    G(new THREE.TorusGeometry(w / n * 0.20, 0.022, 4, 10, Math.PI), [px, -0.18, 0]);
  }
}
/** 美人靠（鹅颈椅）/ 石栏杆 */
export function addRailing(B, M, o) {
  const { x1, z1, x2, z2, y = 0, kind = 'mei', lod = 0, segments } = o;
  const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz);
  if (len < 0.2) return;
  const a = Math.atan2(dz, dx);
  const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
  const n = segments || Math.max(2, Math.round(len / 1.8));
  const G = (g, m, px, py, pz, L = lod, r2 = [0, 0, 0]) =>
    put(B, g, m, [mx + Math.cos(a) * px - Math.sin(a) * pz, y + py, mz + Math.sin(a) * px + Math.cos(a) * pz],
      [r2[0], -a + r2[1], r2[2]], L);
  if (kind === 'mei') {
    // 座板与立柱
    G(boxGeo(len, 0.10, 0.42), M.wood, 0, 0.44, 0);
    for (let i = 0; i <= n; i++) {
      const px = -len / 2 + i * len / n;
      G(boxGeo(0.09, 0.52, 0.09), M.wood, px, 0.24, -0.16);
      G(boxGeo(0.07, 0.50, 0.07), M.wood, px, 0.72, 0.16, 1);
      // 鹅颈曲线
      G(tube([[px, 0.48, 0.16], [px, 0.72, 0.20], [px, 0.90, 0.12], [px, 0.96, -0.02]], 0.035, 8, 5), M.wood, 0, 0, 0, 1);
    }
    G(boxGeo(len, 0.07, 0.07), M.wood, 0, 0.96, 0);
    G(boxGeo(len, 0.055, 0.055), M.wood, 0, 0.66, 0.18, 1);
  } else {
    // 石栏：望柱 + 栏板 + 地栿
    G(boxGeo(len, 0.12, 0.30), M.stone, 0, 0.10, 0);
    G(boxGeo(len, 0.10, 0.34), M.marble, 0, 0.92, 0);
    for (let i = 0; i <= n; i++) {
      const px = -len / 2 + i * len / n;
      G(boxGeo(0.16, 1.06, 0.16), M.marble, px, 0.54, 0);
      G(new THREE.SphereGeometry(0.10, 8, 6), M.marble, px, 1.12, 0, 1);
    }
    for (let i = 0; i < n; i++) {
      const px = -len / 2 + (i + 0.5) * len / n;
      G(boxGeo(len / n - 0.22, 0.46, 0.10), M.marble, px, 0.52, 0);
      G(boxGeo(len / n - 0.30, 0.24, 0.11), M.stoneDark, px, 0.52, 0, 1);
    }
  }
}

/* ------------------------------------------------------------------ *
 * 3. 墙：粉墙、云墙、漏窗、月洞门、砖雕门楼
 * ------------------------------------------------------------------ */
/** 直墙段（可带洞） */
export function addWall(B, M, o) {
  const { x1, z1, x2, z2, h = 3.2, t = 0.42, holes = [], mat, wave = 0, lod = 0 } = o;
  const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz);
  const a = Math.atan2(dz, dx), mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
  const G = (g, m, px, py, pz, L = lod, r2 = [0, 0, 0]) =>
    put(B, g, m, [mx + Math.cos(a) * px - Math.sin(a) * pz, py, mz + Math.sin(a) * px + Math.cos(a) * pz],
      [r2[0], -a + r2[1], r2[2]], L);
  const wallMat = mat || M.plaster;
  if (holes.length) {
    // 带洞墙：用局部 Shape 挤出，洞的 x 为相对墙中心的偏移
    G(wallWithHoles(len, h, t, holes), wallMat, 0, 0, 0);
  } else {
    G(boxGeo(len, h, t, 0.35), wallMat, 0, h / 2, 0);
  }
  // 墙脚青砖勒脚
  G(boxGeo(len, 0.42, t + 0.08, 0.5), M.graybrick, 0, 0.21, 0);
  // 墙顶：小青瓦双坡 + 云墙起伏
  const N = Math.max(3, Math.round(len / 1.1));
  for (let i = 0; i < N; i++) {
    const px = -len / 2 + (i + 0.5) * len / N;
    const wy = wave ? Math.sin((i / N) * Math.PI * 2 * wave.count + wave.phase) * wave.amp : 0;
    G(boxGeo(len / N + 0.02, 0.20, t + 0.30, 0.6), M.tile, px, h + 0.10 + wy, 0);
    if (wave) G(boxGeo(len / N + 0.02, 0.12, t + 0.12), wallMat, px, h + wy * 0.85, 0, 1);
  }
  G(boxGeo(len, 0.10, 0.13), M.ridge, 0, h + 0.26 + (wave ? wave.amp : 0), 0, 1);
  return { a, mx, mz, len };
}
/** 漏窗窗芯（冰裂 / 万字 / 海棠 / 六角） */
export function addLeakWindowCore(B, M, o) {
  const { x, y, z, w = 1.5, h = 1.5, rot = 0, kind = 'binglie', lod = 1 } = o;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const G = (g, m, px, py, pz, r2 = [0, 0, 0], L = lod) =>
    put(B, g, m, [x + px * cs + pz * sn, y + py, z - px * sn + pz * cs], [r2[0], rot + r2[1], r2[2]], L);
  const t = 0.055;
  G(boxGeo(w + 0.16, 0.09, 0.14), M.graybrick, 0, h / 2 + 0.04, 0);
  G(boxGeo(w + 0.16, 0.09, 0.14), M.graybrick, 0, -h / 2 - 0.04, 0);
  G(boxGeo(0.09, h + 0.16, 0.14), M.graybrick, -w / 2 - 0.04, 0, 0);
  G(boxGeo(0.09, h + 0.16, 0.14), M.graybrick, w / 2 + 0.04, 0, 0);
  if (kind === 'wanzi') {
    for (let i = -1; i <= 1; i++) {
      G(boxGeo(w, t, 0.08), M.graybrick, 0, i * h * 0.30, 0);
      G(boxGeo(t, h, 0.08), M.graybrick, i * w * 0.30, 0, 0);
    }
  } else if (kind === 'haitang') {
    for (const s of [-1, 1]) for (const s2 of [-1, 1]) {
      G(new THREE.TorusGeometry(w * 0.24, t, 5, 12, Math.PI * 1.5), M.graybrick,
        s * w * 0.22, s2 * h * 0.22, 0, [0, 0, s * s2 * Math.PI / 4]);
    }
    G(boxGeo(t, h, 0.08), M.graybrick, 0, 0, 0);
    G(boxGeo(w, t, 0.08), M.graybrick, 0, 0, 0);
  } else if (kind === 'hex') {
    G(new THREE.TorusGeometry(w * 0.34, t * 1.1, 5, 6), M.graybrick, 0, 0, 0);
    for (let k = 0; k < 6; k++) {
      const a = k * Math.PI / 3;
      G(boxGeo(w * 0.34, t, 0.08), M.graybrick, Math.cos(a) * w * 0.17, Math.sin(a) * h * 0.17, 0, [0, 0, a]);
    }
  } else {
    const rnd = mulberry32(Math.round((x + z + 200) * 131));
    for (let k = 0; k < 12; k++) {
      const px = (rnd() - 0.5) * w * 0.8, py = (rnd() - 0.5) * h * 0.8;
      const a = rnd() * Math.PI, L = 0.3 + rnd() * 0.6;
      G(boxGeo(L, t, 0.08), M.graybrick, px, py, 0, [0, 0, a]);
    }
  }
}
/** 月洞门：圆洞 + 门框砖细 + 匾额 */
export function addMoonGate(B, M, o) {
  const { x, z, rot = 0, r = 1.45, h = 3.4, width = 8, lod = 0 } = o;
  const info = addWall(B, M, {
    x1: x - Math.cos(rot) * width / 2, z1: z - Math.sin(rot) * width / 2,
    x2: x + Math.cos(rot) * width / 2, z2: z + Math.sin(rot) * width / 2,
    h, holes: [{ type: 'circle', x: 0, y: 0.05, r, ground: true }], lod,
  });
  // 门洞内壁砖圈
  const N = 30;
  for (let i = 0; i < N; i++) {
    const a = Math.PI * (i + 0.5) / N;
    const px = -Math.cos(a) * r, py = r + Math.sin(a) * r + 0.05;
    put(B, boxGeo(0.16, 0.15, 0.50, 0.6), M.graybrick,
      [x + Math.cos(rot) * px, py, z + Math.sin(rot) * px], [0, -rot, a], 1);
  }
  return info;
}
/** 砖雕门楼（主入口） */
export function addBrickGate(B, M, o) {
  const { x, y, z, w = 14, h = 6.2, rot = 0, lod = 0 } = o;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const G = (g, m, px, py, pz, L = lod) =>
    put(B, g, m, [x + px * cs + pz * sn, y + py, z - px * sn + pz * cs], [0, -rot, 0], L);
  // 真正镂空的门洞（而非贴黑面），使宫门成为中轴序列的取景框
  G(wallWithHoles(w, h - 0.8, 0.9, [{ type: 'rect', x: 0, y: 0.04, w: 3.6, h: 3.58 }]),
    M.graybrick, 0, 0, 0);
  G(boxGeo(w + 1.0, 0.34, 1.25, 0.35), M.stone, 0, h - 0.9, 0);
  G(boxGeo(w + 1.4, 0.24, 1.45), M.graybrick, 0, h - 0.6, 0);
  G(boxGeo(w + 1.8, 0.20, 1.6), M.tile, 0, h - 0.35, 0);
  // 门框与半启的朱漆门板（不遮断中央视线）
  G(boxGeo(3.6, 0.22, 1.15), M.stone, 0, 3.78, 0);
  for (const s of [-1, 1]) {
    G(boxGeo(0.16, 3.5, 1.02), M.stoneDark, s * 1.82, 1.79, 0);
    G(boxGeo(0.72, 3.3, 0.08), M.lacquer, s * 1.42, 1.70, 0.48, 1);
  }
  // 砖雕：枋、字牌、垂花柱
  G(boxGeo(w - 1.4, 0.44, 0.18), M.stone, 0, h - 1.42, 0.5, 1);
  for (let i = 0; i < 12; i++) {
    const px = -w / 2 + 0.8 + i * (w - 1.6) / 11;
    G(boxGeo(0.16, 0.30, 0.12), M.stone, px, h - 1.42, 0.62, 1);
    G(new THREE.SphereGeometry(0.10, 6, 5), M.stone, px, h - 1.62, 0.62, 1);
  }
  for (const s of [-1, 1]) {
    G(boxGeo(0.30, 1.5, 0.30), M.wood, s * (w / 2 - 0.6), h - 2.1, 0.55);
    G(lathe([[0.16, 0], [0.20, 0.12], [0.05, 0.36]], 8), M.wood, s * (w / 2 - 0.6), h - 2.9, 0.55, 1);
  }
  // 屋顶小披檐
  G(roofGeo(w / 2 + 0.6, 0.9, 0, 0.62, { lift: 0.30, eave: 0.4, nx: 24, nz: 12 }), M.tile, 0, h - 0.12, 0);
}

/* ------------------------------------------------------------------ *
 * 4. 铺地、灯笼、匾额（CanvasTexture 中文字）、石灯、楹联
 * ------------------------------------------------------------------ */
export function addPavingPatch(B, M, x, z, w, d, y = 0.02, rot = 0, lod = 0) {
  const g = new THREE.PlaneGeometry(w, d, 1, 1);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w * 0.45, uv.getY(i) * d * 0.45);
  put(B, g, M.paving, [x, y, z], [-Math.PI / 2, 0, rot], lod, { noShadow: true });
}
/** 中式宫灯（emissive，暮色点亮由 sky 控制） */
export function addLantern(B, M, x, y, z, s = 1, lod = 1) {
  const G = (g, m, py, L = lod) => put(B, g, m, [x, y + py * s, z], [0, 0, 0], L, { noShadow: true });
  G(new THREE.CylinderGeometry(0.26 * s, 0.26 * s, 0.52 * s, 10), M.lantern, 0);
  G(new THREE.CylinderGeometry(0.30 * s, 0.30 * s, 0.06 * s, 10), M.lacquer, 0.28 * s);
  G(new THREE.CylinderGeometry(0.30 * s, 0.30 * s, 0.06 * s, 10), M.lacquer, -0.28 * s);
  G(new THREE.SphereGeometry(0.09 * s, 8, 6), M.gold, -0.40 * s);
  G(new THREE.CylinderGeometry(0.015 * s, 0.015 * s, 0.45 * s, 5), M.darkWood, 0.52 * s);
  for (let k = 0; k < 6; k++) {
    const a = k * Math.PI / 3;
    put(B, boxGeo(0.02 * s, 0.52 * s, 0.02 * s), M.lacquer,
      [x + Math.cos(a) * 0.255 * s, y, z + Math.sin(a) * 0.255 * s], [0, 0, 0], 1, { noShadow: true });
  }
}
/** 匾额：CanvasTexture 绘制中文，返回独立 Mesh（由调用方 add 到 scene） */
export function makePlaque(text, w = 3.2, h = 0.86) {
  // Canvas is available in browsers; headless Runtime contract tests have no DOM.
  if (typeof document === 'undefined') {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: 0x2a2018, side: THREE.DoubleSide })
    );
    mesh.name = 'plaque_' + text;
    return mesh;
  }
  const c = document.createElement('canvas');
  c.width = 640; c.height = 172;
  const g = c.getContext('2d');
  g.fillStyle = '#2a2018'; g.fillRect(0, 0, 640, 172);
  g.strokeStyle = '#b08b4c'; g.lineWidth = 7; g.strokeRect(9, 9, 622, 154);
  g.strokeStyle = 'rgba(200,164,96,.45)'; g.lineWidth = 2; g.strokeRect(20, 20, 600, 132);
  g.fillStyle = '#e8d3a2';
  g.font = 'bold 92px "Songti SC","STSong","Noto Serif CJK SC","SimSun",serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 320, 90);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const m = new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  mesh.name = 'plaque_' + text;
  return mesh;
}
/** 石灯笼 / 庭石小品 */
export function addStoneLantern(B, M, x, y, z, s = 1, lod = 1) {
  const G = (g, py, L = lod) => put(B, g, M.stoneDark, [x, y + py * s, z], [0, 0, 0], L);
  G(new THREE.CylinderGeometry(0.34 * s, 0.42 * s, 0.18 * s, 8), 0.09 * s);
  G(new THREE.CylinderGeometry(0.13 * s, 0.16 * s, 0.72 * s, 8), 0.54 * s);
  G(new THREE.CylinderGeometry(0.36 * s, 0.28 * s, 0.16 * s, 8), 0.98 * s);
  G(new THREE.CylinderGeometry(0.30 * s, 0.30 * s, 0.36 * s, 6), 1.24 * s);
  G(new THREE.ConeGeometry(0.48 * s, 0.30 * s, 6), 1.56 * s);
  G(new THREE.SphereGeometry(0.10 * s, 8, 6), 1.76 * s);
}
