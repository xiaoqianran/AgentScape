import { readFile } from 'node:fs/promises';
import { Document, WebIO } from '@gltf-transform/core';
import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { inferAnimationMotion } from '../../dev/experiments/asset/motion-evidence.mjs';

function fixture() {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('Scene');
  doc.getRoot().setDefaultScene(scene);
  const positions = doc.createAccessor().setType('VEC3').setArray(
    new Float32Array([0,0,0, .1,0,0, 0,.1,0])).setBuffer(buffer);
  const triangles = doc.createAccessor().setType('SCALAR')
    .setArray(new Uint16Array([0,1,2])).setBuffer(buffer);
  const mesh = doc.createMesh('PlainMesh').addPrimitive(
    doc.createPrimitive().setAttribute('POSITION', positions).setIndices(triangles));
  const part = (name, translation = [0,0,0]) => {
    const node = doc.createNode(name).setMesh(mesh).setTranslation(translation);
    scene.addChild(node);
    return node;
  };
  function animate(node, clip, path, samples, interpolation = 'LINEAR') {
    const input = doc.createAccessor().setType('SCALAR')
      .setArray(new Float32Array(samples.map((_, index) => index))).setBuffer(buffer);
    const output = doc.createAccessor().setType(path === 'rotation' ? 'VEC4' : 'VEC3')
      .setArray(new Float32Array(samples.flat())).setBuffer(buffer);
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(output)
      .setInterpolation(interpolation);
    const animation = doc.getRoot().listAnimations().find(item => item.getName() === clip)
      || doc.createAnimation(clip);
    animation.addSampler(sampler).addChannel(doc.createAnimationChannel()
      .setTargetNode(node).setTargetPath(path).setSampler(sampler));
  }
  return { doc, part, animate };
}
const quat = (axis, angle) => new Quaternion().setFromAxisAngle(new Vector3(...axis), angle).toArray();
const roundTrip = async doc => new WebIO().readBinary(await new WebIO().writeBinary(doc));

describe('P0 non-executable animation motion evidence', () => {
  it('extracts a hinge axis and limits from opaque GLB node names', async () => {
    const { doc, part, animate } = fixture();
    const node = part('N_002', [-.4,.8,.2]);
    animate(node, 'C_008', 'rotation', [quat([0,1,0],0), quat([0,1,0],.6), quat([0,1,0],1.2)]);
    const report = inferAnimationMotion(await roundTrip(doc));
    expect(report.issues).toEqual([]);
    expect(report.candidates).toHaveLength(1);
    expect(report.candidates[0]).toMatchObject({
      node:'N_002',
      hypothesis:{ type:'revolute', axis:[0,1,0], limits:[0,1.2],
        parentAnchor:[-.4,.8,.2], childAnchor:[0,0,0] },
      status:'candidate', executable:false, physicsVerified:false,
      evidence:{ type:'gltf-animation', sampleCount:3 }
    });
  });

  it('detects translational motion without drawer naming', async () => {
    const { doc, part, animate } = fixture();
    const node = part('P_917');
    animate(node, 'Unknown', 'translation', [[0,0,0],[.2,0,0],[.45,0,0]]);
    const report = inferAnimationMotion(await roundTrip(doc));
    expect(report.issues).toEqual([]);
    expect(report.candidates[0].hypothesis).toMatchObject({
      type:'prismatic', axis:[1,0,0], limits:[0,.45]
    });
    expect(report.candidates[0].executable).toBe(false);
  });

  it('does not invent joints for static GLB geometry', async () => {
    const { doc, part } = fixture();
    part('Q_409');
    expect(inferAnimationMotion(await roundTrip(doc)).candidates).toEqual([]);
    const cabinet = await new WebIO().readBinary(new Uint8Array(await readFile('public/assets/cabinet.glb')));
    expect(cabinet.getRoot().listAnimations()).toHaveLength(0);
    expect(inferAnimationMotion(cabinet).candidates).toEqual([]);
  });

  it('blocks compound rotation and translation instead of producing a fake hinge', async () => {
    const { doc, part, animate } = fixture();
    const node = part('Z_404');
    animate(node, 'Complex', 'rotation', [quat([0,1,0],0), quat([0,1,0],.6)]);
    animate(node, 'Complex', 'translation', [[0,0,0],[0,.3,0]]);
    const report = inferAnimationMotion(await roundTrip(doc));
    expect(report.candidates).toEqual([]);
    expect(report.issues.some(item => item.code === 'COMPOUND_MOTION_UNSUPPORTED')).toBe(true);
  });

  it('blocks inconsistent rotation axes in the same track', async () => {
    const { doc, part, animate } = fixture();
    const node = part('Z_309');
    animate(node, 'CompoundRotation', 'rotation',
      [quat([0,1,0],0), quat([0,1,0],.5), quat([1,0,0],.9)]);
    const report = inferAnimationMotion(await roundTrip(doc));
    expect(report.candidates).toEqual([]);
    expect(report.issues.some(item => item.code === 'ROTATION_MULTIPLE_AXES')).toBe(true);
  });

  it('requires review for multiple motion clips affecting the same part', async () => {
    const { doc, part, animate } = fixture();
    const node = part('PartWithoutMeaning');
    animate(node, 'Vertical', 'rotation', [quat([0,1,0],0), quat([0,1,0],1.0)]);
    animate(node, 'Horizontal', 'rotation', [quat([1,0,0],0), quat([1,0,0],.5)]);
    const report = inferAnimationMotion(await roundTrip(doc));
    expect(report.candidates).toEqual([]);
    expect(report.issues.some(item => item.code === 'MULTIPLE_CLIPS_REQUIRE_REVIEW')).toBe(true);
  });

  it('rejects unobserved motion caused by incompatible rest poses', async () => {
    const { doc, part, animate } = fixture();
    const node = part('RestMismatch');
    animate(node, 'Offset', 'translation', [[.5,0,0],[.6,0,0]]);
    const report = inferAnimationMotion(await roundTrip(doc));
    expect(report.candidates).toEqual([]);
    expect(report.issues.some(item => item.code === 'ANIMATION_REST_POSE_MISMATCH')).toBe(true);
  });

  it('rejects unhandled sampler interpolations rather than misreading motion', async () => {
    const { doc, part, animate } = fixture();
    const node = part('StepMotion');
    animate(node, 'Discrete', 'translation', [[0,0,0],[.5,0,0]], 'STEP');
    const report = inferAnimationMotion(await roundTrip(doc));
    expect(report.candidates).toEqual([]);
    expect(report.issues.some(item => item.code === 'INTERPOLATION_UNSUPPORTED')).toBe(true);
  });
});
