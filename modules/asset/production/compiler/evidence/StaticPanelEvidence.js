import { getBounds } from '@gltf-transform/core';

// Report-only front/back planar-panel hypotheses. A static mesh does not prove
// a door or a hinge exists: both edge pivots remain unresolved alternatives.
const round = value => Number(value.toFixed(5));
const boxOf = node => {
  const { min, max } = getBounds(node);
  const size = min.map((value, index) => max[index] - value);
  return { node, min, max, size, volume:size.reduce((product, value) => product * Math.max(0, value), 1) };
};
const overlap = (a, b, index) => Math.max(0, Math.min(a.max[index], b.max[index]) - Math.max(a.min[index], b.min[index]));

export function inferStaticPanelHypotheses(document) {
  const nodes = document.getRoot().listNodes().filter(node => node.getMesh()).map(boxOf)
    .filter(item => item.size.every(value => Number.isFinite(value) && value > 1e-5));
  const body = [...nodes].sort((a, b) => b.volume - a.volume)[0];
  const candidates = [];
  if (!body || body.size[0] < .3 || body.size[1] < .3 || body.size[2] < .15) {
    return { schema:'agentscape.static-panel-experiment',schemaVersion:1,candidates,limitations:['BODY_REFERENCE_NOT_AVAILABLE'] };
  }
  for (const part of nodes) {
    if (part === body) continue;
    const [width, height, depth] = part.size;
    const widthCover = width / body.size[0], heightCover = height / body.size[1];
    const thicknessRatio = depth / Math.min(width, height);
    const xyOverlap = Math.min(overlap(part, body, 0) / width, overlap(part, body, 1) / height);
    const positiveFaceGap = Math.abs(part.min[2] - body.max[2]);
    const negativeFaceGap = Math.abs(part.max[2] - body.min[2]);
    const face = positiveFaceGap <= negativeFaceGap ? 'front' : 'back';
    const faceGap = Math.min(positiveFaceGap, negativeFaceGap);
    const faceThreshold = Math.max(.035, body.size[2] * .09);
    if (widthCover < .3 || widthCover > 1.12
      || heightCover < .4 || heightCover > 1.12
      || thicknessRatio > .12 || xyOverlap < .85
      || faceGap > faceThreshold) continue;
    const centerZ = (part.min[2] + part.max[2]) / 2;
    candidates.push({
      node:part.node.getName() || null,
      nodeIndex:document.getRoot().listNodes().indexOf(part.node),
      referenceNode:body.node.getName() || null,
      kind:'planar-panel-near-body-face',
      jointTypeHypothesis:'revolute',
      alternatives:[
        { axis:[0,1,0], worldHingeLinePoint:[round(part.min[0]),round(part.min[1]),round(centerZ)] },
        { axis:[0,1,0], worldHingeLinePoint:[round(part.max[0]),round(part.min[1]),round(centerZ)] }
      ],
      evidence:{ source:'axis-aligned-geometry', face, widthCover:round(widthCover),
        heightCover:round(heightCover), thicknessRatio:round(thicknessRatio),
        surfaceGap:round(faceGap), xyOverlap:round(xyOverlap) },
      status:'hypothesis', executable:false, physicsVerified:false,
      missing:['semantic-function','which-hinge','rest-frame-validation','joint-limits','mass-and-colliders','physics-and-task-verification']
    });
  }
  return { schema:'agentscape.static-panel-experiment',schemaVersion:1,candidates,
    limitations:['ONLY_AXIS_ALIGNED_FRONT_BACK_PANELS','STATIC_GEOMETRY_CANNOT_PROVE_MOBILITY','BOTH_PIVOT_EDGES_AMBIGUOUS'] };
}
