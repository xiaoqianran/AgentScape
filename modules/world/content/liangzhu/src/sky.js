/* 良渚 · 水城 —— 天光与江南湿地水汽
 * 柔和漫射天光（低对比太阳 + 强半球/环境补光 + 大半径软阴影）、
 * 渐变云天穹、可调节时辰、三态天气、相机朝向的水汽精灵与细雨。
 */
import * as THREE from 'three';
import { WORLD, QUALITY, clamp, lerp, mulberry32 } from './core.js';
import { waterSDF } from './hydro.js';

const skyVert = `
  varying vec3 vDir;
  void main(){
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const skyFrag = `
  precision highp float;
  uniform vec3 uTop, uHorizon, uSunDir, uSunColor;
  uniform float uCloud, uTime, uRain, uSunAlt;
  varying vec3 vDir;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0,0.0)), u.x),
               mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);
  }
  float fbm(vec2 p){
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; i++){ s += a * noise(p); p *= 2.03; a *= 0.5; }
    return s;
  }
  void main(){
    vec3 d = normalize(vDir);
    float y = clamp(d.y, -0.10, 1.0);
    vec3 col = mix(uHorizon, uTop, pow(clamp(y * 1.28 + 0.05, 0.0, 1.0), 0.66));
    float glow = exp(-abs(y - 0.015) * 8.0);
    col += uSunColor * glow * (0.09 + 0.15 * (1.0 - uSunAlt));
    vec2 cp = d.xz / max(0.22, d.y + 0.31);
    float cs = fbm(cp * 1.7 + vec2(uTime * 0.005, uTime * 0.0018));
    float cloud = smoothstep(0.44 - uCloud * 0.20, 0.80 - uCloud * 0.13, cs);
    cloud *= smoothstep(0.01, 0.26, y) * (1.0 - smoothstep(0.82, 1.0, y));
    vec3 cloudCol = mix(vec3(0.80, 0.84, 0.84), vec3(0.98, 0.97, 0.93), clamp(uSunAlt, 0.0, 1.0));
    col = mix(col, cloudCol, cloud * (0.26 + uCloud * 0.66));
    float sd = max(dot(d, normalize(uSunDir)), 0.0);
    col += uSunColor * pow(sd, 1100.0) * 1.9 * (1.0 - uCloud * 0.72);
    col += uSunColor * pow(sd, 30.0) * 0.20 * (1.0 - uRain * 0.65);
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(lum) * vec3(0.90, 0.95, 0.98), uRain * 0.52);
    gl_FragColor = vec4(col, 1.0);
  }`;

/* 相机朝向水汽精灵：GPU 顶点动画，CPU 零逐帧更新 */
const mistVert = `
  uniform float uTime;
  uniform vec3 uCamPos;
  varying vec2 vUv;
  varying float vFade;
  void main(){
    vec3 c = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
    float sc = length(instanceMatrix[0].xyz);
    vec3 wp = vec3(
      c.x + sin(uTime * 0.13 + c.z * 0.0021) * 34.0,
      c.y + sin(uTime * 0.21 + c.x * 0.0034) * 1.6,
      c.z + cos(uTime * 0.11 + c.x * 0.0019) * 26.0);
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 pos = wp + (right * position.x + up * position.y) * sc;
    vUv = uv;
    float dist = length(wp - uCamPos);
    /* 低空贴地水汽；随相机升高快速淡出，避免航拍时被大片白幕覆盖 */
    float altitudeFade = 1.0 - 0.88 * smoothstep(90.0, 560.0, uCamPos.y);
    vFade = (1.0 - smoothstep(1300.0, 5200.0, dist)) * smoothstep(30.0, 260.0, dist) * altitudeFade;
    gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
  }`;
const mistFrag = `
  precision highp float;
  uniform sampler2D uMap;
  uniform float uOpacity;
  uniform vec3 uTint;
  varying vec2 vUv;
  varying float vFade;
  void main(){
    vec4 t = texture2D(uMap, vUv);
    gl_FragColor = vec4(uTint * t.rgb, t.a * uOpacity * vFade);
  }`;
const rainVert = `
  uniform float uTime;
  varying float vA;
  void main(){
    vec4 base = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float y = mod(base.y - uTime * 19.0, 40.0) - 20.0;
    vec3 wp = vec3(base.x + position.x + y * 0.08, y + position.y, base.z + position.z);
    vA = 1.0 - smoothstep(16.0, 20.0, abs(y));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(wp, 1.0);
  }`;
const rainFrag = `
  precision highp float;
  uniform float uOpacity;
  varying float vA;
  void main(){ gl_FragColor = vec4(0.80, 0.87, 0.90, vA * uOpacity); }`;

const WEATHER = {
  clear: { cloud: 0.20, fog: 0.000075, rain: 0, light: 1.00, exposure: 1.02, mist: 0.35, name: '晴' },
  mist:  { cloud: 0.58, fog: 0.000095, rain: 0, light: 0.80, exposure: 0.99, mist: 1.00, name: '湿地水汽' },
  rain:  { cloud: 0.92, fog: 0.000210, rain: 1, light: 0.62, exposure: 0.93, mist: 0.70, name: '细雨' },
};

export function createSky(scene, renderer, M, q) {
  const state = {
    hour: WORLD.sunDefaultHour, weather: 'mist', vapor: 1.0,
    skyTop: new THREE.Color(0x7d9bb2), skyHorizon: new THREE.Color(0xd2d6c9),
    sunDir: new THREE.Vector3(0.55, 0.45, 0.6).normalize(),
    sunColor: new THREE.Color(0xffeed2), fogColor: new THREE.Color(0xc3ccc5),
    fogDensity: WEATHER.mist.fog, rain: 0, cloud: WEATHER.mist.cloud,
    mist: WEATHER.mist.mist,
  };
  const skyUniforms = {
    uTop: { value: state.skyTop }, uHorizon: { value: state.skyHorizon },
    uSunDir: { value: state.sunDir }, uSunColor: { value: state.sunColor },
    uCloud: { value: state.cloud }, uTime: { value: 0 },
    uRain: { value: 0 }, uSunAlt: { value: 0.5 },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(7000, 40, 24),
    new THREE.ShaderMaterial({ uniforms: skyUniforms, vertexShader: skyVert, fragmentShader: skyFrag,
      side: THREE.BackSide, depthWrite: false, fog: false })
  );
  dome.name = '江南天穹'; dome.frustumCulled = false; dome.renderOrder = -10;
  scene.add(dome);

  /* 柔和漫射天光：太阳低对比 + 强半球补光 + 环境光 + 反向冷补光 */
  const sun = new THREE.DirectionalLight(0xffeed2, 1.05);
  sun.castShadow = true;
  sun.shadow.mapSize.set(q.shadow, q.shadow);
  const sc = sun.shadow.camera;
  sc.left = -2600; sc.right = 2600; sc.top = 2600; sc.bottom = -2600; sc.near = 1; sc.far = 7200;
  sun.shadow.bias = -0.00028; sun.shadow.normalBias = 0.9; sun.shadow.radius = 3.2;
  sun.target.position.set(-600, 0, -900);
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xa9c4d2, 0x707b5a, 1.18);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0xc8d2cc, 0.38);
  scene.add(ambient);
  const fill = new THREE.DirectionalLight(0xa9c2ce, 0.34);
  fill.position.set(1200, 500, 1400);
  scene.add(fill);
  scene.fog = new THREE.FogExp2(state.fogColor.getHex(), state.fogDensity);

  /* 水汽精灵：沿水域与浅滩分布 */
  const mistMat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: M.mist.map }, uTime: { value: 0 },
      uOpacity: { value: 0.55 }, uTint: { value: new THREE.Color(0xe6ece8) },
      uCamPos: { value: new THREE.Vector3() },
    },
    vertexShader: mistVert, fragmentShader: mistFrag,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  let mist = null;
  function buildMist(count) {
    if (mist) { scene.remove(mist); mist.geometry.dispose(); }
    const geo = new THREE.PlaneGeometry(1, 1);
    mist = new THREE.InstancedMesh(geo, mistMat, count);
    mist.name = '江南湿地水汽'; mist.frustumCulled = false; mist.renderOrder = 4;
    const rnd = mulberry32(19360707), m = new THREE.Matrix4();
    let made = 0, guard = 0;
    while (made < count && guard++ < count * 40) {
      const x = (rnd() - 0.5) * 10800, z = (rnd() - 0.5) * 9000;
      const d = waterSDF(x, z);
      if (d > 90 || d < -160) continue;
      const s = 60 + rnd() * 165;
      m.compose(new THREE.Vector3(x, 3.6 + rnd() * 9, z),
        new THREE.Quaternion(), new THREE.Vector3(s, s * (0.20 + rnd() * 0.18), 1));
      mist.setMatrixAt(made++, m);
    }
    mist.count = made;
    mist.instanceMatrix.needsUpdate = true;
    scene.add(mist);
  }
  buildMist(q.mist);

  /* 细雨 */
  let rain = null;
  function buildRain(count) {
    if (rain) { scene.remove(rain); rain.geometry.dispose(); }
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0.30 } },
      vertexShader: rainVert, fragmentShader: rainFrag,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    rain = new THREE.InstancedMesh(new THREE.BoxGeometry(0.014, 0.9, 0.014), mat, count);
    rain.name = '细雨'; rain.frustumCulled = false; rain.visible = false; rain.renderOrder = 5;
    const rnd = mulberry32(2468), m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      m.makeTranslation((rnd() - 0.5) * 130, rnd() * 40, (rnd() - 0.5) * 130);
      rain.setMatrixAt(i, m);
    }
    rain.instanceMatrix.needsUpdate = true;
    rain.userData.mat = mat;
    scene.add(rain);
  }
  buildRain(Math.round(q.mist * 5));

  const tmpTop = new THREE.Color(), tmpHz = new THREE.Color(), tmpSun = new THREE.Color(), tmpFog = new THREE.Color();
  function setHour(h) {
    state.hour = clamp(h, 5.5, 19.0);
    const t = (state.hour - 5.5) / 13.5;
    const alt = 58 * Math.pow(Math.max(0.02, Math.sin(t * Math.PI)), 1.55) * Math.PI / 180;
    const az = (t - 0.5) * Math.PI;
    state.sunDir.set(Math.sin(az) * Math.cos(alt), Math.sin(alt), Math.cos(az) * Math.cos(alt)).normalize();
    skyUniforms.uSunAlt.value = Math.sin(alt);
    const day = clamp(Math.sin(t * Math.PI) * 1.45, 0, 1);
    const golden = 1 - clamp((alt - 0.20) / 0.55, 0, 1);
    const dusk = 1 - day;
    tmpTop.set(0x6288a8).lerp(new THREE.Color(0x334767), dusk * 0.68);
    tmpHz.set(0xcbd5cd).lerp(new THREE.Color(0xe8cfac), golden * 0.58);
    tmpHz.lerp(new THREE.Color(0xc89076), dusk * 0.40);
    tmpSun.set(0xfff4dd).lerp(new THREE.Color(0xffc38c), golden * 0.72);
    const w = WEATHER[state.weather];
    if (state.weather === 'rain') {
      tmpTop.lerp(new THREE.Color(0x69787c), 0.76);
      tmpHz.lerp(new THREE.Color(0xa4aeaa), 0.74);
      tmpSun.lerp(new THREE.Color(0xcdd6d2), 0.66);
    } else if (state.weather === 'mist') {
      tmpTop.lerp(new THREE.Color(0x8ba5ae), 0.34);
      tmpHz.lerp(new THREE.Color(0xd6d8ce), 0.48);
    }
    state.skyTop.copy(tmpTop); state.skyHorizon.copy(tmpHz); state.sunColor.copy(tmpSun);
    tmpFog.copy(tmpHz).lerp(tmpTop, 0.28);
    if (state.weather === 'rain') tmpFog.lerp(new THREE.Color(0x9ea9a7), 0.48);
    state.fogColor.copy(tmpFog);
    state.fogDensity = w.fog * (0.55 + state.vapor * 0.45);
    scene.fog.color.copy(state.fogColor);
    scene.fog.density = state.fogDensity;

    sun.color.copy(state.sunColor);
    sun.intensity = (0.42 + day * 1.05) * w.light;
    sun.position.copy(state.sunDir).multiplyScalar(3600);
    sun.position.add(new THREE.Vector3(-600, 0, -900));
    hemi.color.copy(tmpTop).lerp(new THREE.Color(0xffffff), 0.34);
    hemi.groundColor.set(0x6f7b59);
    hemi.intensity = (0.90 + day * 0.42) * (state.weather === 'rain' ? 0.86 : 1);
    ambient.intensity = 0.32 + dusk * 0.12;
    fill.intensity = 0.26 + (1 - day) * 0.14;
    renderer.toneMappingExposure = w.exposure * (0.96 + day * 0.06);
    state.mist = w.mist * state.vapor;
    mistMat.uniforms.uOpacity.value = 0.045 + state.mist * 0.155;
    renderer.shadowMap.needsUpdate = true;
    return state;
  }
  function setWeather(w) {
    if (!WEATHER[w]) return state;
    state.weather = w;
    const cfg = WEATHER[w];
    state.cloud = cfg.cloud; state.rain = cfg.rain;
    skyUniforms.uCloud.value = cfg.cloud; skyUniforms.uRain.value = cfg.rain;
    if (rain) { rain.visible = cfg.rain > 0; rain.userData.mat.uniforms.uOpacity.value = 0.30; }
    setHour(state.hour);
    return state;
  }
  function setVapor(v) { state.vapor = clamp(v, 0, 1.6); setHour(state.hour); return state; }
  function setQuality(nq) {
    sun.shadow.mapSize.set(nq.shadow, nq.shadow);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    buildMist(nq.mist);
    renderer.shadowMap.needsUpdate = true;
  }
  setWeather('mist');

  return {
    dome, sun, hemi, state, rain,
    get mist() { return mist; },
    setHour, setWeather, setVapor, setQuality,
    getState: () => state,
    update(t, camera) {
      skyUniforms.uTime.value = t;
      dome.position.copy(camera.position);
      mistMat.uniforms.uTime.value = t;
      mistMat.uniforms.uCamPos.value.copy(camera.position);
      if (rain && rain.visible) {
        rain.position.set(camera.position.x, 14, camera.position.z);
        rain.userData.mat.uniforms.uTime.value = t;
      }
    },
  };
}
