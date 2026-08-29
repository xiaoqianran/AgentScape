import * as THREE from "three";

const vertexShader = `
  varying vec3 vWorldPosition;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPosition = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = `
  varying vec3 vWorldPosition;
  uniform vec3 uMinorColor;
  uniform vec3 uMajorColor;
  uniform vec3 uAxisXColor;
  uniform vec3 uAxisZColor;
  uniform float uMinorStep;
  uniform float uMajorStep;
  uniform float uFadeDistance;

  float gridLine(vec2 coord, float stepSize) {
    vec2 scaled = coord / stepSize;
    vec2 derivative = max(fwidth(scaled), vec2(0.0001));
    vec2 distanceToLine = abs(fract(scaled - 0.5) - 0.5) / derivative;
    return 1.0 - min(min(distanceToLine.x, distanceToLine.y), 1.0);
  }

  void main() {
    vec2 world = vWorldPosition.xz;
    float minor = gridLine(world, uMinorStep);
    float major = gridLine(world, uMajorStep);

    float xAxis = 1.0 - smoothstep(0.0, fwidth(world.y) * 1.5 + 0.008, abs(world.y));
    float zAxis = 1.0 - smoothstep(0.0, fwidth(world.x) * 1.5 + 0.008, abs(world.x));

    float radius = length(world);
    float fade = 1.0 - smoothstep(uFadeDistance * 0.58, uFadeDistance, radius);
    float alpha = max(minor * 0.13, major * 0.34);
    vec3 color = mix(uMinorColor, uMajorColor, major);

    if (xAxis > 0.0) {
      color = mix(color, uAxisXColor, xAxis * 0.8);
      alpha = max(alpha, xAxis * 0.48);
    }
    if (zAxis > 0.0) {
      color = mix(color, uAxisZColor, zAxis * 0.8);
      alpha = max(alpha, zAxis * 0.48);
    }

    alpha *= fade;
    if (alpha < 0.012) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

export function createObservatoryGrid({ size = 24, minorStep = 0.5, majorStep = 2 } = {}) {
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    extensions: { derivatives: true },
    uniforms: {
      uMinorColor: { value: new THREE.Color(0x51576d) },
      uMajorColor: { value: new THREE.Color(0x737994) },
      uAxisXColor: { value: new THREE.Color(0x8caaee) },
      uAxisZColor: { value: new THREE.Color(0x85c1dc) },
      uMinorStep: { value: minorStep },
      uMajorStep: { value: majorStep },
      uFadeDistance: { value: size * 0.5 }
    }
  });

  const geometry = new THREE.PlaneGeometry(size, size, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = -0.002;
  mesh.renderOrder = -20;
  mesh.name = "observatory-grid";

  const origin = new THREE.Mesh(
    new THREE.RingGeometry(0.055, 0.075, 40),
    new THREE.MeshBasicMaterial({ color: 0x8caaee, transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide })
  );
  origin.rotation.x = -Math.PI / 2;
  origin.position.y = 0.004;
  origin.renderOrder = -19;

  const group = new THREE.Group();
  group.name = "observatory-grid-system";
  group.add(mesh, origin);
  group.userData.dispose = () => {
    geometry.dispose();
    material.dispose();
    origin.geometry.dispose();
    origin.material.dispose();
  };
  return group;
}

export function disposeObservatoryGrid(grid) {
  grid?.userData?.dispose?.();
}
