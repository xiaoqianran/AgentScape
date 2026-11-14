import { it, expect } from 'vitest';
import { publicMcpError } from '../../apps/mcp-server/errorDiagnostics.js';

it('returns bounded actionable part-collision diagnostics without exposing stacks', () => {
  const error=Object.assign(new Error('Package articulation failed validation'),{
    code:'ASSET_PHYSICS_VERIFICATION_FAILED',
    details:{tested:1,parts:[{part:'door',actions:[{
      action:'open',ok:false,failures:[{
        stage:'EXECUTION',code:'COLLISION_REGRESSION',collisions:[{
          sourcePart:'door',targetPart:'$root',depth:.1855819374
        }]
      }]
    }]}]}
  });
  expect(publicMcpError(error)).toMatchObject({
    state:'failed',code:'ASSET_PHYSICS_VERIFICATION_FAILED',
    diagnostics:{parts:[{part:'door',actions:[{name:'open',
      failures:[{code:'COLLISION_REGRESSION',collisions:[{depth:.1856}]}]}]}]}
  });
  expect(JSON.stringify(publicMcpError(error))).not.toContain('Package articulation failed');
  expect(publicMcpError(Object.assign(new Error('hidden path'),{code:'ASSET_NOT_FOUND'}))).toEqual({
    state:'failed',code:'ASSET_NOT_FOUND'
  });
});
