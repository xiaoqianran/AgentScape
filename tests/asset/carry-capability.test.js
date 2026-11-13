import { describe, expect, it } from 'vitest';
import { inferCarryCapability } from '../../modules/world/runtime/interaction/CarryCapability.js';
import { recipeSchema } from '../../modules/asset/model/AssetInputContracts.js';
import { ArticulationCandidatePass } from '../../modules/asset/production/compiler/passes/ArticulationCandidatePass.js';

const unknown = (overrides = {}) => ({
  id:'unclassified_prop', type:'unknown', source:{kind:'builtin'}, actions:[],
  physics:{body:'dynamic',mass:1,colliders:[{shape:'box',halfExtents:[.15,.1,.12]}]},
  ...overrides
});

describe('physical affordance inference', () => {
  it('derives attachable carry from mass and collider geometry without category or action names', () => {
    expect(inferCarryCapability(unknown())).toMatchObject({
      eligible:true,source:'physical-geometry',mode:'kinematic-anchor',graspVerified:false
    });
    expect(inferCarryCapability(unknown(),{scale:5})).toMatchObject({eligible:false,reason:'CARRY_MASS_EXCEEDED'});
    expect(inferCarryCapability(unknown({physics:{body:'dynamic',mass:.01,colliders:[{shape:'box',halfExtents:[.15,.1,.12]}]}}),{scale:6})).toMatchObject({eligible:false,reason:'CARRY_SIZE_EXCEEDED'});
  });

  it('respects structural, mass, collider, and explicit denial boundaries', () => {
    expect(inferCarryCapability(unknown({physics:{body:'fixed',mass:1,colliders:[]}}))).toMatchObject({reason:'TARGET_NOT_DYNAMIC'});
    expect(inferCarryCapability(unknown({physics:{body:'dynamic',mass:18,colliders:[{shape:'box',halfExtents:[.1,.1,.1]}]}}))).toMatchObject({reason:'CARRY_MASS_EXCEEDED'});
    expect(inferCarryCapability(unknown({physics:{body:'dynamic',mass:1,carryable:false,colliders:[{shape:'box',halfExtents:[.1,.1,.1]}]}}))).toMatchObject({reason:'CARRY_DISABLED'});
    expect(inferCarryCapability(unknown({parts:{hinge:{}}}))).toMatchObject({reason:'ARTICULATED_TARGET_UNSUPPORTED'});
    expect(inferCarryCapability(unknown({physics:{body:'dynamic',mass:1,sensor:true,colliders:[{shape:'box',halfExtents:[.1,.1,.1]}]}}))).toMatchObject({reason:'CARRY_SENSOR_UNSUPPORTED'});
    expect(inferCarryCapability(unknown({physics:{body:'dynamic',mass:1,lockTranslation:[true,true,true],colliders:[{shape:'box',halfExtents:[.1,.1,.1]}]}}))).toMatchObject({reason:'CARRY_TRANSLATION_LOCKED'});
    expect(inferCarryCapability(unknown({physics:{body:'dynamic',mass:1,colliders:[{shape:'convexHull',vertices:Array(12).fill(1)}]}}))).toMatchObject({reason:'CARRY_COLLIDER_UNSUPPORTED'});
    const unverified = unknown({source:{kind:'compiled',key:'opaque'},compiler:{quality:{status:'provisional'}}});
    expect(inferCarryCapability(unverified)).toMatchObject({reason:'CARRY_ASSET_UNVERIFIED'});
    expect(inferCarryCapability(unverified,{allowProvisional:true})).toMatchObject({reason:'CARRY_ASSET_UNVERIFIED'});
    const authored = {...unverified,provenance:{authoringIntent:{usage:'movable'}}};
    expect(inferCarryCapability(authored)).toMatchObject({reason:'CARRY_ASSET_UNVERIFIED'});
    expect(inferCarryCapability(authored,{allowProvisional:true})).toMatchObject({eligible:true,graspVerified:false});
  });

  it('allows explicit recipe opt-out while retaining declared physics', () => {
    const schema = { schema:'agentscape.asset-recipe',schemaVersion:1,id:'synthetic/device',
      parts:[{id:'body',geometry:{type:'box',size:[.3,.3,.3]}}],
      capabilities:{level:'physical',physics:{body:'dynamic',mass:1,carryable:false,
        colliders:[{shape:'box',halfExtents:[.15,.15,.15]}]}}
    };
    expect(recipeSchema.parse(schema).capabilities.physics.carryable).toBe(false);
    expect(()=>recipeSchema.parse({...schema,capabilities:{...schema.capabilities,physics:{...schema.capabilities.physics,carryable:'no'}}})).toThrow();
  });
});

describe('provisional semantic articulation proposals', () => {
  it('proposes page turning, lid opening and joint-metadata operations without authorizing motion', async () => {
    const result = await new ArticulationCandidatePass().run({
      inspection:{nodes:[{name:'PageLeaf'},{name:'Lid_Hinge'},{name:'Segment_04'}]},
      partProposal:{version:1,source:'urdf',parts:[{id:'mover',node:'Segment_04',confidence:.9,joint:{type:'prismatic'}}]},
      interactionProposal:true
    });
    expect(result.articulation.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({node:'PageLeaf',jointType:'revolute',suggestedActions:['turnPage'],executable:false,physicsVerified:false,requiresReview:true}),
      expect.objectContaining({node:'Lid_Hinge',jointType:'revolute',suggestedActions:['open','close'],executable:false}),
      expect.objectContaining({node:'Segment_04',partId:'mover',jointType:'prismatic',suggestedActions:['slide'],executable:false,source:'joint-metadata'})
    ]));
    expect(result.partProposal.parts).toHaveLength(1); // Existing source is not silently replaced.
  });
});
