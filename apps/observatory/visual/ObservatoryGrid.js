import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { color, float, fract, fwidth, mix, positionWorld, smoothstep } from "three/tsl";

const gridLine = (coord, stepSize) => {
  const scaled = coord.div(stepSize);
  const derivative = fwidth(scaled).max(0.0001);
  const distanceToLine = fract(scaled.sub(0.5)).sub(0.5).abs().div(derivative);
  return float(1).sub(distanceToLine.x.min(distanceToLine.y).min(1));
};

export function createObservatoryGrid({ size = 24, minorStep = 0.5, majorStep = 2 } = {}) {
  const world = positionWorld.xz;
  const minor = gridLine(world, minorStep);
  const major = gridLine(world, majorStep);
  const xAxis = float(1).sub(smoothstep(0, fwidth(world.y).mul(1.5).add(0.008), world.y.abs()));
  const zAxis = float(1).sub(smoothstep(0, fwidth(world.x).mul(1.5).add(0.008), world.x.abs()));
  const radius = world.length();
  const fade = float(1).sub(smoothstep(size * 0.29, size * 0.5, radius));

  let colorNode = mix(color(0x51576d), color(0x737994), major);
  colorNode = mix(colorNode, color(0x8caaee), xAxis.mul(0.8));
  colorNode = mix(colorNode, color(0x85c1dc), zAxis.mul(0.8));
  const alpha = minor.mul(0.13)
    .max(major.mul(0.34))
    .max(xAxis.mul(0.48))
    .max(zAxis.mul(0.48))
    .mul(fade);

  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    alphaTest: 0.012
  });
  material.colorNode = colorNode;
  material.opacityNode = alpha;

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