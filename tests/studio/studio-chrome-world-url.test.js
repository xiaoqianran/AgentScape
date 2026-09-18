import { describe, expect, it } from 'vitest';
import { builtInWorldUrl } from '../../apps/studio/ui/chrome/StudioChrome.js';

describe('StudioChrome world navigation', () => {
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
