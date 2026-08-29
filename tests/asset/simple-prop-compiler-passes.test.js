import { describe, expect, it } from 'vitest';
import { SemanticHeuristicPass } from '../../asset/compiler/passes/SemanticHeuristicPass.js';
import { ColliderFallbackPass } from '../../asset/compiler/passes/ColliderFallbackPass.js';

describe('simple prop compiler passes',()=>{
  it('uses the caller label as semantic evidence for a generated apple',async()=>{
    const result=await new SemanticHeuristicPass().run({
      label:'Real Red Apple',sourceName:'artifact_opaque.glb',geometry:{namedNodes:['mesh_0']}
    });
    expect(result.semantics).toMatchObject({
      type:'apple',tags:['fruit','food','round','graspable'],actions:['move','pickup','drop','place'],confidence:.65,source:'heuristic'
    });
  });

  it('uses a carry-compatible capsule for round generated props and keeps AABB fallback otherwise',async()=>{
    const pass=new ColliderFallbackPass();
    const bounds={size:[.58,.66,.55],center:[0,.33,0]};
    const apple=await pass.run({geometry:{bounds},semantics:{tags:['round','graspable']}});
    expect(apple.collision).toMatchObject({strategy:'capsule-fit',quality:'primitive',colliders:[{shape:'capsule',translation:[0,.33,0]}]});
    expect(apple.collision.colliders[0].radius).toBeGreaterThan(0);
    expect(apple.collision.colliders[0].halfHeight).toBeGreaterThan(0);

    const cabinet=await pass.run({geometry:{bounds},semantics:{tags:['furniture']}});
    expect(cabinet.collision).toMatchObject({strategy:'aabb-fallback',quality:'coarse',colliders:[{shape:'box'}]});
  });
});
