import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  applyGeneratedWorldGeometryTransform,
  applyGeneratedWorldObjectTransform,
  generatedWorldTransformMatrix,
  transformGeneratedWorldBounds,
  transformGeneratedWorldPoint,
  validateGeneratedWorldCoordinates
} from '../../core/generatedWorldCoordinates.js';

describe('generated world coordinate contract', () => {
  it('applies the same z-up to y-up transform to mesh geometry and visual objects', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([1, 2, 3], 3));
    const visual = new THREE.Object3D();
    visual.position.set(1, 2, 3);

    applyGeneratedWorldGeometryTransform(geometry, 'z-up', 2);
    applyGeneratedWorldObjectTransform(visual, 'z-up', 2);

    const meshPoint = new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('position'), 0);
    const visualPoint = visual.getWorldPosition(new THREE.Vector3());
    expect(meshPoint.toArray()).toEqual(expect.arrayContaining([2, 6, -4]));
    expect(visualPoint.x).toBeCloseTo(meshPoint.x, 6);
    expect(visualPoint.y).toBeCloseTo(meshPoint.y, 6);
    expect(visualPoint.z).toBeCloseTo(meshPoint.z, 6);
  });

  it('keeps y-up coordinates unchanged apart from unit scaling', () => {
    const point = new THREE.Vector3(1, 2, 3).applyMatrix4(generatedWorldTransformMatrix('y-up', 0.5));
    expect(point.toArray()).toEqual([0.5, 1, 1.5]);
  });

  it('transforms semantic instance points and bounds with the same generated-world contract', () => {
    const point=transformGeneratedWorldPoint([1,2,3], 'z-up', 2);
    expect(point[0]).toBeCloseTo(2,6);
    expect(point[1]).toBeCloseTo(6,6);
    expect(point[2]).toBeCloseTo(-4,6);
    const bounds=transformGeneratedWorldBounds({min:[0,1,2],max:[2,3,4]},'z-up',2);
    expect(bounds.min[0]).toBeCloseTo(0,6);
    expect(bounds.min[1]).toBeCloseTo(4,6);
    expect(bounds.min[2]).toBeCloseTo(-6,6);
    expect(bounds.max[0]).toBeCloseTo(4,6);
    expect(bounds.max[1]).toBeCloseTo(8,6);
    expect(bounds.max[2]).toBeCloseTo(-2,6);
  });

  it('rejects unsupported coordinate systems and invalid unit scales', () => {
    expect(() => validateGeneratedWorldCoordinates('x-up', 1)).toThrow(/y-up or z-up/);
    expect(() => validateGeneratedWorldCoordinates('z-up', 0)).toThrow(/positive finite/);
  });
});
