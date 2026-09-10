import { Primitive } from '@gltf-transform/core';

const slug = (value) => String(value).trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
const labelsArray = (value) => Array.isArray(value) || ArrayBuffer.isView(value) ? Array.from(value, (item) => String(item)) : null;

const makeIndices = (document, sourcePrimitive, faceLabels, segmentId) => {
  const sourceIndices = sourcePrimitive.getIndices()?.getArray() || null;
  const positions = sourcePrimitive.getAttribute('POSITION');
  const vertexCount = positions?.getCount() || 0;
  const faceCount = sourceIndices ? sourceIndices.length / 3 : vertexCount / 3;
  if (!Number.isInteger(faceCount)) throw new Error('Primitive triangle count is not integral.');
  if (faceLabels.length !== faceCount) throw new Error(`Face label count ${faceLabels.length} does not match primitive face count ${faceCount}.`);

  const selected = [];
  for (let face = 0; face < faceCount; face++) {
    if (faceLabels[face] !== segmentId) continue;
    const offset = face * 3;
    selected.push(
      sourceIndices ? sourceIndices[offset] : offset,
      sourceIndices ? sourceIndices[offset + 1] : offset + 1,
      sourceIndices ? sourceIndices[offset + 2] : offset + 2
    );
  }
  if (!selected.length) return null;
  let max = 0;
  for (const index of selected) if (index > max) max = index;
  const array = max <= 65535 ? new Uint16Array(selected) : new Uint32Array(selected);
  return document.createAccessor().setType('SCALAR').setArray(array);
};

const clonePrimitiveView = (document, source, indices) => {
  const primitive = document.createPrimitive().setMode(source.getMode()).setIndices(indices).setMaterial(source.getMaterial());
  for (const semantic of source.listSemantics()) primitive.setAttribute(semantic, source.getAttribute(semantic));
  primitive.setExtras(structuredClone(source.getExtras()));
  return primitive;
};

