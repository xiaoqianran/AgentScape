import * as THREE from 'three';
import { inferAnimationMotion } from '../evidence/AnimationMotionEvidence.js';
import { inferStaticPanelHypotheses } from '../evidence/StaticPanelEvidence.js';

const round = value => Number(value.toFixed(6));
const worldAxis = (node, axis) => {
  const parent = node.getParentNode();
  const rotation = new THREE.Quaternion();
  if (parent) new THREE.Matrix4().fromArray(parent.getWorldMatrix()).decompose(
    new THREE.Vector3(), rotation, new THREE.Vector3());
  return new THREE.Vector3(...axis).applyQuaternion(rotation).normalize().toArray().map(round);
};

/**
 * Proposals, never permissions. GLB motion tracks and static planar geometry
 * are kept as separate evidence sources; static hinges remain ambiguous.
 * This runs only during explicit prepareInteraction, not every asset build.
 */
export class KinematicEvidencePass {
  async run(context) {
    if (!context.interactionProposal) return context;

    const animation = inferAnimationMotion(context.document);
    const panels = inferStaticPanelHypotheses(context.document);
    const nodes = context.document.getRoot().listNodes();
    const hypotheses = [];
    let truncated = false;
    const push = entry => {
      if (hypotheses.length >= 32) { truncated = true; return; }
      hypotheses.push({
        id:`kh_${hypotheses.length + 1}`,
        ...entry,
        status:'candidate',
        executable:false,
        physicsVerified:false,
        functionVerified:false
      });
    };

    for (const motion of animation.candidates) {
      const node = nodes[motion.nodeIndex];
      if (!node) continue;
      const axis = worldAxis(node, motion.hypothesis.axis);
      push({
        source:'gltf-animation',
        node:motion.node,
        nodeIndex:motion.nodeIndex,
        jointType:motion.hypothesis.type,
        axisWorld:axis,
        pivotWorld:node.getWorldTranslation().map(round),
        limits:[...motion.hypothesis.limits],
        evidence:motion.evidence,
        missing:[...motion.missing, 'joint-frame-and-collider-review']
      });
    }

    for (const panel of panels.candidates) {
      for (const alternative of panel.alternatives) push({
        source:'static-geometry',
        node:panel.node,
        nodeIndex:panel.nodeIndex,
        jointType:panel.jointTypeHypothesis,
        axisWorld:[...alternative.axis],
        pivotWorld:[...alternative.worldHingeLinePoint],
        limits:null,
        evidence:panel.evidence,
        missing:[...panel.missing, 'joint-limits-unobserved']
      });
    }

    return {
      ...context,
      kinematicEvidence:{
        schema:'agentscape.kinematic-evidence',
        schemaVersion:1,
        hypotheses,
        issues:[...animation.issues, ...(truncated ? [{code:'HYPOTHESIS_LIMIT_EXCEEDED'}] : [])],
        limitations:[...panels.limitations, 'MOTION_OR_GEOMETRY_IS_NOT_FUNCTIONAL_VERIFICATION'],
        ...(truncated ? { truncated:true } : {}),
        evidenceSources:['gltf-animation', 'axis-aligned-geometry']
      }
    };
  }
}
