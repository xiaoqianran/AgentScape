/* 水体：湖面 / 喷池 / 跌水水帘 / 抛物线喷泉粒子与水流 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { R } from './core.js';

const WATER_VERT = `
uniform float uTime;
uniform float uWave;
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vec3 p = position;
  p.y += (sin(p.x * 0.75 + uTime * 1.35) * 0.038 + sin(p.z * 1.05 - uTime * 1.75) * 0.026) * uWave;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const WATER_FRAG = `
precision highp float;
uniform float uTime;
uniform float uMode;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uDeep;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec2 uLakeCenter;
uniform vec2 uLakeRadii;
varying vec3 vWorld;
varying vec2 vUv;

void main() {
  vec2 p = vWorld.xz;
  float t = uTime;
  vec3 n = normalize(vec3(
    sin(p.x * 1.15 + t * 1.35) * 0.052 + sin(p.y * 2.1 - t * 1.1) * 0.028,
    1.0,
    cos(p.y * 1.35 + t * 1.2) * 0.052 + cos(p.x * 2.4 + t * 0.85) * 0.024));
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 3.0);
  vec3 R = reflect(-V, n);
  vec3 sky = mix(mix(uHorizon, uZenith, 0.48), uZenith, pow(clamp(R.y, 0.0, 1.0), 0.6));
  vec3 col = mix(uDeep, sky, clamp(0.06 + fres * 0.48, 0.0, 1.0));
  // 稀疏的高频波光，避免大面积规则棋盘状高光
  float micro = sin(p.x * 21.0 + t * 2.7) * sin(p.y * 17.0 - t * 2.1);
  float glint = pow(max(dot(reflect(-normalize(uSunDir), n), V), 0.0), 820.0);
  col += uSunColor * (pow(max(micro, 0.0), 14.0) * 0.055 + glint * 0.45);

  if (uMode < 0.5) {
    vec2 q = (vWorld.xz - uLakeCenter) / uLakeRadii;
    float a = atan(q.y, q.x);
    float edge = 1.0 + 0.10 * sin(a * 3.0 + 1.3) + 0.06 * sin(a * 7.0 + 0.4)
                 + 0.025 * sin(a * 13.0 + 2.1);
    float d = length(q);
    if (d > edge) discard;
    float foam = smoothstep(edge - 0.028, edge, d);
    col = mix(col, vec3(0.74, 0.80, 0.78), foam * 0.30);
    col = mix(col, uDeep * 1.05, smoothstep(0.0, 0.7, d) * 0.25);
  } else {
    float d = length(vUv - 0.5) * 2.0;
    float rings = sin(d * 26.0 - t * 3.4) * 0.5 + 0.5;
    col += vec3(0.10, 0.14, 0.15) * rings * (1.0 - d) * 0.35;
    float rim = smoothstep(0.86, 1.0, d);
    col = mix(col, vec3(0.84, 0.90, 0.90), rim * 0.3);
  }
  float dist = length(cameraPosition - vWorld);
  float f = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, clamp(f, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const DROP_VERT = `
attribute vec3 aOrigin;
attribute vec3 aVel;
attribute float aSeed;
attribute float aSize;
attribute float aLife;
uniform float uTime;
uniform float uPixelRatio;
varying float vAlpha;
void main() {
  float t = mod(uTime * 0.82 + aSeed, aLife);
  vec3 p = aOrigin + aVel * t - vec3(0.0, 2.45 * t * t, 0.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPixelRatio * (330.0 / max(-mv.z, 1.0));
  vAlpha = (1.0 - t / aLife) * smoothstep(0.0, 0.10, t);
}`;
const DROP_FRAG = `
precision mediump float;
varying float vAlpha;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float d = length(q);
  float a = smoothstep(0.5, 0.04, d) * vAlpha * 0.8;
  if (a < 0.01) discard;
  gl_FragColor = vec4(mix(vec3(0.66, 0.83, 0.94), vec3(1.0), 1.0 - d * 1.8), a);
}`;

const FLOW_VERT = `
varying vec2 vUvF;
void main(){ vUvF = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const FLOW_FRAG = `
precision mediump float;
uniform float uTime;
uniform float uOpacity;
varying vec2 vUvF;
void main() {
  float band = sin(vUvF.y * 42.0 - uTime * 9.0) * 0.5 + 0.5;
  float streak = sin(vUvF.x * 26.0 + uTime * 1.4) * 0.5 + 0.5;
  float a = (0.12 + band * 0.28 + streak * 0.12) * uOpacity;
  gl_FragColor = vec4(vec3(0.78, 0.90, 0.97), a);
}`;

export function createWater(scene, skyApi, ctx) {
  const shared = {
    uTime: { value: 0 },
    uSunDir: skyApi.uniforms.uSunDir,
    uSunColor: skyApi.uniforms.uSunColor,
    uZenith: skyApi.uniforms.uZenith,
    uHorizon: skyApi.uniforms.uHorizon,
    uFogColor: { value: new THREE.Color() },
    uFogDensity: { value: 0.0015 },
    uLakeCenter: { value: new THREE.Vector2(18, 112) },
    uLakeRadii: { value: new THREE.Vector2(128, 42) },
  };
  const makeMat = (mode, wave, deep) => new THREE.ShaderMaterial({
    uniforms: Object.assign({}, shared, {
      uMode: { value: mode }, uWave: { value: wave }, uDeep: { value: new THREE.Color(deep) },
    }),
    vertexShader: WATER_VERT, fragmentShader: WATER_FRAG,
    side: THREE.DoubleSide, transparent: false, depthWrite: true,
  });
  const lakeMat = makeMat(0, 1.0, '#274145');
  const basinMat = makeMat(1, 0.45, '#315451');

  // 园湖（不规则岸线由片元着色器裁剪）
  const lake = new THREE.Mesh(new THREE.PlaneGeometry(330, 150, 72, 36), lakeMat);
  lake.rotation.x = -Math.PI / 2;
  lake.position.set(18, -0.58, 112);
  lake.receiveShadow = false;
  scene.add(lake);

  // 各喷池水面
  const circle = new THREE.CircleGeometry(1, 56);
  ctx.waters.forEach(w => {
    const m = new THREE.Mesh(circle, basinMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(w.x, w.y, w.z);
    m.scale.set(w.rx, w.rz, 1);
    m.renderOrder = 1;
    scene.add(m);
  });

  // 喷泉粒子
  const origins = [], vels = [], seeds = [], sizes = [], lifes = [];
  const ribbonGeos = [];
  ctx.jets.forEach(j => {
    const life = 1.05 + R() * 0.45;
    const count = j.n * 7;
    for (let i = 0; i < count; i++) {
      origins.push(j.pos[0], j.pos[1], j.pos[2]);
      const spread = 0.2;
      vels.push(
        j.vel[0] + (R() - 0.5) * spread * (Math.abs(j.vel[0]) + 1),
        j.vel[1] + (R() - 0.5) * spread * 2,
        j.vel[2] + (R() - 0.5) * spread * (Math.abs(j.vel[2]) + 1)
      );
      seeds.push(R() * 12);
      sizes.push(j.size * (0.55 + R() * 0.9) * 10);
      lifes.push(life);
    }
    // 主水柱：抛物线水流带
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = (i / 12) * life;
      pts.push(new THREE.Vector3(
        j.pos[0] + j.vel[0] * t,
        j.pos[1] + j.vel[1] * t - 2.45 * t * t,
        j.pos[2] + j.vel[2] * t
      ));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    ribbonGeos.push(new THREE.TubeGeometry(curve, 16, j.size * 0.62, 5, false));
  });
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(origins.map(() => 0), 3));
  pg.setAttribute('aOrigin', new THREE.Float32BufferAttribute(origins, 3));
  pg.setAttribute('aVel', new THREE.Float32BufferAttribute(vels, 3));
  pg.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
  pg.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
  pg.setAttribute('aLife', new THREE.Float32BufferAttribute(lifes, 1));
  const dropUniforms = { uTime: { value: 0 }, uPixelRatio: { value: 1 } };
  const drops = new THREE.Points(pg, new THREE.ShaderMaterial({
    uniforms: dropUniforms, vertexShader: DROP_VERT, fragmentShader: DROP_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  drops.frustumCulled = false;
  drops.renderOrder = 6;
  scene.add(drops);

  const flowUniforms = { uTime: { value: 0 }, uOpacity: { value: 1 } };
  const flowMat = new THREE.ShaderMaterial({
    uniforms: flowUniforms, vertexShader: FLOW_VERT, fragmentShader: FLOW_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const ribbons = new THREE.Mesh(mergeGeometries(ribbonGeos.map(g => g.toNonIndexed()), false), flowMat);
  ribbons.frustumCulled = false;
  ribbons.renderOrder = 5;
  scene.add(ribbons);
  ribbonGeos.forEach(g => g.dispose());

  // 跌水水帘（大水法三级石阶 + 海晏堂跑梯）
  const curtains = [];
  for (let l = 0; l < 3; l++) {
    curtains.push({ x: 40, y: 0.72 - l * 0.14, z: -4.25 + l * 2.4, w: 24 - l * 1.2, h: 0.75 });
  }
  const curtainMeshes = [];
  curtains.forEach(c => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(c.w, c.h, 12, 2), flowMat);
    m.position.set(c.x, c.y + c.h / 2, c.z + 1.15);
    m.renderOrder = 5;
    scene.add(m);
    curtainMeshes.push(m);
  });

  return {
    lake, basinMat, lakeMat, drops, ribbons, flowMat, curtains: curtainMeshes,
    uniforms: shared, dropUniforms, flowUniforms,
    setPixelRatio(p) { dropUniforms.uPixelRatio.value = p; },
    update(dt, sky) {
      shared.uTime.value += dt;
      dropUniforms.uTime.value = shared.uTime.value;
      flowUniforms.uTime.value = shared.uTime.value;
      shared.uFogColor.value.copy(sky.fog.color);
      shared.uFogDensity.value = sky.fog.density;
    },
  };
}
