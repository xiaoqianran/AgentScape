import { Document, Primitive, WebIO } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { SegmentMaterializePass } from '../../asset/compiler/passes/SegmentMaterializePass.js';

function fixture({ indexed=true } = {}) {
  const document=new Document();
  const buffer=document.createBuffer();
  const positions=document.createAccessor('POSITION').setType('VEC3').setBuffer(buffer).setArray(new Float32Array([
    0,0,0, 1,0,0, 1,1,0, 0,1,0
  ]));
  const normals=document.createAccessor('NORMAL').setType('VEC3').setBuffer(buffer).setArray(new Float32Array([
    0,0,1, 0,0,1, 0,0,1, 0,0,1
  ]));
  const uvs=document.createAccessor('UV').setType('VEC2').setBuffer(buffer).setArray(new Float32Array([
    0,0, 1,0, 1,1, 0,1
  ]));
  const material=document.createMaterial('SharedMaterial');
  const primitive=document.createPrimitive().setMode(Primitive.Mode.TRIANGLES)
    .setAttribute('POSITION',positions).setAttribute('NORMAL',normals).setAttribute('TEXCOORD_0',uvs).setMaterial(material);
  if(indexed) primitive.setIndices(document.createAccessor('indices').setType('SCALAR').setBuffer(buffer).setArray(new Uint16Array([0,1,2,0,2,3])));
  else {
    positions.setArray(new Float32Array([0,0,0,1,0,0,1,1,0, 0,0,0,1,1,0,0,1,0]));
    normals.setArray(new Float32Array(18).fill(0));
    uvs.setArray(new Float32Array(12).fill(0));
  }
  const mesh=document.createMesh('SourceMesh').addPrimitive(primitive);
  const node=document.createNode('Source').setMesh(mesh);
  document.createScene('Scene').addChild(node); document.getRoot().setDefaultScene(document.getRoot().listScenes()[0]);
  return {document,node,primitive,positions,normals,uvs,material};
}

const evidence=()=>({
  version:1,source:'test-segmenter',faceCount:2,
  segments:[{id:'door',faceCount:1,semantic:'door',confidence:.9},{id:'body',faceCount:1,semantic:'body',confidence:.8}],
  materialization:{sourceNode:'Source',primitives:[{primitive:0,faceLabels:['door','body']}]}
});

