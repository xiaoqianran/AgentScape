import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import {
  bvhRuntimeStatus,
  disposeBoundsTrees,
  ensureBoundsTrees
} from '../../modules/rendering/spatial/ThreeBvhRuntime.js';

const meshRaycast = THREE.Mesh.prototype.raycast;
const prototypeComputeBoundsTree = THREE.BufferGeometry.prototype.computeBoundsTree;
const prototypeDisposeBoundsTree = THREE.BufferGeometry.prototype.disposeBoundsTree;

describe('scoped Three.js BVH runtime', () => {
  it('does not modify Three.js prototypes when imported', () => {
    expect(THREE.Mesh.prototype.raycast).toBe(meshRaycast);
    expect(THREE.BufferGeometry.prototype.computeBoundsTree).toBe(prototypeComputeBoundsTree);
    expect(THREE.BufferGeometry.prototype.disposeBoundsTree).toBe(prototypeDisposeBoundsTree);
    expect(bvhRuntimeStatus()).toMatchObject({ installed: false, scope: 'object-instance' });
  });

  it('accelerates owned meshes and restores their raycast on release', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const result = ensureBoundsTrees(mesh);

    expect(result).toMatchObject({ meshCount: 1, builtCount: 1, acceleratedCount: 1 });
    expect(mesh.raycast).not.toBe(meshRaycast);
    expect(mesh.geometry.boundsTree).toBeTruthy();
    expect(THREE.Mesh.prototype.raycast).toBe(meshRaycast);

    disposeBoundsTrees(mesh);

    expect(mesh.raycast).toBe(meshRaycast);
    expect(mesh.geometry.boundsTree).toBeFalsy();
    mesh.geometry.dispose();
    mesh.material.dispose();
  });

  it('preserves a pre-existing geometry BVH on release', () => {
    const geometry = new THREE.BoxGeometry();
    computeBoundsTree.call(geometry);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());

    ensureBoundsTrees(mesh);
    disposeBoundsTrees(mesh);

    expect(geometry.boundsTree).toBeTruthy();
    disposeBoundsTree.call(geometry);
    geometry.dispose();
    mesh.material.dispose();
  });

  it('keeps a shared owned geometry alive until its last mesh is released', () => {
    const geometry = new THREE.BoxGeometry();
    const first = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    const second = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    const root = new THREE.Group().add(first, second);

    ensureBoundsTrees(root);
    disposeBoundsTrees(first);

    expect(geometry.boundsTree).toBeTruthy();
    disposeBoundsTrees(second);

    expect(geometry.boundsTree).toBeFalsy();
    geometry.dispose();
    first.material.dispose();
    second.material.dispose();
  });

  it('preserves a mesh with an explicit custom raycast', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const customRaycast = () => [];
    mesh.raycast = customRaycast;

    const result = ensureBoundsTrees(mesh);

    expect(result.acceleratedCount).toBe(0);
    expect(mesh.raycast).toBe(customRaycast);
    expect(mesh.geometry.boundsTree).toBeTruthy();

    disposeBoundsTrees(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  });
});
