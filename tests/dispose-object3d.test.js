import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { disposeObject3D } from '../src/runtime/disposeObject3D.js';

describe('disposeObject3D', () => {
  it('disposes shared geometry/material/texture exactly once within one owned instance', () => {
    const texture = new THREE.Texture(); texture.dispose = vi.fn();
    const material = new THREE.MeshStandardMaterial({ map:texture }); material.dispose = vi.fn();
    const geometry = new THREE.BoxGeometry(); geometry.dispose = vi.fn(); geometry.disposeBoundsTree = vi.fn();
    const root = new THREE.Group();
    root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));

    const result = disposeObject3D(root);
    expect(result).toEqual({ geometries:1, materials:1, textures:1 });
    expect(geometry.disposeBoundsTree).toHaveBeenCalledOnce();
    expect(geometry.dispose).toHaveBeenCalledOnce();
    expect(material.dispose).toHaveBeenCalledOnce();
    expect(texture.dispose).toHaveBeenCalledOnce();
  });

  it('also disposes non-mesh render objects such as helpers and lines', () => {
    const geometry = new THREE.BufferGeometry(); geometry.dispose = vi.fn();
    const material = new THREE.LineBasicMaterial(); material.dispose = vi.fn();
    const root = new THREE.Group(); root.add(new THREE.LineSegments(geometry, material));
    expect(disposeObject3D(root)).toEqual({ geometries:1, materials:1, textures:0 });
    expect(geometry.dispose).toHaveBeenCalledOnce();
    expect(material.dispose).toHaveBeenCalledOnce();
  });

  it('supports material arrays and multiple texture slots without double-disposal', () => {
    const texture = new THREE.Texture(); texture.dispose = vi.fn();
    const a = new THREE.MeshStandardMaterial({ map:texture }); a.dispose = vi.fn();
    const b = new THREE.MeshStandardMaterial({ normalMap:texture }); b.dispose = vi.fn();
    const geometry = new THREE.BoxGeometry(); geometry.dispose = vi.fn();
    const root = new THREE.Mesh(geometry, [a,b]);

    const result = disposeObject3D(root);
    expect(result.textures).toBe(1);
    expect(texture.dispose).toHaveBeenCalledOnce();
    expect(a.dispose).toHaveBeenCalledOnce();
    expect(b.dispose).toHaveBeenCalledOnce();
  });
});