export class SegmentMaterializePass {
  async run(context) {
    const evidence = context.partSegmentation;
    const spec = evidence?.materialization;
    if (!spec) return context;
    const issues = [];
    const fail = (code, message, details = {}) => ({
      ...context,
      partSegmentation: {
        ...evidence,
        materialization: { status:'rejected', sourceNode:spec.sourceNode || null, issues:[...issues, { code, message, ...details }] }
      }
    });

    if (evidence.version !== 1 || !evidence.source || !Number.isInteger(evidence.faceCount) || evidence.faceCount <= 0 || !Array.isArray(evidence.segments)) {
      return fail('MATERIALIZATION_EVIDENCE_INVALID', 'Materialization requires valid Segmentation Evidence v1 metadata.');
    }
    if (!spec.sourceNode || !Array.isArray(spec.primitives)) return fail('MATERIALIZATION_FORMAT', 'Materialization requires sourceNode and primitives[].');
    const nodes = context.document.getRoot().listNodes().filter((node) => node.getName() === spec.sourceNode);
    if (nodes.length !== 1) return fail(nodes.length ? 'MATERIALIZATION_NODE_AMBIGUOUS' : 'MATERIALIZATION_NODE_MISSING', `Source node must resolve uniquely: ${spec.sourceNode}`);
    const sourceNode = nodes[0];
    const sourceMesh = sourceNode.getMesh();
    if (!sourceMesh) return fail('MATERIALIZATION_MESH_MISSING', `Source node has no mesh: ${spec.sourceNode}`);
    if (sourceNode.getSkin()) return fail('MATERIALIZATION_SKIN_UNSUPPORTED', 'Skinned nodes are not materialized automatically.');
    if (sourceNode.getWeights().length || sourceMesh.getWeights().length) return fail('MATERIALIZATION_MORPH_UNSUPPORTED', 'Morph-target meshes are not materialized automatically.');
    if (sourceNode.listExtensions().length || sourceMesh.listExtensions().length) return fail('MATERIALIZATION_EXTENSION_UNSUPPORTED', 'Node or mesh extensions require provider-side materialization.');

    const primitives = sourceMesh.listPrimitives();
    if (spec.primitives.length !== primitives.length) return fail('MATERIALIZATION_PRIMITIVE_COVERAGE', 'Every source primitive must have one face-label entry.');
    const byPrimitive = new Map();
    for (const entry of spec.primitives) {
      if (!Number.isInteger(entry.primitive) || entry.primitive < 0 || entry.primitive >= primitives.length || byPrimitive.has(entry.primitive)) {
        return fail('MATERIALIZATION_PRIMITIVE_INDEX', `Invalid or duplicate primitive index: ${entry.primitive}`);
      }
      const labels = labelsArray(entry.faceLabels);
      if (!labels) return fail('MATERIALIZATION_LABELS_MISSING', `Primitive ${entry.primitive} requires faceLabels[].`);
      byPrimitive.set(entry.primitive, labels);
    }

    const segmentDefs = new Map();
    const generatedNames = new Set(context.document.getRoot().listNodes().map((node) => node.getName()).filter(Boolean));
    for (const segment of evidence.segments || []) {
      const id = String(segment.id ?? '');
      if (!id || segmentDefs.has(id) || !Number.isInteger(segment.faceCount) || segment.faceCount <= 0) return fail('MATERIALIZATION_SEGMENT_INVALID', `Segment ids must be unique and faceCount must be positive: ${id || '<missing>'}`);
      const safe = slug(id);
      if (!safe) return fail('MATERIALIZATION_SEGMENT_ID', `Segment id cannot form a stable node name: ${id}`);
      const nodeName = `${spec.sourceNode}__part_${safe}`;
      if (generatedNames.has(nodeName)) return fail('MATERIALIZATION_NODE_COLLISION', `Generated node already exists: ${nodeName}`);
      if ([...segmentDefs.values()].some((item) => item.nodeName === nodeName)) return fail('MATERIALIZATION_SEGMENT_ID_COLLISION', `Segment ids collide after normalization: ${id}`);
      segmentDefs.set(id, { id, nodeName, segment });
    }
    if (!segmentDefs.size) return fail('MATERIALIZATION_SEGMENTS_MISSING', 'No segmentation definitions are available.');

    const proposalParts = new Map((context.partProposal?.parts || []).map((part) => [String(part.id), part]));
    if (context.partProposal) {
      const nodeById = new Map([...segmentDefs.values()].map((def) => [def.id, def.nodeName]));
      for (const [id, def] of segmentDefs) {
        const part = proposalParts.get(id);
        if (!part) continue;
        if (part.node && part.node !== def.nodeName) return fail('MATERIALIZATION_PROPOSAL_NODE_CONFLICT', `Part Proposal node conflicts with materialized segment ${id}.`, { part:id, expected:def.nodeName, actual:part.node });
        const parent = part.parent || '$root';
        if (parent !== '$root' && !segmentDefs.has(String(parent))) return fail('MATERIALIZATION_EXTERNAL_PARENT_UNSUPPORTED', `Materialized Part ${id} references a parent outside this segmentation batch: ${parent}.`, { part:id, parent });
      }
      for (const id of segmentDefs.keys()) {
        const seen = new Set([id]);
        for (let parent = proposalParts.get(id)?.parent; parent && parent !== '$root'; parent = proposalParts.get(String(parent))?.parent) {
          parent = String(parent);
          if (seen.has(parent)) return fail('MATERIALIZATION_PART_HIERARCHY_CYCLE', `Materialized Part hierarchy contains a cycle at ${parent}.`);
          seen.add(parent);
        }
      }
    }

    const actualCounts = new Map([...segmentDefs.keys()].map((id) => [id, 0]));
    let totalFaces = 0;
    for (let primitiveIndex = 0; primitiveIndex < primitives.length; primitiveIndex++) {
      const primitive = primitives[primitiveIndex];
      if (primitive.getMode() !== Primitive.Mode.TRIANGLES) return fail('MATERIALIZATION_MODE_UNSUPPORTED', `Primitive ${primitiveIndex} is not TRIANGLES.`);
      if (primitive.listTargets().length || primitive.listExtensions().length) return fail('MATERIALIZATION_PRIMITIVE_UNSUPPORTED', `Primitive ${primitiveIndex} has morph targets or extensions.`);
      const labels = byPrimitive.get(primitiveIndex);
      const indices = primitive.getIndices()?.getArray();
      const faceCount = indices ? indices.length / 3 : (primitive.getAttribute('POSITION')?.getCount() || 0) / 3;
      if (!Number.isInteger(faceCount) || labels.length !== faceCount) return fail('MATERIALIZATION_FACE_COUNT', `Primitive ${primitiveIndex} face labels do not exactly match its triangles.`);
      totalFaces += faceCount;
      for (const label of labels) {
        if (!segmentDefs.has(label)) return fail('MATERIALIZATION_UNKNOWN_SEGMENT', `Face label references unknown segment: ${label}`);
        actualCounts.set(label, actualCounts.get(label) + 1);
      }
    }
    if (Number.isInteger(evidence.faceCount) && evidence.faceCount !== totalFaces) return fail('MATERIALIZATION_SOURCE_FACE_COUNT_MISMATCH', `Evidence faceCount ${evidence.faceCount} does not match source mesh face count ${totalFaces}.`);
    for (const [id, def] of segmentDefs) {
      if (!actualCounts.get(id)) return fail('MATERIALIZATION_EMPTY_SEGMENT', `Segment has no faces: ${id}`);
      if (Number.isInteger(def.segment.faceCount) && def.segment.faceCount !== actualCounts.get(id)) {
        return fail('MATERIALIZATION_SEGMENT_COUNT_MISMATCH', `Segment ${id} faceCount does not match labels.`);
      }
    }

    const materializedParts = [];
    const materializedNodes = new Map();
    for (const [id, def] of segmentDefs) {
      const mesh = context.document.createMesh(`${def.nodeName}Mesh`).setWeights(sourceMesh.getWeights()).setExtras(structuredClone(sourceMesh.getExtras()));
      for (let primitiveIndex = 0; primitiveIndex < primitives.length; primitiveIndex++) {
        const indices = makeIndices(context.document, primitives[primitiveIndex], byPrimitive.get(primitiveIndex), id);
        if (indices) mesh.addPrimitive(clonePrimitiveView(context.document, primitives[primitiveIndex], indices));
      }
      const node = context.document.createNode(def.nodeName).setMesh(mesh).setExtras({ agentscape:{ segmentId:id, source:evidence.source } });
      sourceNode.addChild(node);
      materializedNodes.set(id, node);
      materializedParts.push({
        id,
        node:def.nodeName,
        ...(def.segment.semantic ? { semantic:def.segment.semantic } : {}),
        ...(Number.isFinite(def.segment.confidence) ? { confidence:def.segment.confidence } : {})
      });
    }
    for (const [id, node] of materializedNodes) {
      const parentId = String(proposalParts.get(id)?.parent || '$root');
      if (parentId !== '$root') materializedNodes.get(parentId).addChild(node);
    }
    sourceNode.setMesh(null);

    let partProposal = context.partProposal;
    if (!partProposal) {
      const confidences = materializedParts.map((part) => part.confidence).filter(Number.isFinite);
      const confidence = Number.isFinite(evidence.confidence)
        ? evidence.confidence
        : confidences.length === materializedParts.length
          ? confidences.reduce((min, value) => Math.min(min, value), 1)
          : 0;
      partProposal = { version:1, source:`segmentation/${evidence.source}`, confidence, parts:materializedParts };
    } else {
      const materializedById = new Map(materializedParts.map((part) => [part.id, part]));
      partProposal = structuredClone(partProposal);
      partProposal.parts ||= [];
      const existingIds = new Set();
      for (const part of partProposal.parts) {
        const id = String(part.id);
        existingIds.add(id);
        const materialized = materializedById.get(id);
        if (materialized && !part.node) part.node = materialized.node;
        if (materialized?.semantic && !part.semantic) part.semantic = materialized.semantic;
        if (Number.isFinite(materialized?.confidence) && !Number.isFinite(part.confidence)) part.confidence = materialized.confidence;
      }
      for (const materialized of materializedParts) {
        if (!existingIds.has(materialized.id)) partProposal.parts.push(structuredClone(materialized));
      }
    }

    return {
      ...context,
      partProposal,
      partSegmentation: {
        ...evidence,
        materialization: {
          status:issues.length ? 'partial' : 'materialized',
          strategy:'shared-accessor-index-split',
          completeFacePartition:true,
          sourceNodeOriginPreserved:true,
          sourceNode:spec.sourceNode,
          nodes:materializedParts.map((part) => ({ id:part.id, node:part.node })),
          issues
        }
      }
    };
  }
}
