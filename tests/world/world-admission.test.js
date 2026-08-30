import { describe, expect, it } from 'vitest';
import { evaluateWorldAdmission } from '../../world/compiler/WorldAdmission.js';

describe('evaluateWorldAdmission', () => {
  it('is the single final admission rule for full and incremental world compilation', () => {
    const result=evaluateWorldAdmission({
      validation:{counts:{hard:1,advisory:2}},
      assetAdmission:{status:'provisional'},
      layoutAdmission:{status:'rejected',reason:'WORLD_POSE_BLOCKED'},
      behaviorAdmission:{status:'rejected',issues:[{code:'BEHAVIOR_CAPABILITY_INTENT_UNSUPPORTED'}]},
      physicsAdmission:{status:'rejected',reason:'PHYSICS_BACKEND_CAPABILITY_MISSING'},
      relationAdmission:{status:'rejected',reason:'RELATION_TARGET_MISSING'},
      acceptance:{status:'world-incomplete'}
    });

    expect(result.status).toBe('rejected');
    expect(result.reasons).toEqual([
      'VALIDATION_HARD:1',
      'VALIDATION_ADVISORY:2',
      'ASSET_PROVISIONAL',
      'WORLD_POSE_BLOCKED',
      'BEHAVIOR_CAPABILITY_INTENT_UNSUPPORTED',
      'PHYSICS_BACKEND_CAPABILITY_MISSING',
      'RELATION_TARGET_MISSING',
      'WORLD_ACCEPTANCE_FAILED'
    ]);
  });

  it('keeps provisional classification generic while preserving detailed stage evidence', () => {
    const layoutAdmission={status:'provisional',reason:'ARTICULATED_LAYOUT_ROOT_ONLY',placements:[]};
    const result=evaluateWorldAdmission({validation:{counts:{hard:0,advisory:0}},layoutAdmission});

    expect(result).toMatchObject({
      status:'provisional',
      reasons:['LAYOUT_PROVISIONAL'],
      layout:layoutAdmission,
      validation:{hard:0,advisory:0}
    });
    expect(result.layout).not.toBe(layoutAdmission);
  });

  it('returns ready when no authoritative stage rejects or remains provisional', () => {
    expect(evaluateWorldAdmission({validation:{counts:{hard:0,advisory:0}}})).toEqual({
      status:'ready',reasons:[],validation:{hard:0,advisory:0}
    });
  });
});
