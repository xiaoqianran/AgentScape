/* 地形、园路、植被、荷塘、残石与远景林带 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm, R, mulberry32, chamferBoxGeo, WORLD, POIS } from './core.js';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const LAKE_C = [18, 112], LAKE_R = [128, 42];
export function lakeShoreAngle(a) {
  return 1 + 0.10 * Math.sin(a * 3 + 1.3) + 0.06 * Math.sin(a * 7 + 0.4)
    + 0.025 * Math.sin(a * 13 + 2.1);
}
export function lakeDepthFactor(x, z) {
  const qx = (x - LAKE_C[0]) / LAKE_R[0], qz = (z - LAKE_C[1]) / LAKE_R[1];
  const a = Math.atan2(qz, qx), d = Math.hypot(qx, qz);
  return 1 - smoothstep(lakeShoreAngle(a) - 0.06, lakeShoreAngle(a) + 0.22, d);
}

export function terrainHeight(x, z) {
  const n = (fbm(x / 105 + 2.3, z / 105 + 4.1, 5, 4, 8) - 0.5) * 3.4;
  const hillNW = 12 * Math.exp(-(((x + 205) / 88) ** 2 + ((z + 135) / 74) ** 2));
  const hillE = 7 * Math.exp(-(((x - 228) / 74) ** 2 + ((z + 78) / 95) ** 2));
  const xianfa = 6.5 * Math.exp(-(((x - 140) / 27) ** 2 + ((z + 36) / 24) ** 2));
  const soft = (fbm(x / 36 + 8.2, z / 36 + 1.7, 23, 3, 8) - 0.5) * 0.5;
  // 核心建筑区趋于平整
  const fx = 1 - smoothstep(165, 215, Math.abs(x));
  const fz = 1 - smoothstep(95, 145, Math.abs(z + 2));
  const flat = fx * fz;
  let h = (n + hillNW + hillE + xianfa + soft) * (1 - flat * 0.96);
  h += flat * soft * 0.12;
  h -= lakeDepthFactor(x, z) * 2.6;
  return h;
}

const PATHS = [
  [[-175, 22], [-120, 20], [-60, 22], [10, 20], [70, 20], [165, 16]],
  [[40, -70], [40, -20], [40, 20], [40, 60], [40, 92]],
  [[-72, -30], [-72, 10], [-70, 40], [-62, 62]],
  [[-152, -30], [-152, 20], [-138, 30], [-110, 22]],
  [[-20, 40], [0, 66], [18, 92], [50, 104], [100, 100]],
  [[-118, -40], [-106, -10], [-100, 14]],
  [[100, 20], [130, 6], [160, -12]],
];
function pathDist(x, z) {
  let best = 1e9;
  for (const seg of PATHS) {
    for (let i = 0; i < seg.length - 1; i++) {
      const [ax, az] = seg[i], [bx, bz] = seg[i + 1];
      const dx = bx - ax, dz = bz - az;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
      best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
    }
  }
  return best;
}

const EXCLUDE = [
  [-110, 110, -25, 25],       // 大水法片区
  [10, 70, -48, 24],
  [-110, -34, -14, 16],      // 海晏堂
  [-105, -40, 30, 48],       // 生肖钟
  [-165, -115, -14, 24],     // 谐奇趣
  [-132, -104, -50, -30],    // 方外观
  [-180, -124, -26, 26],     // 黄花阵
  [122, 160, -24, 4],        // 线法山
];
/* 预设机位与其视线走廊保持通透，避免树冠贴在镜头前 */
const SIGHTLINES = POIS.map(p => [p.pos[0], p.pos[2], p.target[0], p.target[2]]);
function sightDist(x, z) {
  let best = 1e9;
  for (const [ax, az, bx, bz] of SIGHTLINES) {
    const dx = bx - ax, dz = bz - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return best;
}
function blocked(x, z, pad = 0) {
  for (const [x1, x2, z1, z2] of EXCLUDE) if (x > x1 - pad && x < x2 + pad && z > z1 - pad && z < z2 + pad) return true;
  if (lakeDepthFactor(x, z) > 0.12) return true;
  if (pathDist(x, z) < 2.6) return true;
  if (sightDist(x, z) < 8.5) return true;
  for (const p of POIS) if (Math.hypot(x - p.pos[0], z - p.pos[2]) < 15) return true;
  return false;
}

function withColor(g, col) {
  const geo = g.index ? g.toNonIndexed() : g;
  const n = geo.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = col[0]; arr[i * 3 + 1] = col[1]; arr[i * 3 + 2] = col[2]; }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
  return geo;
}
function treeGeometry(kind) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.19, 0.31, 3.6, 7, 1);
  trunk.translate(0, 1.8, 0);
  parts.push(withColor(trunk, [0.30, 0.22, 0.16]));
  if (kind === 0) { // 国槐 / 银杏
    const blobs = [
      [0, 4.8, 0, 2.15], [1.5, 4.3, 0.5, 1.55], [-1.4, 4.6, -0.5, 1.6],
      [0.5, 6.0, -1.0, 1.5], [-0.6, 5.8, 1.2, 1.45], [1.0, 5.5, 1.4, 1.2],
    ];
    blobs.forEach(([x, y, z, r], i) => {
      const g = new THREE.IcosahedronGeometry(r, 1);
      g.scale(1, 0.86, 1); g.translate(x, y, z);
      parts.push(withColor(g, [0.26 + (i % 3) * 0.035, 0.42 + (i % 4) * 0.035, 0.20 + (i % 2) * 0.02]));
    });
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * Math.PI * 2;
      const g = new THREE.CylinderGeometry(0.06, 0.11, 1.7, 5);
      g.rotateZ(Math.sin(a) * 0.6); g.rotateX(Math.cos(a) * 0.6);
      g.translate(Math.cos(a) * 0.7, 3.2, Math.sin(a) * 0.7);
      parts.push(withColor(g, [0.30, 0.22, 0.16]));
    }
  } else if (kind === 1) { // 松
    for (let i = 0; i < 3; i++) {
      const g = new THREE.ConeGeometry(2.3 - i * 0.5, 2.6, 9, 1);
      g.translate(0, 3.0 + i * 1.5, 0);
      parts.push(withColor(g, [0.15 + i * 0.02, 0.29 + i * 0.03, 0.17]));
    }
  } else { // 垂柳
    const top = new THREE.IcosahedronGeometry(2.4, 1);
    top.scale(1.3, 0.62, 1.3); top.translate(0, 4.9, 0);
    parts.push(withColor(top, [0.31, 0.47, 0.23]));
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * Math.PI * 2, r = 1.5 + (i % 3) * 0.35;
      const g = new THREE.CylinderGeometry(0.035, 0.07, 3.3 + (i % 4) * 0.5, 4, 1);
      g.translate(Math.cos(a) * r, 3.2, Math.sin(a) * r);
      parts.push(withColor(g, [0.30, 0.46, 0.22]));
    }
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach(p => p.dispose());
  return merged;
}

