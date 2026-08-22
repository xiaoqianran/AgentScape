import * as THREE from 'three';
import { ROOT_PART } from '../../assets/parts.js';
import { rigidInverse } from '../partGeometry.js';

const EPS_POSITION = 1e-4;
const EPS_ROTATION = 1e-4;
const EPS_SCALE = 1e-4;
const EPS_AXIS = 1e-4;

const matrixFromRows = (rows) => {
  if (!Array.isArray(rows) || rows.length !== 4 || rows.some((row) => !Array.isArray(row) || row.length !== 4 || !row.every(Number.isFinite))) return null;
  return new THREE.Matrix4().set(...rows.flat());
};
const decompose = (matrix) => {
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, rotation, scale);
  return { position, rotation, scale };
};
const rotationDelta = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.dot(b))));
const unitScale = (scale) => Math.max(Math.abs(scale.x - 1), Math.abs(scale.y - 1), Math.abs(scale.z - 1)) <= EPS_SCALE;

export class JointFramePass {
  async run(context) {
    const proposal = context.partProposal;
    if (!proposal || proposal.frameConvention !== 'urdf-link-local' || !Array.isArray(proposal.parts)) return context;

    const byName = new Map();
    for (const node of context.inspection.nodes) {
      if (!node.name) continue;
      if (!byName.has(node.name)) byName.set(node.name, []);
      byName.get(node.name).push(node);
    }
    const byId = new Map(proposal.parts.map((part) => [String(part.id || ''), part]));
    const issues = [];
    const compiled = structuredClone(proposal);

    for (const part of compiled.parts) {
      const matrixRows = part.joint?.urdf?.parentToJointMatrix || part.joint?.urdf?.originMatrix;
      if (!matrixRows || part.joint?.parentAnchor || part.joint?.childAnchor) continue;
      const expectedMatrix = matrixFromRows(matrixRows);
      const childNodes = byName.get(part.node) || [];
      if (!expectedMatrix || childNodes.length !== 1) {
        issues.push({ part:part.id, code:'JOINT_FRAME_NODE_UNRESOLVED' });
        continue;
      }

      const parentId = part.parent || ROOT_PART;
      let parentWorld = new THREE.Matrix4();
      if (parentId !== ROOT_PART) {
        const parentPart = byId.get(parentId);
        const parentNodes = byName.get(parentPart?.node) || [];
        if (parentNodes.length !== 1) {
          issues.push({ part:part.id, code:'JOINT_FRAME_PARENT_UNRESOLVED' });
          continue;
        }
        parentWorld.fromArray(parentNodes[0].worldMatrix);
      }
      const childWorld = new THREE.Matrix4().fromArray(childNodes[0].worldMatrix);
      const actualMatrix = parentWorld.clone().invert().multiply(childWorld);
      const expected = decompose(expectedMatrix);
      const actual = decompose(actualMatrix);

      if (!unitScale(expected.scale) || !unitScale(actual.scale)) {
        issues.push({ part:part.id, code:'JOINT_FRAME_SCALE_UNSUPPORTED' });
        continue;
      }
      if (actual.position.distanceTo(expected.position) > EPS_POSITION || rotationDelta(actual.rotation, expected.rotation) > EPS_ROTATION) {
        issues.push({ part:part.id, code:'JOINT_FRAME_MISMATCH' });
        continue;
      }

      const currentNodes = context.document?.getRoot?.().listNodes?.().filter((node) => node.getName() === part.node) || [];
      if (currentNodes.length !== 1) {
        issues.push({ part:part.id, code:'JOINT_FRAME_CURRENT_NODE_UNRESOLVED' });
        continue;
      }
      let currentParent = null;
      if (parentId !== ROOT_PART) {
        const parentPart = byId.get(parentId);
        const currentParents = context.document.getRoot().listNodes().filter((node) => node.getName() === parentPart?.node);
        if (currentParents.length !== 1) {
          issues.push({ part:part.id, code:'JOINT_FRAME_CURRENT_PARENT_UNRESOLVED' });
          continue;
        }
        currentParent = currentParents[0];
      }

      const axis = new THREE.Vector3(...(part.joint.axis || []));
      if (axis.lengthSq() < 1e-12) {
        issues.push({ part:part.id, code:'JOINT_FRAME_AXIS_INVALID' });
        continue;
      }
      axis.normalize();
      const parentAxis = axis.clone().applyQuaternion(expected.rotation).normalize();
      if (parentAxis.dot(axis) < 1 - EPS_AXIS) {
        issues.push({ part:part.id, code:'JOINT_FRAME_ROTATION_UNSUPPORTED' });
        continue;
      }

      const currentChild = decompose(new THREE.Matrix4().fromArray(currentNodes[0].getWorldMatrix()));
      const anchor = currentChild.position.clone().applyMatrix4(rigidInverse(currentParent));
      part.joint.parentAnchor = anchor.toArray();
      part.joint.childAnchor = [0, 0, 0];
      part.joint.frame = {
        source:'urdf', compiled:true,
        positionError:actual.position.distanceTo(expected.position),
        rotationError:rotationDelta(actual.rotation, expected.rotation),
        normalizedParentAnchor:true
      };
    }

    return { ...context, partProposal: { ...compiled, jointFrame: { compiled:true, issues } } };
  }
}
