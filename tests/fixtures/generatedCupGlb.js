import { Document, WebIO } from '@gltf-transform/core';
import * as THREE from 'three';

function addGeometry(document, buffer, scene, geometry, { name, translation, material }) {
  const accessor = (attribute) => document
    .createAccessor(`${name}-${attribute}`)
    .setType('VEC3')
    .setArray(new Float32Array(geometry.getAttribute(attribute).array))
    .setBuffer(buffer);
  const primitive = document.createPrimitive()
    .setAttribute('POSITION', accessor('position'))
    .setAttribute('NORMAL', accessor('normal'))
    .setMaterial(material);

  if (geometry.index) {
    const IndexArray = geometry.index.count > 65_535 ? Uint32Array : Uint16Array;
    const indices = document
      .createAccessor(`${name}-indices`)
      .setType('SCALAR')
      .setArray(new IndexArray(geometry.index.array))
      .setBuffer(buffer);
    primitive.setIndices(indices);
  }

  const mesh = document.createMesh(name).addPrimitive(primitive);
  scene.addChild(document.createNode(name).setMesh(mesh).setTranslation(translation));
  geometry.dispose();
}

export async function makeGeneratedCupGlb() {
  const document = new Document();
  const buffer = document.createBuffer('cup-buffer');
  const scene = document.createScene('Generated Cup');
  const ceramic = document.createMaterial('warm-white-ceramic')
    .setBaseColorFactor([0.93, 0.9, 0.82, 1])
    .setMetallicFactor(0.02)
    .setRoughnessFactor(0.28)
    .setDoubleSided(true);

  addGeometry(document, buffer, scene, new THREE.CylinderGeometry(0.18, 0.15, 0.34, 32, 1, true), {
    name: 'CupBody', translation: [0, 0.18, 0], material: ceramic
  });
  addGeometry(document, buffer, scene, new THREE.CylinderGeometry(0.151, 0.151, 0.025, 32), {
    name: 'CupBase', translation: [0, 0.0225, 0], material: ceramic
  });
  addGeometry(document, buffer, scene, new THREE.TorusGeometry(0.115, 0.034, 12, 28), {
    name: 'CupHandle', translation: [0.18, 0.2, 0], material: ceramic
  });

  return new Uint8Array(await new WebIO().writeBinary(document));
}
