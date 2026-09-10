import * as THREE from "three";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";

let installed = false;

export function installThreeBvhRuntime() {
  THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
  THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
  THREE.Mesh.prototype.raycast = acceleratedRaycast;
  installed = true;
  return bvhRuntimeStatus();
}

export function bvhRuntimeStatus() {
  return {
    installed: installed
      && THREE.BufferGeometry.prototype.computeBoundsTree === computeBoundsTree
      && THREE.BufferGeometry.prototype.disposeBoundsTree === disposeBoundsTree
      && THREE.Mesh.prototype.raycast === acceleratedRaycast,
    raycast: THREE.Mesh.prototype.raycast === acceleratedRaycast ? "three-mesh-bvh" : "three-default"
  };
}

export function ensureBoundsTrees(root) {
  let meshCount = 0;
  let builtCount = 0;
  root?.traverse?.((node) => {
    if (!node.isMesh || !node.geometry) return;
    meshCount += 1;
    if (!node.geometry.boundsTree) {
      node.geometry.computeBoundsTree?.();
      if (node.geometry.boundsTree) builtCount += 1;
    }
  });
  return { meshCount, builtCount };
}
