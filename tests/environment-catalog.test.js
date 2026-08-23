import { describe, expect, it } from 'vitest';
import { DEFAULT_ENVIRONMENT, ENVIRONMENTS, resolveEnvironment } from '../src/content/environments.js';

describe('Environment catalog',()=>{
  it('keeps curated worlds as content metadata instead of Runtime branches',()=>{
    expect(ENVIRONMENTS.map((item)=>item.id)).toEqual(['monument-hall','ruined-courtyard']);
    expect(new Set(ENVIRONMENTS.map((item)=>item.id)).size).toBe(ENVIRONMENTS.length);
    for(const item of ENVIRONMENTS){
      expect(typeof item.create).toBe('function');
      expect(item.bootstrap).toMatchObject({table:expect.any(Array),cabinet:expect.any(Array),cup:expect.any(Array)});
    }
  });

  it('uses Monument Hall as the stable fallback for unknown links',()=>{
    expect(resolveEnvironment('ruined-courtyard').id).toBe('ruined-courtyard');
    expect(resolveEnvironment('does-not-exist')).toBe(DEFAULT_ENVIRONMENT);
  });
});
