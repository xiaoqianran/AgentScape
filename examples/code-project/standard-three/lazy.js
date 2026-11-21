import * as THREE from 'three';
export function spin(mesh) {
  if (!(mesh instanceof THREE.Object3D)) throw new TypeError('THREE_INSTANCE_MISMATCH');
  mesh.rotation.y += Math.PI / 4;
}
