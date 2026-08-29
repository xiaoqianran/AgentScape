import { Document } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { PartProposalPass } from '../../asset/compiler/passes/PartProposalPass.js';

const context = (partProposal) => ({
  inspection:{nodes:[{name:'Door'},{name:'Handle'}]},
  articulation:{candidates:[]},
  partProposal
});
const physics={body:'dynamic',colliders:[{shape:'box',halfExtents:[.1,.1,.1]}]};
const joint={type:'revolute',axis:[0,1,0],limits:[-1,0],parentAnchor:[0,0,0],childAnchor:[0,0,0]};

describe('PartProposalPass', () => {
  it('promotes only executable provider parts', async () => {
    const proposal={version:1,source:'test',confidence:.9,parts:[
      {id:'door',node:'Door',semantic:'door',actions:['open','close'],targets:{open:-1,close:0},physics,joint},
      {id:'handle',node:'Handle',parent:'door',semantic:'handle',confidence:.8}
    ]};
    const result=await new PartProposalPass().run(context(proposal));
    expect(result.partProposal.accepted).toBe(true);
    expect(result.partProposal.promoted).toEqual(['door']);
    expect(result.partProposal.unpromoted).toEqual([{part:'handle',reason:'missing-joint'}]);
    expect(result.articulation.parts.door.parent).toBe('$root');
    expect(result.articulation.parts.handle).toBeUndefined();
  });

  it('keeps bad proposals as report-only data', async () => {
    const proposal={version:1,parts:[{id:'door',node:'Missing',actions:['open'],targets:{open:-1},physics,joint}]};
    const result=await new PartProposalPass().run(context(proposal));
    expect(result.partProposal.accepted).toBe(false);
    expect(result.partProposal.issues[0].code).toBe('PART_NODE_MISSING');
    expect(result.articulation.parts).toBeUndefined();
  });

  it('does not promote an executable child when its declared parent has no runtime body', async () => {
    const proposal={version:1,parts:[
      {id:'door',node:'Door'},
      {id:'handle',node:'Handle',parent:'door',actions:['open'],targets:{open:-1},physics,joint}
    ]};
    const result=await new PartProposalPass().run(context(proposal));
    expect(result.partProposal.accepted).toBe(true);
    expect(result.partProposal.promoted).toEqual([]);
    expect(result.partProposal.unpromoted).toEqual(expect.arrayContaining([
      {part:'door',reason:'missing-joint'},
      {part:'handle',reason:'parent-not-executable'}
    ]));
  });




  it('rejects ambiguous GLB node names instead of binding a proposal arbitrarily', async () => {
    const proposal={version:1,parts:[{id:'door',node:'Door',actions:['open'],targets:{open:-1},physics,joint}]};
    const result=await new PartProposalPass().run({
      inspection:{nodes:[{name:'Door'},{name:'Door'}]},
      articulation:{candidates:[]},
      partProposal:proposal
    });
    expect(result.partProposal.accepted).toBe(false);
    expect(result.partProposal.issues[0].code).toBe('PART_NODE_AMBIGUOUS');
    expect(result.articulation.parts).toBeUndefined();
  });


  it('accepts a declared parent that matches the real glTF node hierarchy', async () => {
    const document=new Document();
    const door=document.createNode('Door');
    const handle=document.createNode('Handle');
    door.addChild(handle); document.createScene('Scene').addChild(door);
    const proposal={version:1,parts:[
      {id:'door',node:'Door'},
      {id:'handle',node:'Handle',parent:'door'}
    ]};
    const result=await new PartProposalPass().run({ inspection:{nodes:[]}, articulation:{candidates:[]}, partProposal:proposal, document });
    expect(result.partProposal.accepted).toBe(true);
  });

  it('rejects a declared parent that disagrees with the real glTF node hierarchy', async () => {
    const document=new Document();
    const scene=document.createScene('Scene');
    scene.addChild(document.createNode('Door'));
    scene.addChild(document.createNode('Handle'));
    const proposal={version:1,parts:[
      {id:'door',node:'Door'},
      {id:'handle',node:'Handle',parent:'door'}
    ]};
    const result=await new PartProposalPass().run({ inspection:{nodes:[]}, articulation:{candidates:[]}, partProposal:proposal, document });
    expect(result.partProposal.accepted).toBe(false);
    expect(result.partProposal.issues.some((issue)=>issue.code==='PART_NODE_HIERARCHY_MISMATCH')).toBe(true);
  });

});
