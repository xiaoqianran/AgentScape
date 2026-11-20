import * as THREE from "three";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";

const acceleratedObjects = new WeakMap();
const registeredGeometryByObject = new WeakMap();
const geometryReferenceCounts = new WeakMap();
const ownedBoundsTrees = new WeakSet();
let acceleratedObjectCount = 0;

function canAccelerateMesh(node) {
  return node?.isMesh
    && node.geometry
    && !Object.prototype.hasOwnProperty.call(node, "raycast")
    && node.raycast === THREE.Mesh.prototype.raycast;
}

function enableAcceleratedRaycast(node) {
  if (!canAccelerateMesh(node) || acceleratedObjects.has(node)) return false;
  acceleratedObjects.set(node, true);
  node.raycast = acceleratedRaycast;
  acceleratedObjectCount += 1;
  return true;
}

function restoreAcceleratedRaycast(node) {
  if (!acceleratedObjects.has(node)) return false;
  if (node.raycast === acceleratedRaycast) delete node.raycast;
  acceleratedObjects.delete(node);
  acceleratedObjectCount = Math.max(0, acceleratedObjectCount - 1);
  return true;
}

function releaseGeometry(geometry) {
  if (!geometry) return false;
  const referenceCount = geometryReferenceCounts.get(geometry) || 0;
  if (referenceCount > 1) {
    geometryReferenceCounts.set(geometry, referenceCount - 1);
    return false;
  }
  geometryReferenceCounts.delete(geometry);
  return disposeBoundsTreeForGeometry(geometry);
}

export function installThreeBvhRuntime() {
  return bvhRuntimeStatus();
}

export function bvhRuntimeStatus() {
  return {
    installed: false,
    scope: "object-instance",
    acceleratedObjectCount,
    raycast: acceleratedObjectCount > 0 ? "three-mesh-bvh" : "three-default"
  };
}

export function computeBoundsTreeForGeometry(geometry, options) {
  if (!geometry || geometry.boundsTree) return false;
  computeBoundsTree.call(geometry, options);
  if (!geometry.boundsTree) return false;
  ownedBoundsTrees.add(geometry);
  return true;
}

export function disposeBoundsTreeForGeometry(geometry) {
  if (!geometry?.boundsTree || !ownedBoundsTrees.has(geometry)) return false;
  disposeBoundsTree.call(geometry);
  ownedBoundsTrees.delete(geometry);
  geometryReferenceCounts.delete(geometry);
  return true;
}

export function ensureBoundsTrees(root, { accelerateRaycast = true } = {}) {
  let meshCount = 0;
  let builtCount = 0;
  let acceleratedCount = 0;
  root?.traverse?.((node) => {
    if (!node.isMesh || !node.geometry) return;
    meshCount += 1;

    const previousGeometry = registeredGeometryByObject.get(node);
    if (previousGeometry !== node.geometry) {
      releaseGeometry(previousGeometry);
      registeredGeometryByObject.set(node, node.geometry);
      geometryReferenceCounts.set(node.geometry, (geometryReferenceCounts.get(node.geometry) || 0) + 1);
    }

    if (!node.geometry.boundsTree && computeBoundsTreeForGeometry(node.geometry)) builtCount += 1;
    if (accelerateRaycast && enableAcceleratedRaycast(node)) acceleratedCount += 1;
  });
  return { meshCount, builtCount, acceleratedCount };
}

export function disposeBoundsTrees(root) {
  let disposedCount = 0;
  let restoredCount = 0;
  root?.traverse?.((node) => {
    if (!node.isMesh || !node.geometry) return;
    const geometry = registeredGeometryByObject.get(node);
    if (geometry) {
      registeredGeometryByObject.delete(node);
      if (releaseGeometry(geometry)) disposedCount += 1;
    }
    if (restoreAcceleratedRaycast(node)) restoredCount += 1;
  });
  return { disposedCount, restoredCount };
}