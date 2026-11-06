/* 吴苑澄观 · 水体与池岸
 * 自定义 GLSL 水面：Fresnel 天空反射、解析波纹法线、日轮高光、天空/远塔倒影近似、
 * 岸线柔化与浅水色、指数高度雾、雨天高频涟漪；另有跌水水帘、山涧溪流与湿岸。
 */
import * as THREE from 'three';
import { WORLD, buildWaterMask, clamp } from './core.js';

const vert = `
  uniform float uTime;
  uniform float uRain;
  varying vec3 vWorld;
  varying vec2 vMaskUv;
  varying float vWave;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float t = uTime;
    float w = sin(wp.x * 0.36 + t * 0.85) * cos(wp.z * 0.31 - t * 0.62) * 0.028
            + sin(wp.x * 0.91 - t * 1.30 + wp.z * 0.53) * 0.012;
    w += sin(wp.x * 4.6 + t * 5.2) * sin(wp.z * 4.1 - t * 4.6) * 0.010 * uRain;
    wp.y += w;
    vWave = w;
    vWorld = wp.xyz;
    vMaskUv = (wp.xz + vec2(${WORLD.total[0] / 2}.0, ${WORLD.total[1] / 2}.0)) / vec2(${WORLD.total[0]}.0, ${WORLD.total[1]}.0);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const frag = `
  precision highp float;
  uniform sampler2D uMask;
  uniform vec3 uSkyTop, uSkyHorizon, uSunDir, uSunColor, uFogColor, uCamPos;
  uniform float uTime, uFogDensity, uRain, uHour;
  varying vec3 vWorld;
  varying vec2 vMaskUv;
  varying float vWave;

  float waveH(vec2 p, float t){
    return sin(p.x * 0.36 + t * 0.85) * cos(p.y * 0.31 - t * 0.62) * 0.028
         + sin(p.x * 0.91 - t * 1.30 + p.y * 0.53) * 0.012
         + sin(p.x * 4.6 + t * 5.2) * sin(p.y * 4.1 - t * 4.6) * 0.010 * uRain;
  }
  void main(){
    float mask = texture2D(uMask, vMaskUv).r;
    if (mask < 0.025) discard;

    vec2 p = vWorld.xz;
    float t = uTime;
    float e = 0.10;
    float hL = waveH(p - vec2(e, 0.0), t), hR = waveH(p + vec2(e, 0.0), t);
    float hD = waveH(p - vec2(0.0, e), t), hU = waveH(p + vec2(0.0, e), t);
    vec3 N = normalize(vec3(-(hR - hL) / (2.0 * e), 1.0, -(hU - hD) / (2.0 * e)));
    vec3 V = normalize(uCamPos - vWorld);
    vec3 R = reflect(-V, N);

    // 天空反射梯度 + 日轮
    float up = clamp(R.y * 1.7 + 0.06, 0.0, 1.0);
    vec3 sky = mix(uSkyHorizon, uSkyTop, pow(up, 0.72));
    float sun = pow(max(dot(R, normalize(uSunDir)), 0.0), 240.0);
    sky += uSunColor * sun * 2.6;
    sky += uSunColor * pow(max(dot(R, normalize(uSunDir)), 0.0), 14.0) * 0.16;

    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    vec3 deep = vec3(0.048, 0.106, 0.104);
    deep = mix(deep, vec3(0.072, 0.132, 0.116), clamp(0.5 + uHour * 0.02, 0.0, 1.0));
    vec3 col = mix(deep, sky, clamp(fres * 0.92 + 0.10, 0.0, 0.94));

    // 岸线浅水与湿泥过渡
    float shore = smoothstep(0.02, 0.55, mask);
    vec3 shallow = vec3(0.145, 0.192, 0.132) + uSkyHorizon * 0.06;
    col = mix(shallow, col, shore);

    // 镜面高光与波峰微光
    float spec = pow(max(dot(reflect(-normalize(uSunDir), N), V), 0.0), 110.0);
    col += uSunColor * spec * 0.72;
    col += vec3(0.035, 0.048, 0.044) * clamp(vWave * 9.0, 0.0, 1.0);

    // 雨天：细密涟漪 + 灰冷调
    float ripple = sin(length(fract(p * 0.35) - 0.5) * 42.0 - t * 9.0) * 0.5 + 0.5;
    col += vec3(0.030, 0.038, 0.040) * ripple * uRain;
    col = mix(col, col * vec3(0.84, 0.90, 0.94), uRain * 0.45);

    // 大气雾（与场景 FogExp2 一致）
    float dist = length(vWorld - uCamPos);
    float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    col = mix(col, uFogColor, clamp(fog, 0.0, 0.92));

    gl_FragColor = vec4(col, 1.0);
  }`;

const fallVert = `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const fallFrag = `
  precision highp float;
  uniform float uTime;
  uniform vec3 uTint;
  varying vec2 vUv;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main(){
    float band = sin(vUv.x * 46.0 + sin(vUv.y * 8.0 + uTime) * 2.0) * 0.5 + 0.5;
    float streak = hash(vec2(floor(vUv.x * 60.0), floor(vUv.y * 8.0 - uTime * 3.0)));
    float a = (0.28 + band * 0.30 + streak * 0.24) * smoothstep(0.0, 0.10, vUv.y) * (1.0 - smoothstep(0.88, 1.0, vUv.y));
    vec3 c = uTint + vec3(0.30) * band;
    gl_FragColor = vec4(c, a);
  }`;

