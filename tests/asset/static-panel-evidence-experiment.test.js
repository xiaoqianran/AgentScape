import { readFile } from 'node:fs/promises';
import { Document, WebIO } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { inferStaticPanelHypotheses } from '../../dev/experiments/asset/static-panel-evidence.mjs';

function emptyScene() {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('World');
  doc.getRoot().setDefaultScene(scene);
  function box(name, min, max) {
    const [x0, y0, z0] = min, [x1, y1, z1] = max;
    const positions = new Float32Array([
      x0,y0,z0, x1,y0,z0, x1,y1,z0, x0,y1,z0,
      x0,y0,z1, x1,y0,z1, x1,y1,z1, x0,y1,z1
    ]);
    const triangles = new Uint16Array([
      0,1,2, 0,2,3, 4,6,5, 4,7,6,
      0,4,5, 0,5,1, 1,5,6, 1,6,2,
      2,6,7, 2,7,3, 3,7,4, 3,4,0
    ]);
    const primitive = doc.createPrimitive().setAttribute('POSITION',
      doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(triangles).setBuffer(buffer));
    scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name + 'Mesh').addPrimitive(primitive)));
  }
  return { doc, box };
}

describe('P0 static-geometry panel hypotheses are never automatically executable', () => {
  it('finds a planar panel on a real GLB after erasing meaningful node names', async () => {
    const doc = await new WebIO().readBinary(new Uint8Array(await readFile('public/assets/cabinet.glb')));
    doc.getRoot().listNodes().forEach((node, index) => node.setName('N_' + String(index).padStart(3,'0')));
    const report = inferStaticPanelHypotheses(doc);
    expect(report.candidates).toHaveLength(1);
    expect(report.candidates[0]).toMatchObject({
      kind:'planar-panel-near-body-face',
      jointTypeHypothesis:'revolute', status:'hypothesis',
      executable:false, physicsVerified:false
    });
    expect(report.candidates[0].alternatives).toHaveLength(2);
    expect(report.candidates[0].alternatives[0].worldHingeLinePoint[0]).toBeCloseTo(-.82,2);
    expect(report.candidates[0].alternatives[1].worldHingeLinePoint[0]).toBeCloseTo(.8,2);
    expect(report.candidates[0].missing).toContain('which-hinge');
  });

  it('detects a front rectangular panel using geometry without semantics', async () => {
    const { doc, box } = emptyScene();
    box('B_001', [-.9,0,-.35], [.9,2,.35]);
    box('P_001', [-.82,.1,.34], [.82,1.9,.42]);
    const report = inferStaticPanelHypotheses(await new WebIO().readBinary(await new WebIO().writeBinary(doc)));
    expect(report.candidates).toHaveLength(1);
    expect(report.candidates[0]).toMatchObject({
      evidence:{source:'axis-aligned-geometry',face:'front'},
      executable:false,physicsVerified:false
    });
  });

  it('rejects a small knob rather than treating every connected box as a door', async () => {
    const { doc, box } = emptyScene();
    box('B_001', [-.9,0,-.35], [.9,2,.35]);
    box('K_002', [-.06,.8,.34], [.06,.95,.42]);
    expect(inferStaticPanelHypotheses(doc).candidates).toEqual([]);
  });

  it('rejects internal shelves far from a front or back face', async () => {
    const { doc, box } = emptyScene();
    box('B_001', [-.9,0,-.35], [.9,2,.35]);
    box('S_002', [-.8,.8,-.1], [.8,1.1,.1]);
    expect(inferStaticPanelHypotheses(doc).candidates).toEqual([]);
  });

  it('cannot distinguish an identical decorative plate from a real hinged door', () => {
    const { doc, box } = emptyScene();
    box('B_001', [-.9,0,-.35], [.9,2,.35]);
    box('DecorativePlate', [-.82,.1,.34], [.82,1.9,.42]);
    const report = inferStaticPanelHypotheses(doc);
    expect(report.candidates).toHaveLength(1);
    expect(report.candidates[0].missing).toContain('semantic-function');
    expect(report.candidates[0].executable).toBe(false);
    expect(report.limitations).toContain('STATIC_GEOMETRY_CANNOT_PROVE_MOBILITY');
  });
});
