/* 良渚 · 水城 —— 湿地植被
 * 芦苇 / 菰 / 茭白 / 莎草、荷叶与睡莲、浮萍藻斑、垂柳与乌桕、山麓灌木与稻茬，
 * 全部 GPU Instancing；顶点着色器实现风摆与按视距收缩（消除远处 overdraw）。
 */
import * as THREE from 'three';
import {
  WORLD, SURVEY, QUALITY, clamp, lerp, smooth, fbm, mulberry32,
} from './core.js';
import { waterSDF, LAKES, CUTS } from './hydro.js';
import { terrainHeight } from './terrain.js';

const rnd = mulberry32(33002300);
const rr = (a, b) => a + (b - a) * rnd();

/* 台基占地：植被不落在夯土台面与广场上 */
const BLOCKED = [
  [-345, 345, -295, 175], [-315, 315, 220, 650], [-460, -340, -520, 260],
  [-80, 80, 920, 990], [3100, 3300, -3730, -3470], [2400, 2560, -4330, -4130],
];
function blocked(x, z) {
  for (const b of BLOCKED) if (x > b[0] && x < b[1] && z > b[2] && z < b[3]) return true;
  return false;
}

/* 交叉叶片几何 */
function bladeGeo(n = 3, w = 0.22, h = 1.0) {
  const pos = [], uv = [], idx = [], nor = [];
  for (let k = 0; k < n; k++) {
    const a = k * Math.PI / n;
    const cx = Math.cos(a) * w * 0.5, cz = Math.sin(a) * w * 0.5;
    const dx = -Math.sin(a) * w * 0.5, dz = Math.cos(a) * w * 0.5;
    const b = pos.length / 3;
    pos.push(cx - dx, 0, cz - dz, cx + dx, 0, cz + dz,
             cx - dx * 0.55, h, cz - dz * 0.55, cx + dx * 0.55, h, cz + dz * 0.55);
    uv.push(0, 0, 1, 0, 0.12, 1, 0.88, 1);
    nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}
function bumpyGeo(r = 1, detail = 1) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const k = 0.80 + fbm(p.getX(i) * 1.6 + 3, p.getZ(i) * 1.6 + 7, 811, 3) * 0.42;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.86, p.getZ(i) * k);
  }
  p.needsUpdate = true; g.computeVertexNormals();
  return g;
}

