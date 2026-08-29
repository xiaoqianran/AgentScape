import { Document } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { JointFramePass } from '../../asset/compiler/passes/JointFramePass.js';

const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
const translatedX = (x) => [1,0,0,0, 0,1,0,0, 0,0,1,0, x,0,0,1];
const rowsTranslatedX = (x) => [[1,0,0,x],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
const documentWith = (...nodes) => {
  const document=new Document(); const scene=document.createScene('Scene');
  for (const [name,translation,parent] of nodes) {
    const node=document.createNode(name).setTranslation(translation);
    if (parent) parent.addChild(node); else scene.addChild(node);
  }
  return document;
};

describe('JointFramePass', () => {
  it('uses the normalized current GLB zero pose for the emitted root anchor', async () => {
    const document=documentWith(['Door',[-.2,1,.1]]);
    const context={
      document,
      inspection:{nodes:[{name:'Door',worldMatrix:translatedX(.4)}]},
      partProposal:{version:1,frameConvention:'urdf-link-local',parts:[{
        id:'door',node:'Door',parent:'$root',joint:{type:'revolute',axis:[0,1,0],limits:[-1,0],urdf:{parentToJointMatrix:rowsTranslatedX(.4)}}
      }]}
    };
    const result=await new JointFramePass().run(context);
    expect(result.partProposal.parts[0].joint.parentAnchor.map((v)=>Number(v.toFixed(6)))).toEqual([-.2,1,.1]);
    expect(result.partProposal.parts[0].joint.childAnchor).toEqual([0,0,0]);
    expect(result.partProposal.parts[0].joint.frame.normalizedParentAnchor).toBe(true);
  });

  it('refuses frames whose source zero pose disagrees with URDF', async () => {
    const document=documentWith(['Door',[0,0,0]]);
    const context={document,inspection:{nodes:[{name:'Door',worldMatrix:identity}]},partProposal:{version:1,frameConvention:'urdf-link-local',parts:[{id:'door',node:'Door',joint:{axis:[0,1,0],urdf:{parentToJointMatrix:rowsTranslatedX(.4)}}}]}};
    const result=await new JointFramePass().run(context);
    expect(result.partProposal.parts[0].joint.parentAnchor).toBeUndefined();
    expect(result.partProposal.jointFrame.issues[0].code).toBe('JOINT_FRAME_MISMATCH');
  });

  it('refuses rotated URDF joint frames when the single Rapier axis cannot represent both local frames safely', async () => {
    const rows=[[0,-1,0,0],[1,0,0,0],[0,0,1,0],[0,0,0,1]];
    const world=[0,1,0,0,-1,0,0,0,0,0,1,0,0,0,0,1];
    const document=new Document(); const node=document.createNode('Door').setRotation([0,0,Math.SQRT1_2,Math.SQRT1_2]); document.createScene('Scene').addChild(node);
    const context={document,inspection:{nodes:[{name:'Door',worldMatrix:world}]},partProposal:{version:1,frameConvention:'urdf-link-local',parts:[{id:'door',node:'Door',joint:{axis:[1,0,0],urdf:{parentToJointMatrix:rows}}}]}};
    const result=await new JointFramePass().run(context);
    expect(result.partProposal.parts[0].joint.parentAnchor).toBeUndefined();
    expect(result.partProposal.jointFrame.issues[0].code).toBe('JOINT_FRAME_ROTATION_UNSUPPORTED');
  });

  it('cancels global normalization translation for nested Part anchors', async () => {
    const document=new Document(); const scene=document.createScene('Scene');
    const door=document.createNode('Door').setTranslation([7,0,0]);
    const slider=document.createNode('Slider').setTranslation([.3,0,0]);
    door.addChild(slider); scene.addChild(door);
    const context={
      document,
      inspection:{nodes:[{name:'Door',worldMatrix:translatedX(2)},{name:'Slider',worldMatrix:translatedX(2.3)}]},
      partProposal:{version:1,frameConvention:'urdf-link-local',parts:[
        {id:'door',node:'Door',parent:'$root'},
        {id:'slider',node:'Slider',parent:'door',joint:{type:'prismatic',axis:[1,0,0],limits:[0,.5],urdf:{parentToJointMatrix:rowsTranslatedX(.3)}}}
      ]}
    };
    const result=await new JointFramePass().run(context);
    expect(result.partProposal.parts[1].joint.parentAnchor[0]).toBeCloseTo(.3,8);
    expect(result.partProposal.parts[1].joint.childAnchor).toEqual([0,0,0]);
  });
});
