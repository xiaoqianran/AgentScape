import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { color, float, mix, smoothstep, uv } from "three/tsl";

export function createObservatoryGround({
  size = 20,
  baseColor = 0x292c3c,
  accentColor = 0x8caaee,
  y = -0.012
} = {}) {
  const centered = uv().sub(0.5);
  const radius = centered.length().mul(2);
  const centerGlow = float(1).sub(smoothstep(0, 0.82, radius));
  const edgeFade = float(1).sub(smoothstep(0.72, 1, radius));

  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: true,
    depthTest: true,
    side: THREE.DoubleSide,
    alphaTest: 0.02
  });
  material.colorNode = mix(color(baseColor), color(accentColor), centerGlow.mul(0.075));
  material.opacityNode = mix(float(0.86), float(0.98), centerGlow).mul(edgeFade);

  const geometry = new THREE.PlaneGeometry(size, size, 1, 1);
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