import { Document, Primitive } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { boxCollidersForNodes, sceneMeshOwnership } from '../asset/compiler/partGeometry.js';

function meshNode(document, name, positions, { translation=[0,0,0], rotation=[0,0,0,1], scale=[1,1,1] } = {}) {
  const buffer=document.getRoot().listBuffers()[0] || document.createBuffer();
  const position=document.createAccessor(`${name}_POSITION`).setType('VEC3').setBuffer(buffer).setArray(new Float32Array(positions));
  const indices=document.createAccessor(`${name}_indices`).setType('SCALAR').setBuffer(buffer).setArray(new Uint16Array([0,1,2,0,2,3,4,5,6,4,6,7]));
  const primitive=document.createPrimitive().setMode(Primitive.Mode.TRIANGLES).setAttribute('POSITION',position).setIndices(indices);
  const mesh=document.createMesh(`${name}Mesh`).addPrimitive(primitive);
  return document.createNode(name).setMesh(mesh).setTranslation(translation).setRotation(rotation).setScale(scale);
}

const boxPositions=[
  1,-1,2, 3,-1,2, 3,1,2, 1,1,2,
  1,-1,4, 3,-1,4, 3,1,4, 1,1,4
];

describe('part geometry',()=>{
  it('bakes node scale into collider local coordinates while cancelling body translation/rotation',()=>{
    const document=new Document();
    const node=meshNode(document,'Part',boxPositions,{translation:[10,2,-3],rotation:[0,0,Math.sin(Math.PI/4),Math.cos(Math.PI/4)],scale:[2,3,4]});
    document.createScene('Scene').addChild(node);
    const [collider]=boxCollidersForNodes([node],node);
    expect(collider.halfExtents.map((v)=>Number(v.toFixed(6)))).toEqual([2,3,4]);
    expect(collider.translation.map((v)=>Number(v.toFixed(6)))).toEqual([4,0,12]);
  });

  it('assigns each mesh to the nearest executable Part ancestor',()=>{
    const document=new Document();
    const scene=document.createScene('Scene');
    const rootMesh=meshNode(document,'Body',boxPositions);
    const door=document.createNode('Door');
    const panel=meshNode(document,'Panel',boxPositions);
    const handle=meshNode(document,'Handle',boxPositions);
    door.addChild(panel); door.addChild(handle);
    scene.addChild(rootMesh); scene.addChild(door);
    const ownership=sceneMeshOwnership(scene,{door});
    expect(ownership.get(null).map((node)=>node.getName())).toEqual(['Body']);
    expect(ownership.get('door').map((node)=>node.getName()).sort()).toEqual(['Handle','Panel']);
  });
});
