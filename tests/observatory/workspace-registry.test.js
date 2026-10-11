import {describe,it,expect} from 'vitest';
import {WORKSPACES,resolveWorkspace,workspaceForLab} from '../../apps/observatory/core/WorkspaceRegistry.js';
import {LabRegistry} from '../../apps/observatory/core/LabRegistry.js';

describe('Observatory workspace IA',()=>{
  it('provides all workspaces and unique tools in each workspace',()=>{
    expect(WORKSPACES.map(w=>w.id)).toEqual(['simulation','assets','agent','rendering']);
    for(const w of WORKSPACES){expect(new Set(w.tools.map(t=>t.id)).size).toBe(w.tools.length);expect(w.tools.some(t=>t.id===w.defaultLab)).toBe(true)}
  });
  it('resolves legacy lab links and keeps rendering as a separate context',()=>{
    expect(workspaceForLab('navigation')).toBe('simulation');
    expect(workspaceForLab('physics')).toBe('simulation');
    expect(resolveWorkspace('rendering','physics-studio').id).toBe('rendering');
    expect(resolveWorkspace(null,'gaussian').id).toBe('assets');
  });
});
