import { Document, Primitive } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { PartColliderPass } from '../src/compiler/passes/PartColliderPass.js';

function triangle(document,parent,name){
  const buffer=document.getRoot().listBuffers()[0] || document.createBuffer();
  const pos=document.createAccessor(`${name}_p`).setType('VEC3').setBuffer(buffer).setArray(new Float32Array([0,0,0,1,0,0,0,1,.1]));
  const prim=document.createPrimitive().setMode(Primitive.Mode.TRIANGLES).setAttribute('POSITION',pos);
  const node=document.createNode(name).setMesh(document.createMesh(`${name}Mesh`).addPrimitive(prim)); parent.addChild(node); return node;
}

describe('PartColliderPass',()=>{
  it('builds a provisional collider from descendant mesh geometry owned by a structural Part node',async()=>{
    const document=new Document(); const scene=document.createScene('Scene');
    const hinge=document.createNode('Hinge'); scene.addChild(hinge); triangle(document,hinge,'DoorMesh');
    const context={document,partProposal:{version:1,parts:[{id:'door',node:'Hinge'}]}};
    const result=await new PartColliderPass().run(context);
    expect(result.partProposal.parts[0].physics.collider.strategy).toBe('proposal-owned-mesh-aabb');
    expect(result.partProposal.parts[0].physics.colliders).toHaveLength(1);
    expect(result.partCollision.provisional.generated[0].meshNodes).toEqual(['DoorMesh']);
  });

  it('does not overwrite provider-supplied colliders',async()=>{
    const document=new Document(); const scene=document.createScene('Scene'); const node=triangle(document,scene,'Door');
    const provider=[{shape:'box',halfExtents:[1,1,1]}];
    const result=await new PartColliderPass().run({document,partProposal:{version:1,parts:[{id:'door',node:node.getName(),physics:{body:'dynamic',colliders:provider}}]}});
    expect(result.partProposal.parts[0].physics.colliders).toEqual(provider);
    expect(result.partCollision.provisional.skipped).toEqual([{part:'door',reason:'provider-collider'}]);
  });
});
