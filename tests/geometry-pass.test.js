import { Document } from '@gltf-transform/core';
import { expect, it } from 'vitest';
import { GeometryPass } from '../asset/compiler/passes/GeometryPass.js';

it('uses the default scene after normalization and keeps structure warnings', async () => {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const positions = doc.createAccessor().setType('VEC3').setArray(new Float32Array([
    -1,0,-1, 1,0,-1, 1,2,1
  ])).setBuffer(buffer);
  const primitive = doc.createPrimitive().setAttribute('POSITION', positions);
  const node = doc.createNode('Box').setMesh(doc.createMesh('Mesh').addPrimitive(primitive));
  const scene = doc.createScene('Scene').addChild(node);
  doc.getRoot().setDefaultScene(scene);

  const result = await new GeometryPass().run({
    document: doc,
    inspection: { nodes: [{ name:'Box' }] },
    structure: { warnings: [{ code:'TEST', severity:'advisory', message:'test' }] }
  });

  expect(result.geometry.bounds.min[1]).toBeCloseTo(0, 6);
  expect(result.geometry.maxSide).toBeCloseTo(2, 6);
  expect(result.geometry.warnings[0].code).toBe('TEST');
});
