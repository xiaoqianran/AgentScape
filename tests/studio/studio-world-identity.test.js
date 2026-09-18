import { describe, expect, it } from 'vitest';
import { resolveStudioWorldIdentity, studioSceneStoreKey } from '../../apps/studio/runtime/StudioWorldIdentity.js';

describe('Studio world identity', () => {
  const builtin = {
    id:'monument-hall',
    number:'WORLD 01',
    title:'纪念大厅',
    headline:'Hall',
    description:'Built in',
    facts:['RAPIER'],
    bootstrap:{agent:[0,0,0],cup:[1,0,1]}
  };

  it('preserves the existing built-in autosave key', () => {
    const identity = resolveStudioWorldIdentity({id:'monument-hall'}, {builtins:[builtin],fallback:builtin});
    expect(identity).toMatchObject({id:'monument-hall',generated:false,worldFirst:false,title:'纪念大厅'});
    expect(studioSceneStoreKey(identity)).toBe('agentscape.scene.autosave.monument-hall');
  });

  it('carries world-first presentation through the runtime identity', () => {
    const worldFirst = {...builtin,id:'woodland-workshop',worldFirst:true};
    const identity = resolveStudioWorldIdentity({id:'woodland-workshop'}, {builtins:[worldFirst]});
    expect(identity).toMatchObject({id:'woodland-workshop',generated:false,worldFirst:true});
  });

  it('isolates generated worlds by persisted manifest artifact', () => {
    const first = resolveStudioWorldIdentity({
      id:'generated-garden',
      generated:{artifacts:{'world-manifest':'manifest_01'}}
    });
    const second = resolveStudioWorldIdentity({
      id:'generated-garden',
      generated:{artifacts:{'world-manifest':'manifest_02'}}
    });
    expect(first.generated).toBe(true);
    expect(first.worldFirst).toBe(false);
    expect(first.bootstrap).toEqual({agent:[0,0,0]});
    expect(studioSceneStoreKey(first)).not.toBe(studioSceneStoreKey(second));
    expect(studioSceneStoreKey(first)).toContain('manifest_01');
  });

  it('uses external manifest URL identity when no artifact registry id exists', () => {
    const identity = resolveStudioWorldIdentity({
      id:'generated-world',
      generated:{manifest:{url:'https://example.com/world/runtime.json'}}
    });
    expect(identity.persistenceSource).toBe('manifest:https://example.com/world/runtime.json');
    expect(studioSceneStoreKey(identity)).toContain('generated.');
  });
});
