/* 天空、云层、黄金时刻日照与大气雾 */
import * as THREE from 'three';

const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = `
precision highp float;
varying vec3 vDir;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform float uTime;
uniform float uHaze;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1.0,0.0)), u.x),
             mix(hash(i+vec2(0.0,1.0)), hash(i+vec2(1.0,1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for(int i=0;i<5;i++){ v += a*noise(p); p *= 2.03; a *= 0.5; }
  return v;
}
void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.62));
  // 地平线暖色带与大气散射
  float glowBand = exp(-h * 9.0);
  col = mix(col, uHorizon * 1.06, glowBand * 0.55);
  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSunColor * pow(sd, 7.0) * 0.22 * uHaze;
  col += uSunColor * pow(sd, 130.0) * 0.85;
  col += uSunColor * pow(sd, 2600.0) * 7.0;
  // 卷积云：以方向投影到云层平面
  vec2 cp = d.xz / max(d.y + 0.14, 0.05);
  float n = fbm(cp * 0.20 + vec2(uTime * 0.0025, uTime * 0.0012));
  float n2 = fbm(cp * 0.62 + vec2(-uTime * 0.003, 0.0));
  float cloud = smoothstep(0.48, 0.68, n * 0.78 + n2 * 0.22) * smoothstep(-0.01, 0.10, h);
  vec3 cloudCol = mix(uHorizon * 1.02, vec3(1.0, 0.97, 0.92), 0.35 + pow(sd, 4.0) * 0.5);
  col = mix(col, cloudCol, cloud * 0.55);
  // 贴地薄雾
  col = mix(col, uHorizon, exp(-max(d.y, -0.05) * 22.0) * 0.32);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const KEYS = [
  { h: 5.5,  zen: '#3c5480', hor: '#d99a76', sun: '#ff9a5e', inten: 0.5,  expo: 0.78, hemi: 0.35 },
  { h: 8,    zen: '#4a7db5', hor: '#ddc6a6', sun: '#ffd9a3', inten: 2.7,  expo: 1.02, hemi: 0.56 },
  { h: 12,   zen: '#3974bb', hor: '#c6dbe9', sun: '#fff4e2', inten: 3.8,  expo: 1.08, hemi: 0.70 },
  { h: 16.4, zen: '#4d79ab', hor: '#d7b18c', sun: '#ffcf94', inten: 3.5,  expo: 1.16, hemi: 0.60 },
  { h: 18.3, zen: '#3f5482', hor: '#d98b69', sun: '#ff945c', inten: 1.15, expo: 0.98, hemi: 0.42 },
  { h: 19.6, zen: '#222f55', hor: '#7d5a68', sun: '#ff7b52', inten: 0.22, expo: 0.85, hemi: 0.28 },
];

const c = hex => new THREE.Color(hex);

export function createSky(scene, renderer) {
  const uniforms = {
    uSunDir: { value: new THREE.Vector3(-0.6, 0.4, 0.5) },
    uSunColor: { value: c('#ffc78a') },
    uZenith: { value: c('#6287b4') },
    uHorizon: { value: c('#e9bd8b') },
    uTime: { value: 0 },
    uHaze: { value: 1 },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1400, 40, 22),
    new THREE.ShaderMaterial({
      uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      side: THREE.BackSide, depthWrite: false, fog: false,
    })
  );
  sky.renderOrder = -1000;
  sky.frustumCulled = false;
  scene.add(sky);

  const sun = new THREE.DirectionalLight(0xffc78a, 3.05);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = -125; sc.right = 125; sc.top = 125; sc.bottom = -125;
  sc.near = 1; sc.far = 520;
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 2.2;
  sun.target.position.set(-10, 0, 0);
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(0xbdd6ea, 0x9a8160, 0.66);
  scene.add(hemi);
  // 微弱环境光托起背光立面的暗部，避免深阴影形成纯黑块
  const ambient = new THREE.AmbientLight(0xc9d4dd, 0.42);
  scene.add(ambient);
  const fill = new THREE.DirectionalLight(0x9dbcd8, 0.55);
  fill.position.set(90, 70, -100);
  scene.add(fill);

  const fog = new THREE.FogExp2(0xd8c4ac, 0.00155);
  scene.fog = fog;

  const lamps = [];
  [[-72, 6, 12], [40, 4, 6], [40, 6, -28], [-138, 5, 12]].forEach(([x, y, z]) => {
    const p = new THREE.PointLight(0xffb56b, 0, 26, 2);
    p.position.set(x, y, z);
    scene.add(p);
    lamps.push(p);
  });

  const api = {
    uniforms, sun, hemi, fill, fog, sky, lamps,
    sunDir: new THREE.Vector3(),
    setHour(hour) {
      const t = Math.min(Math.max(hour, KEYS[0].h), KEYS[KEYS.length - 1].h);
      let i = 0;
      while (i < KEYS.length - 2 && t > KEYS[i + 1].h) i++;
      const a = KEYS[i], b = KEYS[i + 1];
      const k = (t - a.h) / (b.h - a.h);
      const lerpC = (ca, cb) => c(ca).lerp(c(cb), k);
      const zen = lerpC(a.zen, b.zen), hor = lerpC(a.hor, b.hor), sunC = lerpC(a.sun, b.sun);
      uniforms.uZenith.value.copy(zen);
      uniforms.uHorizon.value.copy(hor);
      uniforms.uSunColor.value.copy(sunC);
      const p = (t - 6) / 12;
      const elev = Math.sin(Math.max(0, Math.min(1, p)) * Math.PI) * 0.86 + 0.045;
      const az = Math.PI * (0.12 + Math.max(0, Math.min(1, p)) * 0.74);
      const dir = new THREE.Vector3(Math.cos(az), elev, Math.sin(az) * 0.72).normalize();
      api.sunDir.copy(dir);
      uniforms.uSunDir.value.copy(dir);
      sun.position.copy(dir).multiplyScalar(210);
      sun.target.position.set(-10, 0, 0);
      sun.color.copy(sunC);
      sun.intensity = THREE.MathUtils.lerp(a.inten, b.inten, k);
      hemi.intensity = THREE.MathUtils.lerp(a.hemi, b.hemi, k);
      hemi.color.copy(zen).lerp(c('#dce9f2'), 0.45);
      fill.intensity = 0.46 + (1 - elev) * 0.38;
      renderer.toneMappingExposure = THREE.MathUtils.lerp(a.expo, b.expo, k);
      fog.color.copy(hor).lerp(zen, 0.24);
      fog.density = 0.00092 + (1 - elev) * 0.00048;
      uniforms.uHaze.value = 0.55 + (1 - elev) * 0.85;
      const dusk = THREE.MathUtils.clamp((18.1 - t) / 2.2, 0, 1) * THREE.MathUtils.clamp((t - 16.8) / 1.6, 0, 1);
      lamps.forEach(l => { l.intensity = dusk * 16; });
      api.dusk = dusk;
      renderer.shadowMap.needsUpdate = true;
    },
    setShadowSize(size) {
      if (sun.shadow.mapSize.x === size) return;
      sun.shadow.mapSize.set(size, size);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      renderer.shadowMap.needsUpdate = true;
    },
    update(dt, camera) {
      uniforms.uTime.value += dt;
      sky.position.copy(camera.position);
    },
  };
  return api;
}
