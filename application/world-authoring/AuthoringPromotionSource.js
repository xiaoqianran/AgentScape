import * as THREE from 'three';
import { parseAuthoringDocument } from './AuthoringDocument.js';
import { uniformScaleValue } from '../../modules/world/runtime/ObjectTransform.js';
import { sha256ArtifactHash } from '../../modules/artifact/IncrementalSha256.js';

export const promotionError = (code, message) => Object.assign(new Error(message), { code });
export const promotionHash = (value) => sha256ArtifactHash([new TextEncoder().encode(JSON.stringify(value))]);

// Capture only the selected subtree and its resources, plus inherited placement.
// An unrelated edit must not invalidate a prepared asset.
export function capturePromotionSource(authoring, nodeId) {
  const document = authoring.export();
  const state = parseAuthoringDocument(document);
  if (!state.nodesById[nodeId] || nodeId === state.rootId) {
    throw promotionError('AUTHORING_SELECTION_INVALID', '请选择一个创作对象或分组，不能晋升整个创作根节点');
  }
  const ids = [];
  const visit = id => { ids.push(id); for (const child of state.childIdsById[id] || []) visit(child); };
  visit(nodeId);
  const geometries = {}, materials = {};
  for (const id of ids) {
    const components = state.nodesById[id].components;
    const geometryId = components.geometry?.properties?.geometryId;
    const materialId = components.material?.properties?.materialId;
    if (geometryId) geometries[geometryId] = state.geometries[geometryId];
    if (materialId) materials[materialId] = state.materials[materialId];
  }
  const textures = {};
  for (const material of Object.values(materials)) {
    for (const value of Object.values(material)) {
      if (typeof value === 'string' && state.textures[value]) textures[value] = state.textures[value];
    }
  }
  const object = authoring.get(nodeId);
  object.updateWorldMatrix(true, true);
  const matrix = object.matrixWorld.clone();
  const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  const uniform = uniformScaleValue(scale.toArray());
  const reconstructed = new THREE.Matrix4().compose(position, quaternion, scale);
  if (matrix.elements.some((v, i) => !Number.isFinite(v) || Math.abs(v - reconstructed.elements[i]) > 1e-6)) {
    throw promotionError('AUTHORING_TRANSFORM_UNSUPPORTED', '当前世界不支持带剪切的对象变换');
  }
  let ancestor = nodeId;
  while (ancestor) {
    if (state.nodesById[ancestor].visible === false) throw promotionError('AUTHORING_NODE_HIDDEN', '请先显示创作对象及其父分组');
    ancestor = state.parentIdById[ancestor];
  }
  const nodes = ids.map(id => ({ ...state.nodesById[id], childIds:state.childIdsById[id] }));
  const content = { nodes, geometries, materials, textures };
  // Root placement does not change asset bytes; parent transforms still change sourceHash.
  const assetContent = structuredClone(content);
  delete assetContent.nodes[0].components.transform;
  const transform = { position:position.toArray(), quaternion:quaternion.toArray(), scale:uniform };
  return {
    nodeId, name:object.name || nodeId, ids, object, transform,
    reference:state.nodesById[nodeId].components.modelRef?.properties || null,
    contentHash:promotionHash(assetContent), sourceHash:promotionHash({ content, transform }),
    revisionId:authoring.currentRevision()?.id || null
  };
}

export async function exportPromotionGLB(source) {
  // Lazy load the exporter only when a visual subtree actually needs asset production.
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const object = source.object.clone(true);
  object.position.set(0, 0, 0);
  object.quaternion.identity();
  object.scale.set(1, 1, 1);
  object.matrixAutoUpdate = true;
  object.updateMatrix();
  object.visible = true;
  const materials = [];
  const expand = node => {
    for (const child of [...node.children]) {
      if (child.isInstancedMesh) {
        const group = new THREE.Group();
        group.name = child.name;
        group.position.copy(child.position);
        group.quaternion.copy(child.quaternion);
        group.scale.copy(child.scale);
        group.visible = child.visible;
        for (let i = 0; i < child.count; i++) {
          let material = child.material;
          if (child.instanceColor) {
            material = material.clone();
            material.color.multiply(new THREE.Color().fromBufferAttribute(child.instanceColor, i));
            materials.push(material);
          }
          const mesh = new THREE.Mesh(child.geometry, material);
          child.getMatrixAt(i, mesh.matrix);
          mesh.matrixAutoUpdate = false;
          group.add(mesh);
        }
        while (child.children.length) group.add(child.children[0]);
        node.remove(child);
        node.add(group);
        expand(group);
      } else expand(child);
    }
  };
  const wrapper = new THREE.Group();
  wrapper.add(object);
  let meshes = 0;
  try {
    expand(wrapper);
    wrapper.traverse(node => {
      if (node.isLight || node.isCamera || node.isSkinnedMesh || node.animations?.length) {
        throw promotionError('AUTHORING_EXPORT_UNSUPPORTED', '请将灯光、相机、蒙皮或动画与待晋升对象分开');
      }
      if (node.isMesh) meshes++;
      // Runtime and authoring IDs do not belong in reusable asset GLB extras.
      node.userData = {};
    });
    if (!meshes) throw promotionError('AUTHORING_MODEL_UNRESOLVED', '对象没有可导出的网格，请先加载模型');
    const bytes = await new GLTFExporter().parseAsync(wrapper, { binary:true, onlyVisible:true });
    return new Uint8Array(bytes);
  } finally { for (const material of materials) material.dispose(); }
}
