/* 吴苑澄观 · 天穹、时辰光照、天气与软阴影
 * 天穹 shader（渐变 + 卷积云 + 日轮 + 地平线散射）、太阳/半球/补光、
 * FogExp2 高度雾、三态天气（晴 / 薄霭 / 细雨）与 GPU 顶点动画雨丝。
 */
import * as THREE from 'three';
import { WORLD, QUALITY, clamp, lerp, mulberry32 } from './core.js';

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
    float y = clamp(d.y, -0.12, 1.0);
    vec3 col = mix(uHorizon, uTop, pow(clamp(y * 1.35 + 0.04, 0.0, 1.0), 0.62));
    // 地平线暖散射
    float glow = exp(-abs(y - 0.02) * 9.0);
    col += uSunColor * glow * (0.10 + 0.16 * (1.0 - uSunAlt));
    // 卷积云（沿天穹切平面投影）
    vec2 cp = d.xz / max(0.22, d.y + 0.30);
    float cs = fbm(cp * 1.9 + vec2(uTime * 0.006, uTime * 0.002));
    float cloud = smoothstep(0.46 - uCloud * 0.22, 0.78 - uCloud * 0.14, cs);
    cloud *= smoothstep(0.02, 0.28, y) * (1.0 - smoothstep(0.82, 1.0, y));
    vec3 cloudCol = mix(vec3(0.80, 0.83, 0.84), vec3(0.98, 0.96, 0.92), clamp(uSunAlt, 0.0, 1.0));
    cloudCol = mix(cloudCol * 0.62, cloudCol, uSunAlt);
    col = mix(col, cloudCol, cloud * (0.30 + uCloud * 0.62));
    // 日轮与光晕
    float sd = max(dot(d, normalize(uSunDir)), 0.0);
    col += uSunColor * pow(sd, 1800.0) * 3.2 * (1.0 - uCloud * 0.55);
    col += uSunColor * pow(sd, 42.0) * 0.26 * (1.0 - uRain * 0.6);
    // 雨天压暗与去饱和
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(lum) * vec3(0.88, 0.93, 0.96), uRain * 0.55);
    gl_FragColor = vec4(col, 1.0);
  }`;

const rainVert = `
  uniform float uTime;
  varying float vA;
  void main(){
    vec4 base = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float y = mod(base.y - uTime * 17.0, 26.0) - 13.0;
    vec3 wp = vec3(base.x + position.x + y * 0.10, y + position.y, base.z + position.z);
    vA = 1.0 - smoothstep(10.0, 13.5, abs(y));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(wp, 1.0);
  }`;
const rainFrag = `
  precision highp float;
  uniform float uOpacity;
  varying float vA;
  void main(){ gl_FragColor = vec4(0.78, 0.86, 0.90, vA * uOpacity); }`;

const WEATHER = {
  clear: { cloud: 0.22, fog: 0.0019, rain: 0, light: 1.0, exposure: 1.08, sat: 1.0 },
  mist:  { cloud: 0.58, fog: 0.0038, rain: 0, light: 0.82, exposure: 1.02, sat: 0.92 },
  rain:  { cloud: 0.92, fog: 0.0052, rain: 1, light: 0.62, exposure: 0.94, sat: 0.80 },
};

export function createSky(scene, renderer, M) {
  const state = {
    hour: WORLD.sunDefaultHour,
    weather: 'clear',
    skyTop: new THREE.Color(0x4a78a6),
    skyHorizon: new THREE.Color(0xd4cdb4),
    sunDir: new THREE.Vector3(0.6, 0.6, 0.5).normalize(),
    sunColor: new THREE.Color(0xffe0b0),
    fogColor: new THREE.Color(0xb9c2ba),
    fogDensity: 0.0019,
    rain: 0,
    cloud: 0.22,
  };

  /* 天穹 */
  const skyUniforms = {
    uTop: { value: state.skyTop },
    uHorizon: { value: state.skyHorizon },
    uSunDir: { value: state.sunDir },
    uSunColor: { value: state.sunColor },
    uCloud: { value: state.cloud },
    uTime: { value: 0 },
    uRain: { value: 0 },
    uSunAlt: { value: 0.6 },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1400, 40, 24),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms, vertexShader: skyVert, fragmentShader: skyFrag,
      side: THREE.BackSide, depthWrite: false, fog: false,
    })
  );
  dome.name = '天穹'; dome.frustumCulled = false;
  scene.add(dome);

  /* 光照 */
  const sun = new THREE.DirectionalLight(0xffe0b0, 2.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = -180; sc.right = 180; sc.top = 165; sc.bottom = -165; sc.near = 1; sc.far = 900;
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.024;
  sun.shadow.radius = 2.2;
  sun.target.position.set(0, 0, -8);
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0x91aec6, 0x77805e, 0.86);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0xbfc8c4, 0.26);
  scene.add(ambient);
  const fill = new THREE.DirectionalLight(0xa8c2d8, 0.34);
  fill.position.set(90, 60, 120);
  scene.add(fill);

  scene.fog = new THREE.FogExp2(state.fogColor.getHex(), state.fogDensity);

  /* 雨丝：InstancedMesh + 顶点动画，整体跟随相机 */
  let rain = null;
  function buildRain(count) {
    if (rain) { scene.remove(rain); rain.geometry.dispose(); rain.material.dispose(); }
    const geo = new THREE.BoxGeometry(0.012, 0.82, 0.012);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0.42 } },
      vertexShader: rainVert, fragmentShader: rainFrag,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    rain = new THREE.InstancedMesh(geo, mat, count);
    rain.name = '细雨'; rain.frustumCulled = false; rain.visible = false;
    const rnd = mulberry32(1357), m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      m.makeTranslation((rnd() - 0.5) * 76, rnd() * 26, (rnd() - 0.5) * 76);
      rain.setMatrixAt(i, m);
    }
    rain.instanceMatrix.needsUpdate = true;
    rain.userData.mat = mat;
    scene.add(rain);
  }
  buildRain(QUALITY.high.rain);

  /* 时辰与天气 */
  const tmpTop = new THREE.Color(), tmpHz = new THREE.Color(), tmpSun = new THREE.Color(), tmpFog = new THREE.Color();
  function setHour(h) {
    state.hour = clamp(h, 5.5, 19.5);
    const t = (state.hour - 5.5) / 14;
    const alt = 55 * Math.pow(Math.max(0.02, Math.sin(t * Math.PI)), 1.7) * Math.PI / 180;
    const az = (t - 0.5) * Math.PI;                       // -π/2 东 → 0 南 → π/2 西
    state.sunDir.set(Math.sin(az) * Math.cos(alt), Math.sin(alt), Math.cos(az) * Math.cos(alt)).normalize();
    skyUniforms.uSunAlt.value = Math.sin(alt);
    const day = clamp(Math.sin(t * Math.PI) * 1.4, 0, 1);
    const golden = 1 - clamp((alt - 0.18) / 0.52, 0, 1);   // 低角度暖光权重
    const dusk = 1 - day;

    // 天空色：日间冷蓝、黄金时刻暖、暮色紫橙
    tmpTop.set(0x3f6fa3).lerp(new THREE.Color(0x2a3a62), dusk * 0.78);
    tmpHz.set(0xc9d4cf).lerp(new THREE.Color(0xe9c79c), golden * 0.72);
    tmpHz.lerp(new THREE.Color(0xc98768), dusk * 0.55);
    tmpSun.set(0xfff4dc).lerp(new THREE.Color(0xffb878), golden * 0.82);
    tmpSun.lerp(new THREE.Color(0xff9a68), dusk * 0.55);

    const w = WEATHER[state.weather];
    if (state.weather === 'rain') {
      tmpTop.lerp(new THREE.Color(0x596a72), 0.78);
      tmpHz.lerp(new THREE.Color(0x9ba7a6), 0.78);
      tmpSun.lerp(new THREE.Color(0xc9d2d0), 0.72);
    } else if (state.weather === 'mist') {
      tmpTop.lerp(new THREE.Color(0x7190a4), 0.48);
      tmpHz.lerp(new THREE.Color(0xc9cec4), 0.52);
    }
    state.skyTop.copy(tmpTop); state.skyHorizon.copy(tmpHz); state.sunColor.copy(tmpSun);
    tmpFog.copy(tmpHz).lerp(tmpTop, 0.34);
    if (state.weather === 'rain') tmpFog.lerp(new THREE.Color(0x9aa6a6), 0.55);
    state.fogColor.copy(tmpFog);
    state.fogDensity = w.fog;
    scene.fog.color.copy(state.fogColor);
    scene.fog.density = state.fogDensity;

    sun.color.copy(state.sunColor);
    sun.intensity = (0.42 + day * 2.05) * w.light;
    sun.position.copy(state.sunDir).multiplyScalar(340);
    hemi.color.copy(tmpTop).lerp(new THREE.Color(0xffffff), 0.32);
    hemi.groundColor.set(0x6e7658);
    hemi.intensity = (0.48 + day * 0.46) * (state.weather === 'rain' ? 0.82 : 1);
    ambient.intensity = 0.20 + dusk * 0.16;
    fill.intensity = 0.24 + (1 - day) * 0.16;
    renderer.toneMappingExposure = w.exposure * (0.92 + day * 0.10);

    // 暮色点亮廊下灯笼
    M.lantern.emissiveIntensity = 0.12 + dusk * 2.1 + (state.weather === 'rain' ? 0.5 : 0);
    renderer.shadowMap.needsUpdate = true;
    return state;
  }
  function setWeather(w) {
    if (!WEATHER[w]) return state;
    state.weather = w;
    const cfg = WEATHER[w];
    state.cloud = cfg.cloud; state.rain = cfg.rain;
    skyUniforms.uCloud.value = cfg.cloud;
    skyUniforms.uRain.value = cfg.rain;
    if (rain) { rain.visible = cfg.rain > 0; rain.userData.mat.uniforms.uOpacity.value = 0.42; }
    setHour(state.hour);
    return state;
  }
  function setQuality(q) {
    sun.shadow.mapSize.set(q.shadow, q.shadow);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    if (rain) {
      rain.count = Math.min(rain.instanceMatrix.count, Math.round(q.rain));
    }
    renderer.shadowMap.needsUpdate = true;
  }

  return {
    dome, sun, hemi, state, rain,
    setHour, setWeather, setQuality,
    getState: () => state,
    update(t, camera) {
      skyUniforms.uTime.value = t;
      dome.position.copy(camera.position);
      if (rain && rain.visible) {
        rain.position.set(camera.position.x, 10, camera.position.z);
        rain.userData.mat.uniforms.uTime.value = t;
      }
    },
  };
}
