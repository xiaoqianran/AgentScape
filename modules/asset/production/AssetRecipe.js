import { Document } from '@gltf-transform/core';
import { BoxGeometry, SphereGeometry, CylinderGeometry, Color, Vector3, Quaternion } from 'three';
import { createAssetGLTFIO } from './compiler/gltfIO.js';
import { recipeSchema } from '../model/AssetInputContracts.js';

function createPartGeometry(spec) {
  if (spec.type === 'box') return new BoxGeometry(...spec.size);
  if (spec.type === 'sphere') return new SphereGeometry(spec.radius, 16, 12);
  if (spec.type === 'ellipsoid') return new SphereGeometry(1, 20, 14).scale(...spec.radii);
  if (spec.type === 'cylinder') return new CylinderGeometry(spec.radius, spec.radius, spec.height, 16);
  if (spec.type === 'tapered-cylinder') return new CylinderGeometry(spec.radiusTop, spec.radiusBottom, spec.height, 16);
  // Slanted tapered shapes by endpoints: branches, rails and pipes.
  const from = new Vector3(...spec.from), to = new Vector3(...spec.to);
  const direction = to.clone().sub(from);
  const geometry = new CylinderGeometry(spec.radiusEnd, spec.radiusStart, direction.length(), 12);
  geometry.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize()));
  geometry.translate(...from.add(to).multiplyScalar(0.5).toArray());
  return geometry;
}

/** Trusted compiler implementation for a bounded declarative language. */
export async function compileRecipeGeometry(input) {
  const recipe = recipeSchema.parse(input);
  const document = new Document(), buffer = document.createBuffer();
  const scene = document.createScene('Recipe'); document.getRoot().setDefaultScene(scene);
  const nodes = new Map();
  for (const part of recipe.parts) {
    const node = document.createNode(part.id).setTranslation(part.position).setRotation(part.quaternion).setScale([part.scale, part.scale, part.scale]);
    nodes.set(part.id, node);
    if (!part.geometry) continue;
    const spec = part.geometry;
    const geometry = createPartGeometry(spec);
    try {
      const primitive = document.createPrimitive();
      for (const [attribute, semantic] of [['position', 'POSITION'], ['normal', 'NORMAL'], ['uv', 'TEXCOORD_0']]) {
        const data = geometry.getAttribute(attribute);
        if (data) primitive.setAttribute(semantic, document.createAccessor().setType(data.itemSize === 2 ? 'VEC2' : 'VEC3').setArray(data.array.slice()).setBuffer(buffer));
      }
      if (geometry.index) primitive.setIndices(document.createAccessor().setType('SCALAR').setArray(geometry.index.array.slice()).setBuffer(buffer));
      const color = new Color(part.material?.color || '#aaaaaa');
      primitive.setMaterial(document.createMaterial().setBaseColorFactor([color.r, color.g, color.b, 1]).setRoughnessFactor(part.material?.roughness ?? 0.7).setMetallicFactor(part.material?.metalness ?? 0));
      node.setMesh(document.createMesh(part.id).addPrimitive(primitive));
    } finally { geometry.dispose(); }
  }
  for (const part of recipe.parts) (part.parent ? nodes.get(part.parent) : scene).addChild(nodes.get(part.id));
  return { recipe, bytes: await createAssetGLTFIO().writeBinary(document) };
}
