import { describe, expect, it, vi } from 'vitest';
import { createSession } from '../../application/createSession.js';
import { RenderingSystem } from '../../modules/world/runtime/systems/RenderingSystem.js';

const environmentFactory = vi.fn(async () => null);

describe('createSession rendering composition', () => {
  it('leaves WorldRuntime headless when no viewport is supplied', () => {
    const { world } = createSession(null, { environmentFactory });
    expect(world.rendering).toBeNull();
  });

  it('attaches a RenderingSystem to the Runtime scene when a viewport is supplied', () => {
    const viewport = { appendChild:vi.fn(), clientWidth:800, clientHeight:600 };
    const rendererFactory = vi.fn();
    const { world } = createSession(viewport, { environmentFactory, rendererFactory });

    expect(world.rendering).toBeInstanceOf(RenderingSystem);
    expect(world.rendering.scene).toBe(world.scene);
    expect(world.rendering.container).toBe(viewport);
    expect(world.rendering.rendererFactory).toBe(rendererFactory);
  });
});
