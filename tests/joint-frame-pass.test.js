import { describe, expect, it } from 'vitest';
import { JointFramePass } from '../src/compiler/passes/JointFramePass.js';

const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
const translatedX = (x) => [1,0,0,0, 0,1,0,0, 0,0,1,0, x,0,0,1];
const rowsTranslatedX = (x) => [[1,0,0,x],[0,1,0,0],[0,0,1,0],[0,0,0,1]];

describe('JointFramePass', () => {
  it('compiles safe URDF link-local frames into explicit Rapier anchors', async () => {
    const context={
      inspection:{nodes:[
        {name:'Door',worldMatrix:translatedX(.4)}
      ]},
      partProposal:{version:1,frameConvention:'urdf-link-local',parts:[{
        id:'door',node:'Door',parent:'$root',joint:{type:'revolute',axis:[0,1,0],limits:[-1,0],urdf:{parentToJointMatrix:rowsTranslatedX(.4)}}
      }]}
    };
    const result=await new JointFramePass().run(context);
    expect(result.partProposal.parts[0].joint.parentAnchor).toEqual([.4,0,0]);
    expect(result.partProposal.parts[0].joint.childAnchor).toEqual([0,0,0]);
    expect(result.partProposal.jointFrame.issues).toEqual([]);
  });

  it('refuses frames whose zero pose disagrees with the original GLB transform', async () => {
    const context={inspection:{nodes:[{name:'Door',worldMatrix:identity}]},partProposal:{version:1,frameConvention:'urdf-link-local',parts:[{id:'door',node:'Door',joint:{axis:[0,1,0],urdf:{parentToJointMatrix:rowsTranslatedX(.4)}}}]}};
    const result=await new JointFramePass().run(context);
    expect(result.partProposal.parts[0].joint.parentAnchor).toBeUndefined();
    expect(result.partProposal.jointFrame.issues[0].code).toBe('JOINT_FRAME_MISMATCH');
  });

  it('refuses rotated URDF joint frames when the single Rapier axis cannot represent both local frames safely', async () => {
    const rows=[[0,-1,0,0],[1,0,0,0],[0,0,1,0],[0,0,0,1]];
    const world=[0,1,0,0,-1,0,0,0,0,0,1,0,0,0,0,1];
    const context={inspection:{nodes:[{name:'Door',worldMatrix:world}]},partProposal:{version:1,frameConvention:'urdf-link-local',parts:[{id:'door',node:'Door',joint:{axis:[1,0,0],urdf:{parentToJointMatrix:rows}}}]}};
    const result=await new JointFramePass().run(context);
    expect(result.partProposal.parts[0].joint.parentAnchor).toBeUndefined();
    expect(result.partProposal.jointFrame.issues[0].code).toBe('JOINT_FRAME_ROTATION_UNSUPPORTED');
  });

  it('uses the declared parent Part frame for nested URDF joints', async () => {
    const doorWorld=translatedX(2);
    const sliderWorld=translatedX(2.3);
    const context={
      inspection:{nodes:[{name:'Door',worldMatrix:doorWorld},{name:'Slider',worldMatrix:sliderWorld}]},
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
