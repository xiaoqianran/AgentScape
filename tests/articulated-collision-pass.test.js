import { Document, Primitive } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { ArticulatedCollisionPass } from '../asset/compiler/passes/ArticulatedCollisionPass.js';

function addTriangle(document,parent,name,x=0){
  const buffer=document.getRoot().listBuffers()[0] || document.createBuffer();
  const pos=document.createAccessor(`${name}_p`).setType('VEC3').setBuffer(buffer).setArray(new Float32Array([0,0,0,1,0,0,0,1,0]));
  const prim=document.createPrimitive().setMode(Primitive.Mode.TRIANGLES).setAttribute('POSITION',pos);
  const node=document.createNode(name).setMesh(document.createMesh(`${name}Mesh`).addPrimitive(prim)).setTranslation([x,0,0]);
  parent.addChild(node); return node;
}

describe('ArticulatedCollisionPass',()=>{
  it('removes executable Part geometry from root collision ownership and absorbs non-part descendants',async()=>{
    const document=new Document(); const scene=document.createScene('Scene');
    addTriangle(document,scene,'Body',0);
    const door=document.createNode('Door').setTranslation([2,0,0]); scene.addChild(door);
    addTriangle(document,door,'DoorPanel',0); addTriangle(document,door,'Handle',1);
    const context={document,collision:{strategy:'coacd',quality:'convex-decomposition',colliders:[{shape:'convexHull',vertices:[0,0,0,1,0,0,0,1,0,0,0,1]}]},articulation:{parts:{door:{node:'Door',physics:{body:'dynamic',colliders:[{shape:'box',halfExtents:[1,1,1]}],collider:{generated:true}}}}}};
    const result=await new ArticulatedCollisionPass().run(context);
    expect(result.partCollision.final.rootMeshNodes).toEqual(['Body']);
    expect(result.partCollision.final.generated[0].meshNodes.sort()).toEqual(['DoorPanel','Handle']);
    expect(result.articulation.parts.door.physics.colliders).toHaveLength(2);
    expect(result.collision.strategy).toBe('articulated-owned-mesh-aabb');
    expect(result.collision.colliders).toHaveLength(1);
  });

  it('preserves provider-supplied Part colliders',async()=>{
    const document=new Document(); const scene=document.createScene('Scene');
    const door=addTriangle(document,scene,'Door');
    const provider=[{shape:'convexHull',vertices:[0,0,0,1,0,0,0,1,0,0,0,1]}];
    const context={document,collision:{strategy:'coacd',quality:'convex-decomposition',colliders:[]},articulation:{parts:{door:{node:door.getName(),physics:{body:'dynamic',colliders:provider}}}}};
    const result=await new ArticulatedCollisionPass().run(context);
    expect(result.articulation.parts.door.physics.colliders).toEqual(provider);
    expect(result.partCollision.final.preserved).toEqual([{part:'door',colliders:1}]);
    expect(result.collision.quality).toBe('provider-part-colliders');
  });

  it('leaves non-articulated whole-asset collision untouched',async()=>{
    const context={articulation:{parts:{}},collision:{strategy:'coacd',quality:'convex-decomposition',colliders:[1]}};
    expect(await new ArticulatedCollisionPass().run(context)).toBe(context);
  });

  it('keeps whole-asset mass as provenance instead of assigning it all to the articulated root body',async()=>{
    const document=new Document(); const scene=document.createScene('Scene'); const door=addTriangle(document,scene,'Door');
    const context={document,physics:{mass:12,friction:.4},collision:{strategy:'coacd',quality:'convex-decomposition',colliders:[]},articulation:{parts:{door:{node:door.getName(),physics:{body:'dynamic',colliders:[{shape:'box',halfExtents:[1,1,1]}]}}}}};
    const result=await new ArticulatedCollisionPass().run(context);
    expect(result.physics.mass).toBeUndefined();
    expect(result.physics.friction).toBe(.4);
    expect(result.partCollision.final.mass).toEqual({status:'unpartitioned',wholeAssetMass:12});
  });

});
