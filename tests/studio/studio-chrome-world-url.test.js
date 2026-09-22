import { describe, expect, it } from 'vitest';
import {
  agentViewForStudioView,
  builtInWorldUrl,
  pageForStudioView,
  PRODUCT_NAVIGATION,
  WORLD_EDITOR_UTILITIES
} from '../../apps/studio/navigation/StudioNavigation.js';

describe('Studio product navigation', () => {
  it('separates Worlds product navigation from the persistent World Editor', () => {
    expect(PRODUCT_NAVIGATION.map((item) => item.page)).toEqual(['worlds','build','assets','agent','observatory']);
    expect(PRODUCT_NAVIGATION.find((item) => item.page === 'observatory')?.href).toBe('/observatory/');
    expect(WORLD_EDITOR_UTILITIES.map((item) => item.view)).toEqual(['inspect']);
  });

  it('maps legacy Studio intents onto product pages without copying product truth into editor layout', () => {
    expect(pageForStudioView('world')).toBe('world');
    expect(pageForStudioView('create')).toBe('build');
    expect(pageForStudioView('resources')).toBe('assets');
    expect(pageForStudioView('task')).toBe('agent');
    expect(pageForStudioView('runs')).toBe('agent');
    expect(pageForStudioView('inspect')).toBe('world');
    expect(agentViewForStudioView('task')).toBe('tasks');
    expect(agentViewForStudioView('runs')).toBe('runs');
  });

  it('drops generated-world source parameters when switching back to a built-in world', () => {
    const url=builtInWorldUrl('http://127.0.0.1:5173/?worldManifest=abc&mesh=m.glb&visual=v.glb&semantics=s.json&up=Y&worldArtifact=a1&authoring=d1&foo=bar','monument-hall');
    const parsed=new URL(url);
    expect(parsed.searchParams.get('page')).toBe('world');
    expect(parsed.searchParams.get('world')).toBe('monument-hall');
    expect(parsed.searchParams.get('foo')).toBe('bar');
    for (const key of ['worldManifest','mesh','visual','semantics','up','worldArtifact','authoring']) expect(parsed.searchParams.has(key)).toBe(false);
  });
});
