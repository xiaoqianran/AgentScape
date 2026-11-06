import { describe, it, expect } from 'vitest';
import { parseSceneProject, resolveSceneProject } from '../../application/scene/SceneProject.js';
import { BUILTIN_ENVIRONMENT_IDS } from '../../modules/world/content/environments.js';

const project = () => ({ schema: 'agentscape.scene-project', schemaVersion: 1, name: 'Example',
  environment: { type: 'builtin', id: 'monument-hall' },
  objects: [{ id: 'cup', asset: './assets/cup.glb', level: 'visual' }] });
const builtins = new Map([['builtin://monument-hall', 'a'.repeat(64)]]);

describe('Scene Project v1 contract', () => {
  it('uses the actual built-in environment catalog for portable project IDs', () => {
    for (const environmentId of BUILTIN_ENVIRONMENT_IDS) {
      const parsed=parseSceneProject({ ...project(), environment:{type:'builtin',id:environmentId} });
      expect(parsed.environment.id).toBe(environmentId);
    }
    for (const environmentId of ['liangzhu-ancient-city','unknown-world']) {
      expect(() => parseSceneProject({ ...project(), environment:{type:'builtin',id:environmentId} }))
        .toThrow('INVALID_DOCUMENT');
    }
  });
  it('parses JSON with independent default transforms and preserves requested capability', () => {
    const input = project();
    input.objects.push({ id: 'table', asset: 'builtin://table', level: 'interactive' });
    input.objects[0].transform = {};
    input.objects[1].transform = {};
    const parsed = parseSceneProject(JSON.stringify(input));
    expect(parsed.objects[0].transform).toEqual({ position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: 1 });
    parsed.objects[0].transform.position[0] = 7;
    expect(parsed.objects[1].transform.position[0]).toBe(0);
    expect(parsed.objects[1].level).toBe('interactive');
    expect(input.objects[0].transform).toEqual({});
  });
  it.each([
    p => { p.extra = true; },
    p => { p.environment.extra = true; },
    p => { p.objects[0].extra = true; },
    p => { delete p.objects[0].level; },
    p => { p.objects.push({ ...p.objects[0] }); },
    p => { p.objects[0].transform = { quaternion: [0, 0, 0, 2] }; },
    p => { p.objects[0].transform = { scale: -1 }; },
    p => { p.objects[0].transform = { position: [Infinity, 0, 0] }; },
    p => { p.objects[0].transform = { extra: true }; },
  ])('rejects invalid documents without mutating inputs', mutate => {
    const p = project(); mutate(p);
    expect(() => parseSceneProject(p)).toThrow('INVALID_DOCUMENT');
  });
  it.each(['./../secret', './assets/../secret', '/etc/passwd', 'C:/secret', './a\\b',
    './a//b', './%2e%2e/x', './a:stream', './con.glb', './a.', 'https://host/a.glb'])('rejects unsafe reference %s', asset => {
    const p = project(); p.objects[0].asset = asset;
    expect(() => parseSceneProject(p)).toThrow('INVALID_DOCUMENT');
  });
  it('rejects YAML, oversized JSON and unsupported versions', () => {
    expect(() => parseSceneProject('schema: agentscape.scene-project')).toThrow('INVALID_DOCUMENT');
    expect(() => parseSceneProject(' '.repeat(256 * 1024 + 1))).toThrow('DOCUMENT_LIMIT');
    expect(() => parseSceneProject({ ...project(), schemaVersion: 2 })).toThrow('UNSUPPORTED_VERSION');
  });
  it('hashes bytes deterministically and does not claim admission or execute content', async () => {
    const resources = new Map([['./assets/cup.glb', new TextEncoder().encode('abc')]]);
    const result = await resolveSceneProject(project(), { builtins, resources });
    expect(result.dependencies).toEqual([
      { ref: 'builtin://monument-hall', sha256: 'a'.repeat(64) },
      { ref: './assets/cup.glb', sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' }
    ]);
    expect(result).not.toHaveProperty('verified');
  });
  it('rejects missing resources and unversioned builtins', async () => {
    await expect(resolveSceneProject(project(), { builtins })).rejects.toThrow('RESOURCE_UNAVAILABLE');
    await expect(resolveSceneProject(project())).rejects.toThrow('RESOURCE_UNAVAILABLE');
  });
  it('rejects case collisions, link descriptors and oversized bytes', async () => {
    for (const resources of [
      new Map([['./A.glb', new Uint8Array()], ['./a.glb', new Uint8Array()]]),
      new Map([['./a.glb', { symlink: '../outside' }]]),
      new Map([['./a.glb', new Uint8Array(32 * 1024 * 1024 + 1)]])
    ]) await expect(resolveSceneProject(project(), { builtins, resources })).rejects.toThrow();
  });
});
