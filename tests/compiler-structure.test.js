import { Document, getBounds } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { StructurePass } from '../src/compiler/passes/StructurePass.js';
import { NormalizeTransformPass } from '../src/compiler/passes/NormalizeTransformPass.js';

function meshNode(doc, name, translation = [0,0,0], scale = [1,1,1]) {
  const buffer = doc.createBuffer();
  const positions = doc.createAccessor().setType('VEC3').setArray(new Float32Array([
    -1,0,-1, 1,0,-1, 1,2,1, -1,2,1
  ])).setBuffer(buffer);
  const indices = doc.createAccessor().setType('SCALAR').setArray(new Uint16Array([0,1,2,0,2,3])).setBuffer(buffer);
  const primitive = doc.createPrimitive().setAttribute('POSITION', positions).setIndices(indices);
  const mesh = doc.createMesh(name).addPrimitive(primitive);
  return doc.createNode(name).setMesh(mesh).setTranslation(translation).setScale(scale);
}

describe('Compiler structure and normalization', () => {
  it('reports risky structure instead of flattening it', async () => {
    const doc = new Document();
    const sceneA = doc.createScene('A');
    const sceneB = doc.createScene('B');
    const root = meshNode(doc, 'Root', [3,4,5], [-1,2,1]);
    const joint = doc.createNode('Joint'); root.addChild(joint); sceneA.addChild(root);
    sceneB.addChild(meshNode(doc, 'Other'));
    doc.createSkin('Skin').addJoint(joint);
    doc.createAnimation('Idle');

    const result = await new StructurePass().run({ document: doc });
    expect(result.structure.scenes).toBe(2);
    expect(result.structure.maxDepth).toBe(2);
    expect(result.structure.policy.flatten).toBe(false);
    expect(result.structure.negativeScaleNodes).toContain('Root');
    expect(result.structure.warnings.map((x) => x.code)).toEqual(expect.arrayContaining([
      'MULTIPLE_SCENES', 'DEFAULT_SCENE_MISSING', 'NEGATIVE_SCALE', 'SKINNED_ASSET', 'ANIMATED_ASSET'
    ]));
  });

  it('centers the asset on X/Z and places its bottom at Y=0 without flattening hierarchy', async () => {
    const doc = new Document();
    const scene = doc.createScene('Scene'); doc.getRoot().setDefaultScene(scene);
    const root = meshNode(doc, 'Root', [3,4,5]);
    const child = doc.createNode('Child'); root.addChild(child); scene.addChild(root);
    const structure = (await new StructurePass().run({ document: doc })).structure;
    await new NormalizeTransformPass().run({ document: doc, structure });

    const bounds = getBounds(scene);
    expect(bounds.min[1]).toBeCloseTo(0, 5);
    expect((bounds.min[0] + bounds.max[0]) / 2).toBeCloseTo(0, 5);
    expect((bounds.min[2] + bounds.max[2]) / 2).toBeCloseTo(0, 5);
    expect(root.listChildren()).toContain(child);
  });

  it('uses a wrapper node when animated data exists, preserving the animated root transform', async () => {
    const doc = new Document();
    const scene = doc.createScene('Scene'); doc.getRoot().setDefaultScene(scene);
    const root = meshNode(doc, 'AnimatedRoot', [2,3,4]); scene.addChild(root);
    doc.createAnimation('Animation');
    const structure = (await new StructurePass().run({ document: doc })).structure;
    await new NormalizeTransformPass().run({ document: doc, structure });

    expect(scene.listChildren()).toHaveLength(1);
    expect(scene.listChildren()[0].getName()).toBe('Pivot');
    expect(scene.listChildren()[0].listChildren()[0]).toBe(root);
    expect(root.getTranslation()).toEqual([2,3,4]);
  });
});
