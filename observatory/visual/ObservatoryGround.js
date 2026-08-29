import * as THREE from "three";

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  varying vec2 vUv;
  uniform vec3 uBaseColor;
  uniform vec3 uAccentColor;

  void main() {
    vec2 centered = vUv - 0.5;
    float radius = length(centered) * 2.0;
    float centerGlow = 1.0 - smoothstep(0.0, 0.82, radius);
    float edgeFade = 1.0 - smoothstep(0.72, 1.0, radius);
    vec3 color = mix(uBaseColor, uAccentColor, centerGlow * 0.075);
    float alpha = mix(0.86, 0.98, centerGlow) * edgeFade;
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

export function createObservatoryGround({
  size = 20,
  baseColor = 0x292c3c,
  accentColor = 0x8caaee,
  y = -0.012
} = {}) {
  const geometry = new THREE.PlaneGeometry(size, size, 1, 1);
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: true,
    depthTest: true,
    side: THREE.DoubleSide,
    uniforms: {
      uBaseColor: { value: new THREE.Color(baseColor) },
      uAccentColor: { value: new THREE.Color(accentColor) }
    }
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "observatory-presentation-ground";
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  mesh.renderOrder = -30;
  mesh.frustumCulled = true;
  mesh.userData.observatoryPresentationOnly = true;
  return mesh;
}

export function disposeObservatoryGround(ground) {
  ground?.geometry?.dispose?.();
  ground?.material?.dispose?.();
}