/* 风摆 + 视距收缩：CPU 不逐帧更新实例 */
function fadingMaterial(base, uniforms, sway = 0.9, fadeNear = 850, fadeFar = 2100) {
  const m = base.clone();
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uCamPos; uniform float uTime; uniform float uSway;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 iOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float dd = distance(iOrigin, uCamPos);
        float fade = 1.0 - smoothstep(${fadeNear.toFixed(1)}, ${fadeFar.toFixed(1)}, dd);
        float bend = sin(uTime * 1.15 + iOrigin.x * 0.037 + iOrigin.z * 0.021 + transformed.y * 1.7);
        transformed.x += bend * ${sway.toFixed(2)} * 0.075 * max(transformed.y, 0.0);
        transformed *= fade;`);
  };
  m.customProgramCacheKey = () => `fade_${sway}_${fadeNear}_${fadeFar}`;
  return m;
}

function instanceMesh(scene, name, geo, mat, list, transformFn, colorFn) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  mesh.name = name;
  mesh.frustumCulled = false;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
  list.forEach((a, i) => {
    const t = transformFn(a);
    e.set(t.rot[0], t.rot[1], t.rot[2]); q.setFromEuler(e);
    m.compose(new THREE.Vector3(t.pos[0], t.pos[1], t.pos[2]), q, new THREE.Vector3(...t.scale));
    mesh.setMatrixAt(i, m);
    const col = colorFn(a); c.setRGB(col[0], col[1], col[2]); mesh.setColorAt(i, c);
  });
  mesh.count = list.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.receiveShadow = false; mesh.castShadow = false;
  scene.add(mesh);
  return mesh;
}

export function createNature(scene, M, q) {
  const uniforms = {
    uCamPos: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uSway: { value: 1.0 },
  };
  const groups = [];
  const reedMat = fadingMaterial(M.reed, uniforms, 1.0, 760, 1900);
  const grassMat = fadingMaterial(M.reed, uniforms, 0.6, 520, 1500);
  const lilyMat = fadingMaterial(M.leaf, uniforms, 0.0, 620, 1700);
  const flatLeafMat = M.leaf;

  /* --- 采样布点 --- */
  const reeds = [], grass = [], lilies = [], algae = [], trees = [], shrubs = [];
  const wetZones = [
    { x: 0, z: 0, rx: 1750, rz: 1800, w: 0.50 },
    { x: -3100, z: -3000, rx: 2100, rz: 1500, w: 0.22 },
    { x: 2750, z: 300, rx: 900, rz: 700, w: 0.10 },
    { x: 0, z: 0, rx: 3400, rz: 3100, w: 0.18 },
  ];
  const pickZone = () => {
    let r = rnd(), acc = 0;
    for (const z of wetZones) { acc += z.w; if (r <= acc) return z; }
    return wetZones[0];
  };
  const sample = () => {
    const z = pickZone();
    return [z.x + (rnd() + rnd() - 1) * z.rx, z.z + (rnd() + rnd() - 1) * z.rz];
  };
  let guard = 0;
  const targetReed = q.reed, targetGrass = q.grass;
  while ((reeds.length < targetReed || grass.length < targetGrass || lilies.length < Math.round(targetReed * 0.22))
         && guard++ < (targetReed + targetGrass) * 12) {
    const [x, z] = sample();
    if (Math.abs(x) > 5900 || Math.abs(z) > 4900) continue;
    const d = waterSDF(x, z);
    if (d > 60) continue;                       // 远离水岸：跳过昂贵的高程求值
    if (blocked(x, z)) continue;
    const h = terrainHeight(x, z);
    if (h > 26 || h < -2) continue;
    if (d > -9 && d < 20 && reeds.length < targetReed && rnd() < 0.80) {
      reeds.push({ x, z, y: Math.max(h, WORLD.waterY - 0.15), s: rr(0.75, 2.1), a: rnd() * Math.PI });
    }
    if (d > 2 && d < 48 && grass.length < targetGrass && rnd() < 0.62) {
      grass.push({ x, z, y: h, s: rr(0.35, 0.95), a: rnd() * Math.PI });
    }
    if (d < -2 && d > -26 && lilies.length < Math.round(targetReed * 0.22) && rnd() < 0.28) {
      lilies.push({ x, z, s: rr(0.55, 1.9), a: rnd() * Math.PI });
    }
    if (d < -1 && d > -16 && algae.length < Math.round(targetReed * 0.18) && rnd() < 0.20) {
      algae.push({ x, z, s: rr(0.35, 1.25), a: rnd() * Math.PI });
    }
  }
  /* 林木：外郭台地、山麓、孤丘；避开台基与水面 */
  const treeTarget = Math.round(1100 * q.tree);
  guard = 0;
  while (trees.length < treeTarget && guard++ < treeTarget * 28) {
    const x = (rnd() - 0.5) * 11000, z = (rnd() - 0.5) * 9000;
    const d = waterSDF(x, z), h = terrainHeight(x, z);
    if (d < 8 || h < 4.0 || h > 46 || blocked(x, z)) continue;
    if (Math.abs(x) < 900 && Math.abs(z) < 1000) continue;
    trees.push({ x, z, y: h, s: rr(2.6, 7.2), a: rnd() * Math.PI * 2 });
  }
  const shrubTarget = Math.round(2400 * q.tree);
  guard = 0;
  while (shrubs.length < shrubTarget && guard++ < shrubTarget * 20) {
    const x = (rnd() - 0.5) * 11200, z = (rnd() - 0.5) * 9200;
    const d = waterSDF(x, z), h = terrainHeight(x, z);
    if (d < 5 || h < 3.6 || h > 60 || blocked(x, z)) continue;
    shrubs.push({ x, z, y: h, s: rr(0.8, 2.8), a: rnd() * Math.PI });
  }

  const reedGeo = bladeGeo(3, 0.30, 1.0);
  const grassGeo = bladeGeo(3, 0.26, 0.72);
  const lilyGeo = new THREE.CircleGeometry(1, 10); lilyGeo.rotateX(-Math.PI / 2);
  const algaeGeo = new THREE.CircleGeometry(1, 7); algaeGeo.rotateX(-Math.PI / 2);
  const canopyGeo = bumpyGeo(1, 1);
  const trunkGeo = new THREE.CylinderGeometry(0.09, 0.14, 1, 6);
  trunkGeo.translate(0, 0.5, 0);
  const shrubGeo = bumpyGeo(1, 0);

  groups.push(instanceMesh(scene, '芦苇 · 菰 · 茭白', reedGeo, reedMat, reeds,
    a => ({ pos: [a.x, a.y, a.z], rot: [0, a.a, 0], scale: [a.s * 0.95, a.s * rr(1.5, 3.1), a.s * 0.95] }),
    () => { const k = rr(0.55, 1.0); return [k * 0.86, k, k * 0.62]; }));
  groups.push(instanceMesh(scene, '湿地莎草 · 稻茬', grassGeo, grassMat, grass,
    a => ({ pos: [a.x, a.y, a.z], rot: [0, a.a, 0], scale: [a.s, a.s * rr(0.7, 1.5), a.s] }),
    () => { const k = rr(0.58, 1.05); return [k * 0.88, k, k * 0.58]; }));
  groups.push(instanceMesh(scene, '荷叶 · 睡莲', lilyGeo, lilyMat, lilies,
    a => ({ pos: [a.x, WORLD.waterY + 0.09, a.z], rot: [0, a.a, 0], scale: [a.s, 1, a.s] }),
    () => { const k = rr(0.62, 1.02); return [k * 0.68, k, k * 0.52]; }));
  groups.push(instanceMesh(scene, '浮萍 · 藻斑', algaeGeo, flatLeafMat, algae,
    a => ({ pos: [a.x, WORLD.waterY + 0.055, a.z], rot: [0, a.a, 0], scale: [a.s * 0.5, 1, a.s * 0.5] }),
    () => { const k = rr(0.45, 0.88); return [k * 0.74, k, k * 0.50]; }));
  groups.push(instanceMesh(scene, '垂柳 · 乌桕树冠', canopyGeo, M.canopy, trees,
    a => ({ pos: [a.x, a.y + a.s * 0.72, a.z], rot: [0, a.a, 0], scale: [a.s * 0.55, a.s * 0.42, a.s * 0.55] }),
    () => { const k = rr(0.62, 1.05); return [k * 0.62, k * 0.86, k * 0.48]; }));
  groups.push(instanceMesh(scene, '树干', trunkGeo, M.bark, trees,
    a => ({ pos: [a.x, a.y, a.z], rot: [0, a.a, 0], scale: [a.s * 0.18, a.s * 0.8, a.s * 0.18] }),
    () => [0.78, 0.74, 0.68]));
  groups.push(instanceMesh(scene, '山麓灌木', shrubGeo, M.canopy, shrubs,
    a => ({ pos: [a.x, a.y + a.s * 0.35, a.z], rot: [0, a.a, 0], scale: [a.s, a.s * 0.7, a.s] }),
    () => { const k = rr(0.55, 1.0); return [k * 0.66, k * 0.82, k * 0.46]; }));

  const totals = groups.map(g => g.count);
  return {
    groups, uniforms, totals,
    update(t, camera) { uniforms.uTime.value = t; uniforms.uCamPos.value.copy(camera.position); },
    setWeather(w) { uniforms.uSway.value = w === 'rain' ? 1.8 : w === 'mist' ? 0.65 : 1.0; },
    applyQuality(nq) {
      /* 按新档位比例收缩实例数（实例按随机顺序生成，直接截断即均匀稀疏化） */
      const scale = nq.detail / q.detail;
      groups.forEach((g, i) => { g.count = Math.max(1, Math.min(totals[i], Math.round(totals[i] * scale))); });
    },
  };
}