describe('SegmentMaterializePass',()=>{
  it('splits indexed triangles into stable child nodes while reusing attributes and material', async()=>{
    const {document,node,positions,normals,uvs,material}=fixture();
    const result=await new SegmentMaterializePass().run({document,partSegmentation:evidence()});
    expect(result.partSegmentation.materialization.status).toBe('materialized');
    expect(node.getMesh()).toBeNull();
    expect(node.listChildren().map((child)=>child.getName()).sort()).toEqual(['Source__part_body','Source__part_door']);
    const door=node.listChildren().find((child)=>child.getName()==='Source__part_door');
    const primitive=door.getMesh().listPrimitives()[0];
    expect(primitive.getAttribute('POSITION')).toBe(positions);
    expect(primitive.getAttribute('NORMAL')).toBe(normals);
    expect(primitive.getAttribute('TEXCOORD_0')).toBe(uvs);
    expect(primitive.getMaterial()).toBe(material);
    expect(Array.from(primitive.getIndices().getArray())).toEqual([0,1,2]);
    expect(result.partProposal.parts.map((part)=>part.node).sort()).toEqual(['Source__part_body','Source__part_door']);
    expect(result.partProposal.confidence).toBe(.8);
    expect(result.partSegmentation.materialization.strategy).toBe('shared-accessor-index-split');
    const bytes=await new WebIO().writeBinary(document);
    const roundTrip=await new WebIO().readBinary(bytes);
    expect(roundTrip.getRoot().listNodes().map((n)=>n.getName())).toEqual(expect.arrayContaining(['Source__part_body','Source__part_door']));
  });

  it('supports non-indexed triangle primitives by creating segment indices', async()=>{
    const {document,node}=fixture({indexed:false});
    await new SegmentMaterializePass().run({document,partSegmentation:evidence()});
    const body=node.listChildren().find((child)=>child.getName()==='Source__part_body');
    expect(Array.from(body.getMesh().listPrimitives()[0].getIndices().getArray())).toEqual([3,4,5]);
  });

  it('rejects incomplete face coverage without mutating the source node', async()=>{
    const {document,node}=fixture();
    const bad=evidence(); bad.materialization.primitives[0].faceLabels=['door'];
    const result=await new SegmentMaterializePass().run({document,partSegmentation:bad});
    expect(result.partSegmentation.materialization.status).toBe('rejected');
    expect(result.partSegmentation.materialization.issues[0].code).toBe('MATERIALIZATION_FACE_COUNT');
    expect(node.getMesh()).not.toBeNull();
    expect(node.listChildren()).toHaveLength(0);
  });

  it('rejects an existing proposal node conflict before mutating geometry', async()=>{
    const {document,node}=fixture();
    const result=await new SegmentMaterializePass().run({document,partSegmentation:evidence(),partProposal:{version:1,parts:[{id:'door',node:'Other'}]}});
    expect(result.partSegmentation.materialization.status).toBe('rejected');
    expect(result.partSegmentation.materialization.issues[0].code).toBe('MATERIALIZATION_PROPOSAL_NODE_CONFLICT');
    expect(node.getMesh()).not.toBeNull();
  });

  it('materializes declared same-batch parent hierarchy without changing zero-pose transforms', async()=>{
    const {document,node}=fixture();
    const proposal={version:1,parts:[{id:'door',parent:'$root'},{id:'body',parent:'door'}]};
    const result=await new SegmentMaterializePass().run({document,partSegmentation:evidence(),partProposal:proposal});
    expect(result.partSegmentation.materialization.status).toBe('materialized');
    const door=node.listChildren().find((child)=>child.getName()==='Source__part_door');
    expect(door).toBeTruthy();
    expect(door.listChildren().map((child)=>child.getName())).toEqual(['Source__part_body']);
    const body=door.listChildren()[0];
    expect(body.getTranslation()).toEqual([0,0,0]);
    expect(body.getRotation()).toEqual([0,0,0,1]);
  });

  it('rejects evidence faceCount that does not describe the materialized source mesh', async()=>{
    const {document,node}=fixture();
    const bad=evidence(); bad.faceCount=3;
    const result=await new SegmentMaterializePass().run({document,partSegmentation:bad});
    expect(result.partSegmentation.materialization.status).toBe('rejected');
    expect(result.partSegmentation.materialization.issues[0].code).toBe('MATERIALIZATION_SOURCE_FACE_COUNT_MISMATCH');
    expect(node.getMesh()).not.toBeNull();
  });


  it('does not invent high confidence when segmentation confidence is absent', async()=>{
    const {document}=fixture();
    const unknown=evidence();
    unknown.segments.forEach((segment)=>delete segment.confidence);
    const result=await new SegmentMaterializePass().run({document,partSegmentation:unknown});
    expect(result.partProposal.confidence).toBe(0);
  });


  it('rejects malformed or duplicate segmentation evidence before mutating the document', async()=>{
    const {document,node}=fixture();
    const bad=evidence();
    bad.segments.push({...bad.segments[0]});
    const result=await new SegmentMaterializePass().run({document,partSegmentation:bad});
    expect(result.partSegmentation.materialization.status).toBe('rejected');
    expect(result.partSegmentation.materialization.issues[0].code).toBe('MATERIALIZATION_SEGMENT_INVALID');
    expect(node.getMesh()).not.toBeNull();
    expect(node.listChildren()).toHaveLength(0);
  });


  it('fills missing parent segment stubs into an existing partial Part Proposal', async()=>{
    const {document}=fixture();
    const proposal={version:1,source:'joint-provider',parts:[{id:'body',parent:'door',actions:['open']}]};
    const result=await new SegmentMaterializePass().run({document,partSegmentation:evidence(),partProposal:proposal});
    expect(result.partSegmentation.materialization.status).toBe('materialized');
    expect(result.partProposal.parts.find((part)=>part.id==='body').node).toBe('Source__part_body');
    expect(result.partProposal.parts.find((part)=>part.id==='door')).toMatchObject({id:'door',node:'Source__part_door',semantic:'door',confidence:.9});
  });


  it('refuses automatic materialization for skinned nodes', async()=>{
    const {document,node}=fixture();
    node.setSkin(document.createSkin('Skin'));
    const result=await new SegmentMaterializePass().run({document,partSegmentation:evidence()});
    expect(result.partSegmentation.materialization.status).toBe('rejected');
    expect(result.partSegmentation.materialization.issues[0].code).toBe('MATERIALIZATION_SKIN_UNSUPPORTED');
    expect(node.getMesh()).not.toBeNull();
  });

  it('refuses automatic materialization for morph-weight meshes', async()=>{
    const {document,node}=fixture();
    node.getMesh().setWeights([0]);
    const result=await new SegmentMaterializePass().run({document,partSegmentation:evidence()});
    expect(result.partSegmentation.materialization.status).toBe('rejected');
    expect(result.partSegmentation.materialization.issues[0].code).toBe('MATERIALIZATION_MORPH_UNSUPPORTED');
    expect(node.getMesh()).not.toBeNull();
  });

});
