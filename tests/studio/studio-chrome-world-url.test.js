import { describe, expect, it } from 'vitest';
import { builtInWorldUrl, STUDIO_NAVIGATION, workspaceForStudioView } from '../../apps/studio/ui/chrome/StudioChrome.js';

describe('StudioChrome world navigation', () => {
  it('keeps product workspaces primary and utility contexts secondary', () => {
    expect(STUDIO_NAVIGATION.filter((item) => item.group === 'primary').map((item) => item.view)).toEqual(['world','create','task']);
    expect(STUDIO_NAVIGATION.filter((item) => item.group === 'utility').map((item) => item.view)).toEqual(['resources','inspect','runs']);
  });

  it('preserves the primary workspace while opening utility contexts', () => {
    expect(workspaceForStudioView('world','resources')).toBe('world');
    expect(workspaceForStudioView('create','inspect')).toBe('create');
    expect(workspaceForStudioView('agent','runs')).toBe('agent');
    expect(workspaceForStudioView('world','create')).toBe('create');
    expect(workspaceForStudioView('create','task')).toBe('agent');
    expect(workspaceForStudioView('agent','world')).toBe('world');
  });

  it('drops generated-world source parameters when switching back to a built-in world', () => {
    const next = new URL(builtInWorldUrl(
      'http://127.0.0.1:5175/?world=old&worldManifest=https%3A%2F%2Fexample.com%2Fworld.json&mesh=world.ply&visual=world.spz&semantics=semantics.json&up=z&renderer=webgpu',
      'woodland-workshop'
    ));
    expect(next.searchParams.get('world')).toBe('woodland-workshop');
    expect(next.searchParams.get('renderer')).toBe('webgpu');
    for (const key of ['worldManifest','mesh','visual','semantics','up']) {
      expect(next.searchParams.has(key)).toBe(false);
    }
  });
});
