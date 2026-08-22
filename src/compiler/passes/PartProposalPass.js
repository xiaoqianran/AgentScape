import { orderParts, ROOT_PART } from '../../assets/parts.js';

const SUPPORTED_JOINTS = new Set(['revolute', 'prismatic']);
const finiteVec = (value, length) => Array.isArray(value) && value.length === length && value.every(Number.isFinite);

function executableReason(part) {
  if (!part.joint) return 'missing-joint';
  if (!SUPPORTED_JOINTS.has(part.joint.type)) return 'unsupported-joint';
  if (!finiteVec(part.joint.axis, 3) || Math.hypot(...part.joint.axis) < 1e-6) return 'invalid-axis';
  if (!finiteVec(part.joint.parentAnchor, 3) || !finiteVec(part.joint.childAnchor, 3)) return 'missing-anchor';
  if (!finiteVec(part.joint.limits, 2) || part.joint.limits[0] >= part.joint.limits[1]) return 'invalid-limits';
  if (!part.physics?.colliders?.length) return 'missing-collider';
  if (!part.actions?.length) return 'missing-actions';
  if (!part.actions.every((action) => Number.isFinite(part.targets?.[action]))) return 'missing-target';
  return null;
}

export class PartProposalPass {
  async run(context) {
    const proposal = context.partProposal;
    if (!proposal) return context;
    if (proposal.version !== 1 || !Array.isArray(proposal.parts)) {
      return {
        ...context,
        partProposal: { ...proposal, accepted:false, promoted:[], unpromoted:[], issues:[{ code:'PART_PROPOSAL_FORMAT', message:'Part proposal requires version=1 and parts[].' }] }
      };
    }

    const issues = [];
    const parts = {};
    const nodeCounts = new Map();
    for (const node of context.inspection.nodes) if (node.name) nodeCounts.set(node.name, (nodeCounts.get(node.name) || 0) + 1);
    for (const raw of proposal.parts) {
      const id = String(raw.id || '').trim();
      if (!id || parts[id]) { issues.push({ code:'PART_ID_INVALID', part:id || null, message:'Part id must be unique and non-empty.' }); continue; }
      const matches = nodeCounts.get(raw.node) || 0;
      if (matches === 0) { issues.push({ code:'PART_NODE_MISSING', part:id, node:raw.node, message:`GLB node not found: ${raw.node}` }); continue; }
      if (matches > 1) { issues.push({ code:'PART_NODE_AMBIGUOUS', part:id, node:raw.node, message:`GLB node name is not unique: ${raw.node}` }); continue; }
      parts[id] = {
        node: raw.node,
        parent: raw.parent || ROOT_PART,
        ...(raw.semantic ? { semantic:raw.semantic } : {}),
        ...(Array.isArray(raw.actions) ? { actions:[...new Set(raw.actions)] } : {}),
        ...(raw.targets ? { targets:{...raw.targets} } : {}),
        ...(raw.physics ? { physics:structuredClone(raw.physics) } : {}),
        ...(raw.joint ? { joint:structuredClone(raw.joint) } : {}),
        proposal: { source:proposal.source || 'provider', confidence:Number(raw.confidence ?? proposal.confidence ?? 0) }
      };
    }

    let ordered = [];
    try { ordered = orderParts(parts); }
    catch (error) { issues.push({ code:'PART_HIERARCHY_INVALID', message:error.message }); }

    if (!issues.length && context.document) {
      const nodes = new Map(context.document.getRoot().listNodes().map((node) => [node.getName(), node]));
      const isAncestor = (ancestor, node) => {
        for (let current = node?.getParent?.(); current; current = current.getParent?.()) if (current === ancestor) return true;
        return false;
      };
      for (const [id, part] of ordered) {
        const parentId = part.parent || ROOT_PART;
        if (parentId === ROOT_PART) continue;
        const parentNode = nodes.get(parts[parentId].node);
        const childNode = nodes.get(part.node);
        if (!isAncestor(parentNode, childNode)) {
          issues.push({ code:'PART_NODE_HIERARCHY_MISMATCH', part:id, parent:parentId, message:`GLB node ${part.node} is not under parent part node ${parts[parentId].node}.` });
        }
      }
    }

    const promoted = {};
    const unpromoted = [];
    if (!issues.length) {
      for (const [id, part] of ordered) {
        const reason = executableReason(part);
        const parent = part.parent || ROOT_PART;
        if (reason) { unpromoted.push({ part:id, reason }); continue; }
        if (parent !== ROOT_PART && !promoted[parent]) { unpromoted.push({ part:id, reason:'parent-not-executable' }); continue; }
        promoted[id] = part;
      }
    }

    const accepted = issues.length === 0;
    return {
      ...context,
      articulation: { ...context.articulation, ...(accepted && Object.keys(promoted).length ? { parts:promoted, source:'part-proposal' } : {}) },
      partProposal: { ...proposal, accepted, promoted:Object.keys(promoted), unpromoted, issues }
    };
  }
}