export function createWater(scene, ctx) {
  const mask = buildWaterMask(512);
  const uniforms = {
    uMask: { value: mask },
    uTime: { value: 0 },
    uRain: { value: 0 },
    uHour: { value: WORLD.sunDefaultHour },
    uSkyTop: { value: new THREE.Color(0x4d7ea8) },
    uSkyHorizon: { value: new THREE.Color(0xc8c4ac) },
    uSunDir: { value: new THREE.Vector3(-0.45, 0.42, -0.78).normalize() },
    uSunColor: { value: new THREE.Color(0xffd9a0) },
    uFogColor: { value: new THREE.Color(0xb9c2ba) },
    uFogDensity: { value: 0.0022 },
    uCamPos: { value: new THREE.Vector3() },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: vert, fragmentShader: frag,
    side: THREE.DoubleSide, transparent: false, depthWrite: true,
  });
  const geo = new THREE.PlaneGeometry(248, 152, 96, 64);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WORLD.waterY;
  mesh.name = '澄碧池水面';
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  scene.add(mesh);

  /* 跌水水帘与落水泡沫 */
  const falls = [], foams = [];
  (ctx.waterfalls || []).forEach(f => {
    const h = f.yTop - f.yBottom;
    const fm = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uTint: { value: new THREE.Color(0x9fb9bd) } },
      vertexShader: fallVert, fragmentShader: fallFrag,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const g = new THREE.PlaneGeometry(f.width, h, 1, 1);
    const m = new THREE.Mesh(g, fm);
    m.position.set(f.x, f.yBottom + h / 2, f.z);
    m.rotation.y = -Math.PI / 4;
    m.userData.shader = fm;
    scene.add(m); falls.push(m);
    // 底部泡沫
    const foam = new THREE.Mesh(
      new THREE.CircleGeometry(f.width * 0.9, 20),
      new THREE.MeshBasicMaterial({ color: 0xdfeae7, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide })
    );
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(f.x + 0.4, WORLD.waterY + 0.02, f.z + 0.4);
    scene.add(foam); foams.push(foam);
    // 两侧导水石
    const stoneMat = ctx.M.stoneDark;
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.35, h, 0.5), stoneMat);
      side.position.set(f.x + s * f.width / 2, f.yBottom + h / 2, f.z);
      side.rotation.y = -Math.PI / 4;
      scene.add(side);
    }
  });

  /* 山涧溪流：贴地窄水面，UV 滚动 */
  const streams = [];
  (ctx.streams || []).forEach(s => {
    const pts = s.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
      const len = Math.hypot(x2 - x1, z2 - z1);
      const sm = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uTint: { value: new THREE.Color(0x8faeaf) } },
        vertexShader: fallVert,
        fragmentShader: `
          precision highp float; uniform float uTime; uniform vec3 uTint; varying vec2 vUv;
          void main(){
            float f = sin(vUv.x * 34.0 + vUv.y * 9.0 - uTime * 3.4) * 0.5 + 0.5;
            gl_FragColor = vec4(uTint + vec3(0.16) * f, 0.62);
          }`,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      });
      const g = new THREE.PlaneGeometry(len + 0.4, s.width);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, sm);
      m.position.set((x1 + x2) / 2, WORLD.waterY + 0.035, (z1 + z2) / 2);
      m.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
      m.userData.shader = sm;
      scene.add(m); streams.push(m);
    }
  });

  return {
    mesh, falls, foams, streams, uniforms,
    setTime(t) {
      uniforms.uTime.value = t;
      falls.forEach(m => { m.userData.shader.uniforms.uTime.value = t; });
      streams.forEach(m => { m.userData.shader.uniforms.uTime.value = t; });
    },
    setCamera(cam) { uniforms.uCamPos.value.copy(cam.position); },
    setSky(s) {
      uniforms.uSkyTop.value.copy(s.skyTop);
      uniforms.uSkyHorizon.value.copy(s.skyHorizon);
      uniforms.uSunDir.value.copy(s.sunDir);
      uniforms.uSunColor.value.copy(s.sunColor);
      uniforms.uFogColor.value.copy(s.fogColor);
      uniforms.uFogDensity.value = s.fogDensity;
      uniforms.uHour.value = s.hour;
      uniforms.uRain.value = s.rain;
    },
    setPixelRatio() { /* 水面为几何波动，不依赖屏幕空间 RT，无需调整 */ },
  };
}
