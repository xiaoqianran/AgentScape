import { Document } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { PartGeometryEnrichmentPass } from '../../asset/compiler/passes/PartGeometryEnrichmentPass.js';

const fallback={shape:'box',halfExtents:[.5,.5,.5]};
const hull={shape:'convexHull',vertices:[0,0,0,1,0,0,0,1,0,0,0,1]};
const context=()=>{
  const document=new Document(); document.createScene('Scene').addChild(document.createNode('Door'));
  return {document,articulation:{parts:{door:{node:'Door',physics:{body:'dynamic',colliders:[fallback],collider:{strategy:'owned-mesh-aabb',quality:'coarse',generated:true}}}}}};
};
const io={writeBinary:async()=>new Uint8Array([1,2,3])};

describe('PartGeometryEnrichmentPass',()=>{
  it('replaces coarse fallback with validated provider colliders without duplicating hull vertices in reports',async()=>{
    const provider={endpoint:'https://compiler.test',isConfigured:()=>true,runPartGeometry:async()=>({parts:{door:{collision:{strategy:'coacd-part',quality:'convex-decomposition',colliders:[hull]},physics:{mass:2,friction:.6},geometry:{watertight:true,volume:.004}}}})};
    const result=await new PartGeometryEnrichmentPass({provider,io}).run(context());
    expect(result.articulation.parts.door.physics.colliders).toEqual([hull]);
    expect(result.articulation.parts.door.physics.mass).toBe(2);
    expect(result.articulation.parts.door.physics.collider).toMatchObject({strategy:'coacd-part',generated:false});
    expect(result.partGeometry.upgraded).toEqual(['door']);
    expect(result.partGeometry.reports.door.collision).toEqual({strategy:'coacd-part',quality:'convex-decomposition',hulls:1});
    expect(result.partGeometry.reports.door).not.toHaveProperty('colliders');
  });

  it('ignores invalid provider colliders and preserves the fallback',async()=>{
    const provider={endpoint:'x',isConfigured:()=>true,runPartGeometry:async()=>({parts:{door:{collision:{strategy:'bad',colliders:[{shape:'convexHull',vertices:[0,0,0]}]}}}})};
    const result=await new PartGeometryEnrichmentPass({provider,io}).run(context());
    expect(result.articulation.parts.door.physics.colliders).toEqual([fallback]);
    expect(result.partGeometry.issues[0].code).toBe('PART_GEOMETRY_INVALID_COLLIDER');
  });

  it('keeps fallback collision when the optional provider fails',async()=>{
    const provider={endpoint:'x',isConfigured:()=>true,runPartGeometry:async()=>{throw new Error('offline')}};
    const result=await new PartGeometryEnrichmentPass({provider,io}).run(context());
    expect(result.articulation.parts.door.physics.colliders).toEqual([fallback]);
    expect(result.partGeometry.error).toBe('offline');
  });
});