/* 远景林带专用低模：仅主干 + 2 团树冠，约为近景树的 1/5 面数 */
function beltGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.18, 0.28, 3.4, 5, 1);
  trunk.translate(0, 1.7, 0);
  parts.push(withColor(trunk, [0.30, 0.22, 0.16]));
  for (let i = 0; i < 2; i++) {
    const g = new THREE.IcosahedronGeometry(i ? 1.6 : 2.0, 0);
    g.scale(1, 0.9, 1);
    g.translate(0, 3.7 + i * 1.5, 0);
    parts.push(withColor(g, [0.22 + i * 0.04, 0.36 + i * 0.05, 0.21]));
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach(p => p.dispose());
  return merged;
}

function grassTexture() {
  // Server-side world initialization has no DOM. The actual grass blade
  // texture is generated in the browser; physics/navigation only need geometry.
  if (typeof document === 'undefined') {
    const texture = new THREE.DataTexture(new Uint8Array([135, 159, 88, 255]), 1, 1);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, 64, 64);
  for (let i = 0; i < 9; i++) {
    const x = 6 + i * 6.5 + R() * 3, h = 26 + R() * 26;
    const g = c.createLinearGradient(x, 64, x, 64 - h);
    g.addColorStop(0, '#5c7138'); g.addColorStop(0.55, '#8ea354'); g.addColorStop(1, '#c8cd84');
    c.fillStyle = g;
    c.beginPath(); c.moveTo(x - 2.2, 64); c.quadraticCurveTo(x - 2, 64 - h * 0.6, x + (R() - 0.5) * 8, 64 - h);
    c.quadraticCurveTo(x + 2.4, 64 - h * 0.55, x + 2.2, 64); c.closePath(); c.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createNature(scene, M, ctx) {
  const group = new THREE.Group(); group.name = 'nature'; scene.add(group);

  /* --- 地形 --- */
  const [GW, GD] = WORLD.groundSize;
  const tg = new THREE.PlaneGeometry(GW, GD, 168, 132);
  tg.rotateX(-Math.PI / 2);
  const pos = tg.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const cGrass = new THREE.Color().setRGB(0.76, 0.85, 0.52);
  const cDry = new THREE.Color().setRGB(0.98, 0.88, 0.64);
  const cPath = new THREE.Color().setRGB(1.10, 1.02, 0.86);
  const cWet = new THREE.Color().setRGB(0.52, 0.60, 0.44);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);
    const n = fbm(x / 28 + 3.1, z / 28 + 7.4, 61, 4, 8);
    tmp.copy(cGrass).lerp(cDry, clamp((n - 0.4) * 1.5, 0, 1));
    const pd = pathDist(x, z);
    tmp.lerp(cPath, (1 - smoothstep(2.2, 4.0, pd)) * 0.9);
    const wet = lakeDepthFactor(x, z);
    tmp.lerp(cWet, wet * 0.7);
    tmp.multiplyScalar(0.94 + n * 0.22);
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  tg.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  tg.computeVertexNormals();
  const groundMat = M.ground.clone();
  groundMat.vertexColors = true;
  groundMat.map.wrapS = groundMat.map.wrapT = THREE.RepeatWrapping;
  groundMat.map.repeat.set(1, 1);
  const ground = new THREE.Mesh(tg, groundMat);
  ground.receiveShadow = true;
  ground.name = 'terrain';
  group.add(ground);

  /* --- 园路碎石与路缘 --- */
  const pebbleGeo = new THREE.IcosahedronGeometry(0.24, 0);
  const pebbleMat = new THREE.MeshStandardMaterial({ color: 0xa79c86, roughness: 1 });
  const pebbles = new THREE.InstancedMesh(pebbleGeo, pebbleMat, 900);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 900; i++) {
    let x, z, tries = 0;
    do { x = (R() - 0.5) * 340; z = (R() - 0.5) * 200 + 8; tries++; } while (blocked(x, z, -1.5) && tries < 12);
    dummy.position.set(x, terrainHeight(x, z) + 0.06, z);
    dummy.rotation.set(R() * 3, R() * 6, R() * 3);
    dummy.scale.setScalar(0.4 + R() * 1.1);
    dummy.updateMatrix(); pebbles.setMatrixAt(i, dummy.matrix);
  }
  pebbles.castShadow = false; pebbles.receiveShadow = true;
  group.add(pebbles);

  /* --- 树木 --- */
  const treeGeos = [treeGeometry(0), treeGeometry(1), treeGeometry(2)];
  const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.FrontSide });
  const positions = [[], [], []];
  const rnd = mulberry32(990011);
  for (let i = 0; i < 1350; i++) {
    const x = (rnd() - 0.5) * 460, z = (rnd() - 0.5) * 350;
    const dist = Math.hypot(x, z);
    if (dist < 18 || dist > 250) continue;
    if (blocked(x, z, 3)) continue;
    if (rnd() < smoothstep(0, 90, dist) * 0.34) continue;
    const nearWater = lakeDepthFactor(x + 7, z - 7) > 0.02 || Math.abs(z - 100) < 26;
    const kind = nearWater && rnd() < 0.62 ? 2 : (rnd() < 0.26 ? 1 : 0);
    positions[kind].push({ x, y: terrainHeight(x, z), z, s: 0.62 + rnd() * 0.55, rot: rnd() * 6.28, tint: 0.82 + rnd() * 0.36 });
  }
  const treeMeshes = [];
  positions.forEach((list, k) => {
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(treeGeos[k], treeMat, list.length);
    mesh.castShadow = true; mesh.receiveShadow = true;
    list.sort(() => R() - 0.5);
    list.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.rot, 0);
      dummy.scale.setScalar(p.s);
      dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
      const tc = new THREE.Color().setRGB(p.tint, p.tint * (0.94 + R() * 0.12), p.tint * 0.93);
      mesh.setColorAt(i, tc);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.userData.fullCount = list.length;
    mesh.userData.maxCount = list.length;
    group.add(mesh);
    treeMeshes.push(mesh);
  });

  /* --- 远景林带（不投影） --- */
  const beltGeo = beltGeometry();
  const belt = new THREE.InstancedMesh(beltGeo, treeMat, 300);
  for (let i = 0; i < 300; i++) {
    const a = (i / 300) * Math.PI * 2;
    const rad = 238 + rnd() * 34;
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad * 0.78;
    dummy.position.set(x, terrainHeight(x, z) - 0.3, z);
    dummy.rotation.set(0, rnd() * 6.28, 0);
    dummy.scale.setScalar(0.72 + rnd() * 0.62);
    dummy.updateMatrix(); belt.setMatrixAt(i, dummy.matrix);
    belt.setColorAt(i, new THREE.Color().setRGB(0.62 + rnd() * 0.25, 0.68 + rnd() * 0.22, 0.56 + rnd() * 0.2));
  }
  belt.castShadow = false; belt.receiveShadow = false;
  belt.userData.fullCount = 300; belt.userData.maxCount = 300;
  belt.instanceMatrix.needsUpdate = true;
  group.add(belt);
  treeMeshes.push(belt);

  /* --- 草丛 --- */
  const blade = new THREE.PlaneGeometry(0.72, 0.82);
  blade.translate(0, 0.41, 0);
  const blade2 = blade.clone(); blade2.rotateY(Math.PI / 2);
  const grassGeo = mergeGeometries([blade.toNonIndexed(), blade2.toNonIndexed()], false);
  const grassMat = new THREE.MeshStandardMaterial({
    map: grassTexture(), alphaTest: 0.42, side: THREE.DoubleSide,
    roughness: 1, transparent: false, depthWrite: true, color: 0xffffff,
  });
  // 顶点级距离 LOD：远处草簇收缩为零面积，免去无效 overdraw 与片元开销
  grassMat.onBeforeCompile = shader => {
    shader.uniforms.uFadeNear = { value: 62 };
    shader.uniforms.uFadeFar = { value: 145 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uFadeNear;\nuniform float uFadeFar;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec4 grassWorld = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        #else
          vec4 grassWorld = modelMatrix * vec4(transformed, 1.0);
        #endif
        float grassD = distance(grassWorld.xz, cameraPosition.xz);
        transformed *= 1.0 - smoothstep(uFadeNear, uFadeFar, grassD);`);
    grassMat.userData.shader = shader;
  };
  const grassCount = 9000;
  const grass = new THREE.InstancedMesh(grassGeo, grassMat, grassCount);
  let placed = 0, guard = 0;
  while (placed < grassCount && guard < grassCount * 6) {
    guard++;
    const x = (R() - 0.5) * 340, z = (R() - 0.5) * 220 + 4;
    if (blocked(x, z, 1)) continue;
    const h = terrainHeight(x, z);
    if (h < -0.4) continue;
    dummy.position.set(x, h + 0.01, z);
    dummy.rotation.set(0, R() * 6.28, 0);
    dummy.scale.setScalar(0.55 + R() * 0.9);
    dummy.updateMatrix(); grass.setMatrixAt(placed, dummy.matrix);
    const g = 0.72 + R() * 0.5;
    grass.setColorAt(placed, new THREE.Color().setRGB(g * 0.9, g, g * 0.68));
    placed++;
  }
  grass.count = placed;
  grass.castShadow = false; grass.receiveShadow = false;
  grass.userData.fullCount = placed; grass.userData.maxCount = placed;
  grass.instanceMatrix.needsUpdate = true;
  group.add(grass);

  /* --- 芦苇、荷叶、莲花 --- */
  const reedGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.025, 0.045, 2.0, 4).translate(0, 1, 0).toNonIndexed(),
    new THREE.CylinderGeometry(0.09, 0.07, 0.42, 6).translate(0, 2.1, 0).toNonIndexed(),
  ], false);
  const reedMat = new THREE.MeshStandardMaterial({ color: 0x7b8a4a, roughness: 1 });
  const reeds = new THREE.InstancedMesh(reedGeo, reedMat, 420);
  const lilyMat = new THREE.MeshStandardMaterial({ color: 0x4c7040, roughness: 0.9, side: THREE.DoubleSide });
  const lily = new THREE.InstancedMesh(new THREE.CircleGeometry(0.62, 10), lilyMat, 220);
  const flowerMat = new THREE.MeshStandardMaterial({ color: 0xe8b7c2, roughness: 0.75 });
  const flowers = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.24, 0), flowerMat, 90);
  let ri = 0, li = 0, fi = 0, rg = 0;
  while ((ri < 420 || li < 220) && rg < 9000) {
    rg++;
    const a = R() * Math.PI * 2;
    const edge = lakeShoreAngle(a) * (0.72 + R() * 0.32);
    const x = LAKE_C[0] + Math.cos(a) * LAKE_R[0] * edge;
    const z = LAKE_C[1] + Math.sin(a) * LAKE_R[1] * edge;
    if (R() < 0.55 && ri < 420) {
      dummy.position.set(x, -0.5, z); dummy.rotation.set((R() - 0.5) * 0.2, R() * 6.28, (R() - 0.5) * 0.2);
      dummy.scale.setScalar(0.6 + R() * 0.75); dummy.updateMatrix(); reeds.setMatrixAt(ri++, dummy.matrix);
    } else if (li < 220) {
      dummy.position.set(x + (R() - 0.5) * 5, -0.52 + R() * 0.04, z + (R() - 0.5) * 4);
      dummy.rotation.set(-Math.PI / 2, 0, R() * 6.28);
      dummy.scale.setScalar(0.6 + R() * 0.7); dummy.updateMatrix(); lily.setMatrixAt(li++, dummy.matrix);
      if (fi < 90 && R() < 0.42) {
        dummy.position.y += 0.18; dummy.rotation.set(0, R() * 6.28, 0);
        dummy.scale.setScalar(0.7 + R() * 0.8); dummy.updateMatrix(); flowers.setMatrixAt(fi++, dummy.matrix);
      }
    }
  }
  reeds.count = ri; lily.count = li; flowers.count = fi;
  [reeds, lily, flowers].forEach(m => { m.instanceMatrix.needsUpdate = true; m.castShadow = false; group.add(m); });

  /* --- 散落残石与倾倒柱身 --- */
  const rub = ctx.rubble;
  const rubble = new THREE.InstancedMesh(chamferBoxGeo(1, 1, 1, 0.06), M.stone, rub.length);
  rub.forEach((p, i) => {
    dummy.position.set(p.pos[0], terrainHeight(p.pos[0], p.pos[2]) + p.s * 0.28, p.pos[2]);
    dummy.rotation.set((R() - 0.5) * 0.7, p.rot, (R() - 0.5) * 0.7);
    dummy.scale.set(p.s * (1 + R() * 0.7), p.s * (0.4 + R() * 0.5), p.s * (0.7 + R() * 0.6));
    dummy.updateMatrix(); rubble.setMatrixAt(i, dummy.matrix);
  });
  rubble.castShadow = true; rubble.receiveShadow = true;
  rubble.instanceMatrix.needsUpdate = true;
  group.add(rubble);
  const drums = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.52, 0.52, 1.5, 14), M.marbleD, 26);
  for (let i = 0; i < 26; i++) {
    const nearHai = i < 13;
    const a = R() * 6.28, rad = 12 + R() * 18;
    const x = (nearHai ? -72 : 40) + Math.cos(a) * rad;
    const z = (nearHai ? 8 : -2) + Math.sin(a) * rad * 0.6;
    dummy.position.set(x, terrainHeight(x, z) + 0.5, z);
    dummy.rotation.set(Math.PI / 2 + (R() - 0.5) * 0.35, R() * 6.28, R() * 0.5);
    dummy.scale.setScalar(0.75 + R() * 0.5);
    dummy.updateMatrix(); drums.setMatrixAt(i, dummy.matrix);
  }
  drums.castShadow = true; drums.receiveShadow = true;
  drums.instanceMatrix.needsUpdate = true;
  group.add(drums);

  /* --- 湖畔石桥 --- */
  const bridge = new THREE.Group();
  const stone = M.marbleD;
  for (let i = 0; i < 9; i++) {
    const bx = 62 + i * 3.1;
    const arch = Math.sin((i / 8) * Math.PI) * 1.4;
    const seg = new THREE.Mesh(boxGeoProxy(3.2, 0.32, 3.4), stone);
    seg.position.set(bx, -0.1 + arch, 92);
    seg.castShadow = true; seg.receiveShadow = true;
    bridge.add(seg);
  }
  for (const s of [-1, 1]) for (let i = 0; i < 9; i++) {
    const rail = new THREE.Mesh(boxGeoProxy(3.2, 0.12, 0.18), stone);
    rail.position.set(62 + i * 3.1, 0.65 + Math.sin((i / 8) * Math.PI) * 1.4, 92 + s * 1.7);
    bridge.add(rail);
    const post = new THREE.Mesh(boxGeoProxy(0.22, 0.72, 0.22), stone);
    post.position.set(62 + i * 3.1, 0.5 + Math.sin((i / 8) * Math.PI) * 1.4, 92 + s * 1.7);
    bridge.add(post);
  }
  group.add(bridge);

  return {
    group, ground, treeMeshes, grass, reeds, lily, flowers, pebbles,
    applyQuality(q) {
      treeMeshes.forEach(m => { m.count = Math.max(1, Math.floor(m.userData.maxCount * q.trees)); });
      grass.count = Math.min(grass.userData.maxCount, q.grass);
      const sh = grassMat.userData.shader;
      if (sh) { sh.uniforms.uFadeNear.value = q.fadeFar * 0.42; sh.uniforms.uFadeFar.value = q.fadeFar; }
      groundMat.map.anisotropy = q.aniso;
      groundMat.map.needsUpdate = true;
    },
  };
}

function boxGeoProxy(w, h, d) { return new THREE.BoxGeometry(w, h, d); }
