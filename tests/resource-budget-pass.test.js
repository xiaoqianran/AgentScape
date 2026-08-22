import { Document } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { ResourceBudgetPass } from '../src/compiler/passes/ResourceBudgetPass.js';
import { RESOURCE_BUDGET } from '../src/compiler/resourceBudget.js';

function documentWithGeometry(vertexCount = 3) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const array = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) { array[i*3] = i; array[i*3+1] = i % 2; }
  const positions = doc.createAccessor().setType('VEC3').setArray(array).setBuffer(buffer);
  const primitive = doc.createPrimitive().setAttribute('POSITION', positions);
  const node = doc.createNode('Mesh').setMesh(doc.createMesh('Mesh').addPrimitive(primitive));
  const scene = doc.createScene('Scene').addChild(node); doc.getRoot().setDefaultScene(scene);
  return doc;
}

describe('ResourceBudgetPass', () => {
  it('reuses glTF-Transform inspect data for optimized runtime metrics', async () => {
    const document = documentWithGeometry();
    const result = await new ResourceBudgetPass().run({
      document,
      optimizedBytes: new Uint8Array(10),
      structure: { defaultSceneIndex: 0 },
      inspection: { stats:{ inputBytes:20 } }
    });
    expect(result.resources.metrics.renderVertices).toBe(3);
    expect(result.resources.metrics.drawCalls).toBe(1);
    expect(result.resources.hard).toEqual([]);
    expect(result.inspection.stats.optimizedBytes).toBe(10);
  });

  it('uses explicit browser admission thresholds rather than silently optimizing expensive assets', async () => {
    const document = documentWithGeometry(RESOURCE_BUDGET.renderVertices.advisory + 1);
    const result = await new ResourceBudgetPass().run({
      document,
      optimizedBytes: new Uint8Array(1),
      structure: { defaultSceneIndex: 0 },
      inspection: { stats:{} }
    });
    expect(result.resources.advisory.some((item) => item.code === 'BUDGET_RENDER_VERTICES')).toBe(true);
  });


  it('counts draw calls only in the runtime default scene', async () => {
    const doc = documentWithGeometry();
    const buffer = doc.getRoot().listBuffers()[0];
    const positions = doc.createAccessor().setType('VEC3').setArray(new Float32Array([0,0,0,1,0,0,0,1,0])).setBuffer(buffer);
    const primitive = doc.createPrimitive().setAttribute('POSITION', positions);
    const mesh = doc.createMesh('Other').addPrimitive(primitive).addPrimitive(primitive.clone());
    doc.createScene('Unused').addChild(doc.createNode('Unused').setMesh(mesh));
    const result = await new ResourceBudgetPass().run({ document:doc, optimizedBytes:new Uint8Array(1), structure:{defaultSceneIndex:0}, inspection:{stats:{}} });
    expect(result.resources.metrics.drawCalls).toBe(1);
  });
});
