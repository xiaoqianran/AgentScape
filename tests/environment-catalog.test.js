import { describe, expect, it } from 'vitest';
import { DEFAULT_ENVIRONMENT, ENVIRONMENTS, resolveEnvironment } from '../src/content/environments.js';

describe('Environment catalog',()=>{
  it('keeps curated worlds as content metadata instead of Runtime branches',()=>{
    expect(ENVIRONMENTS.map((item)=>item.id)).toEqual(['monument-hall','ruined-courtyard','grand-urban-block']);
    expect(new Set(ENVIRONMENTS.map((item)=>item.id)).size).toBe(ENVIRONMENTS.length);
    for(const item of ENVIRONMENTS){
      expect(typeof item.load).toBe('function');
      expect(item.bootstrap).toMatchObject({agent:expect.any(Array),table:expect.any(Array),cabinet:expect.any(Array),cup:expect.any(Array)});
    }
  });

  it('uses Monument Hall as the stable fallback for unknown links',()=>{
    expect(resolveEnvironment('ruined-courtyard').id).toBe('ruined-courtyard');
    expect(resolveEnvironment('does-not-exist')).toBe(DEFAULT_ENVIRONMENT);
  });

  it('lazy-loads only the selected pack factory contract',async()=>{
    const definition=resolveEnvironment('grand-urban-block');
    const factory=await definition.load();
    expect(typeof factory).toBe('function');
    const world=factory({loadAssets:false});
    expect(world.id).toBe('grand-urban-block');
    world.dispose();
  });

});
