/* 良渚 · 水城 —— 水体
 * 自定义 GLSL 水面：多频波纹法线、Fresnel 天空反射、日轮高光、风成条纹、
 * 水下青淤泥浑浊散射与沉积物斑驳、浅滩过渡、岸线柔化、指数高度雾。
 * 四级水面：内城高密度 mask（2.6 m）/ 流域 mask（2.6 m）/
 * 塘山双坝渠道（8.2 m）/ 谷口高坝上游山谷水库（26.0 m）。
 */
import * as THREE from 'three';
import { WORLD, clamp } from './core.js';

const vert = `
  uniform float uTime;
  uniform float uWave;
  uniform vec2 uOrigin;
  uniform vec2 uExtent;
  varying vec3 vWorld;
  varying vec2 vMaskUv;
  varying float vWave;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float t = uTime;
    float w = sin(wp.x * 0.185 + t * 0.88) * cos(wp.z * 0.152 - t * 0.63) * 0.034
            + sin(wp.x * 0.55 - wp.z * 0.33 + t * 1.31) * 0.017
            + sin(wp.x * 1.63 + t * 2.35) * sin(wp.z * 1.29 - t * 2.08) * 0.007;
    wp.y += w * uWave;
    vWave = w;
    vWorld = wp.xyz;
    vMaskUv = (wp.xz - uOrigin) / uExtent + 0.5;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const frag = `
  precision highp float;
  uniform sampler2D uMask;
  uniform vec3 uSkyTop, uSkyHorizon, uSunDir, uSunColor, uFogColor, uCamPos;
  uniform float uTime, uFogDensity, uWind, uHour, uClipCore;
  uniform vec2 uClipHalf;
  varying vec3 vWorld;
  varying vec2 vMaskUv;
  varying float vWave;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm2(vec2 p){
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 4; i++){ s += a * noise(p); p *= 2.07; a *= 0.5; }
    return s;
  }
  float waveH(vec2 p, float t){
    return sin(p.x * 0.185 + t * 0.88) * cos(p.y * 0.152 - t * 0.63) * 0.034
         + sin(p.x * 0.55 - p.y * 0.33 + t * 1.31) * 0.017
         + sin(p.x * 1.63 + t * 2.35) * sin(p.y * 1.29 - t * 2.08) * 0.007;
  }
  void main(){
    if (uClipCore > 0.5 && abs(vWorld.x) < uClipHalf.x && abs(vWorld.z) < uClipHalf.y) discard;
    vec4 m = texture2D(uMask, vMaskUv);
    float cover = m.r;
    if (cover < 0.028) discard;
    float depth = m.g;       // 0 浅 → 1 深
    float turb  = m.b;       // 淤泥浑浊度
    vec2 p = vWorld.xz;
    float t = uTime;

    /* 多频解析波纹法线 + 毛细涟漪 */
    float e = 0.26;
    float hL = waveH(p - vec2(e, 0.0), t), hR = waveH(p + vec2(e, 0.0), t);
    float hD = waveH(p - vec2(0.0, e), t), hU = waveH(p + vec2(0.0, e), t);
    vec3 N = normalize(vec3(-(hR - hL) / (2.0 * e), 1.0, -(hU - hD) / (2.0 * e)));
    float cx = cos(p.x * 2.7 + t * 3.0) * 0.018, cz = cos(p.y * 2.3 - t * 2.6) * 0.018;
    N = normalize(N + vec3(cx, 0.0, cz));
    vec3 V = normalize(uCamPos - vWorld);
    vec3 R = reflect(-V, N);
    vec3 L = normalize(uSunDir);

    /* 天空反射：湿地浑浊水体只保留被压低的漫反射天空，避免掠射角一片死白 */
    float up = clamp(R.y * 1.65 + 0.05, 0.0, 1.0);
    vec3 sky = mix(uSkyHorizon, uSkyTop, pow(up, 0.72)) * 0.46;
    float sd = max(dot(R, L), 0.0);
    sky += uSunColor * pow(sd, 220.0) * 0.85 + uSunColor * pow(sd, 13.0) * 0.040;
    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.1);

    /* 水下青淤泥：沉积物斑驳、有机质暗斑、水草投影 */
    float mud = fbm2(p * 0.085);
    float grain = fbm2(p * 0.46);
    float mottle = smoothstep(0.36, 0.78, fbm2(p * 0.043 + 7.0));
    vec3 siltCol = mix(vec3(0.050, 0.064, 0.046), vec3(0.132, 0.138, 0.086), mud * 0.82 + grain * 0.18);
    siltCol *= 0.68 + 0.56 * mottle;
    siltCol += vec3(0.018, 0.024, 0.010) * smoothstep(0.62, 0.90, grain);   // 腐殖质亮斑
    vec3 shallow = mix(vec3(0.078, 0.112, 0.080), siltCol, 0.74 * turb);
    vec3 deep = vec3(0.032, 0.065, 0.059) + vec3(0.016, 0.020, 0.010) * mud;
    vec3 body = mix(shallow, deep, smoothstep(0.02, 0.72, depth));
    body = mix(body, siltCol * 0.90, (1.0 - depth) * 0.46 * turb);           // 浅水淤泥可见

    vec3 col = mix(body, sky, clamp(fres * 0.32 + 0.045, 0.0, 0.40));
    col = mix(col, siltCol * 0.86, 0.16 * turb * (1.0 - depth));              // 悬浮泥沙压低反射

    /* 波峰微光、镜面高光、风成条纹与俯视可辨的水面波纹 */
    float spec = pow(max(dot(reflect(-L, N), V), 0.0), 118.0);
    col += uSunColor * spec * 0.16;
    col += vec3(0.013, 0.017, 0.015) * clamp(vWave * 13.0, 0.0, 1.0);
    float ripple = sin(p.x * 1.12 + t * 1.55 + sin(p.y * 0.58) * 1.35)
                 * sin(p.y * 0.84 - t * 1.12 + sin(p.x * 0.41) * 0.9);
    col += vec3(0.004, 0.005, 0.004) * ripple * (0.35 + 0.65 * uWind);
    float streak = sin(p.x * 0.72 - t * 0.65) * sin(p.y * 0.47 + t * 0.38);
    col += vec3(0.008, 0.010, 0.009) * streak * uWind;

    /* 岸线：湿泥 / 浅滩悬浮泥沙过渡 */
    float edge = 1.0 - smoothstep(0.03, 0.34, cover);
    col = mix(col, vec3(0.108, 0.114, 0.086) + siltCol * 0.30, edge * (0.34 + 0.35 * turb));

    /* 航拍水汽：轻微去饱和 + 高度雾 */
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(lum) * vec3(0.96, 1.0, 0.98), 0.055);
    float dist = length(vWorld - uCamPos);
    float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    col = mix(col, uFogColor, clamp(fog, 0.0, 0.93));
    gl_FragColor = vec4(col, 1.0);
  }`;

function makeSurface(name, y, tex, extent, origin, seg, clip, shared) {
  const uniforms = {
    uMask: { value: tex },
    uTime: shared.uTime,
    uWave: shared.uWave,
    uOrigin: { value: new THREE.Vector2(origin[0], origin[1]) },
    uExtent: { value: new THREE.Vector2(extent[0], extent[1]) },
    uSkyTop: shared.uSkyTop,
    uSkyHorizon: shared.uSkyHorizon,
    uSunDir: shared.uSunDir,
    uSunColor: shared.uSunColor,
    uFogColor: shared.uFogColor,
    uCamPos: shared.uCamPos,
    uFogDensity: shared.uFogDensity,
    uWind: shared.uWind,
    uHour: shared.uHour,
    uClipCore: { value: clip ? 1 : 0 },
    uClipHalf: { value: new THREE.Vector2(WORLD.coreHalf[0], WORLD.coreHalf[1]) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: vert, fragmentShader: frag,
    side: THREE.DoubleSide, transparent: false, depthWrite: true,
  });
  const geo = new THREE.PlaneGeometry(extent[0], extent[1], seg[0], seg[1]);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(origin[0], y, origin[1]);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return mesh;
}

export function createWater(scene, masks, q) {
  const shared = {
    uTime: { value: 0 },
    uWave: { value: 1 },
    uSkyTop: { value: new THREE.Color(0x6f8ea9) },
    uSkyHorizon: { value: new THREE.Color(0xc9d0c4) },
    uSunDir: { value: new THREE.Vector3(0.4, 0.55, 0.7).normalize() },
    uSunColor: { value: new THREE.Color(0xffe6c0) },
    uFogColor: { value: new THREE.Color(0xbcc7c2) },
    uCamPos: { value: new THREE.Vector3() },
    uFogDensity: { value: 0.00016 },
    uWind: { value: 0.7 },
    uHour: { value: WORLD.sunDefaultHour },
  };
  const s = q.waterSeg[0];
  const surfaces = [
    makeSurface('内城水面 · 高密度水网', WORLD.waterY, masks.core, masks.coreExtent, masks.coreOrigin,
      [Math.round(s * 0.8), Math.round(s * 0.84)], false, shared),
    makeSurface('流域水面 · 湿地与库区', WORLD.waterY, masks.basin, masks.basinExtent, masks.basinOrigin,
      [s, Math.round(s * 0.84)], true, shared),
    makeSurface('塘山双坝渠道水面 · 8.2m', WORLD.channelY, masks.mid, masks.midExtent, masks.midOrigin,
      [Math.round(s * 0.34), Math.round(s * 0.24)], false, shared),
    makeSurface('谷口高坝上游水库 · 26m', WORLD.uplandY, masks.high, masks.highExtent, masks.highOrigin,
      [Math.round(s * 0.34), Math.round(s * 0.24)], false, shared),
  ];
  surfaces.forEach(m => scene.add(m));
  return {
    surfaces, uniforms: shared,
    setTime(t) { shared.uTime.value = t; },
    setCamera(cam) { shared.uCamPos.value.copy(cam.position); },
    setWind(w) { shared.uWind.value = w; shared.uWave.value = 0.65 + w * 0.6; },
    setSky(s) {
      shared.uSkyTop.value.copy(s.skyTop);
      shared.uSkyHorizon.value.copy(s.skyHorizon);
      shared.uSunDir.value.copy(s.sunDir);
      shared.uSunColor.value.copy(s.sunColor);
      shared.uFogColor.value.copy(s.fogColor);
      shared.uFogDensity.value = s.fogDensity;
      shared.uHour.value = s.hour;
    },
  };
}
