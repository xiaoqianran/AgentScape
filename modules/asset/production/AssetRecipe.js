import { Document } from '@gltf-transform/core';
import { BoxGeometry, SphereGeometry, CylinderGeometry, Color } from 'three';
import { createAssetGLTFIO } from './compiler/gltfIO.js';
import { recipeSchema } from '../model/AssetInputContracts.js';

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
    const geometry = spec.type === 'box' ? new BoxGeometry(...spec.size) : spec.type === 'sphere' ? new SphereGeometry(spec.radius, 16, 12) : new CylinderGeometry(spec.radius, spec.radius, spec.height, 16);
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
