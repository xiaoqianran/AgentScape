import { describe, expect, it, vi } from 'vitest';
import { createSession } from '../../application/createSession.js';
import { RenderingSystem } from '../../modules/world/runtime/systems/RenderingSystem.js';

const environmentFactory = vi.fn(async () => null);

describe('createSession rendering composition', () => {
  it('leaves WorldRuntime headless when no viewport is supplied', () => {
    const { world, authoring } = createSession(null, { environmentFactory });
    expect(world.rendering).toBeNull();
    expect(authoring).toBeNull();
  });

  it('attaches a RenderingSystem to the Runtime scene when a viewport is supplied', () => {
    const viewport = { appendChild:vi.fn(), clientWidth:800, clientHeight:600 };
    const rendererFactory = vi.fn();
    const { world, authoring } = createSession(viewport, { environmentFactory, rendererFactory });

    expect(world.rendering).toBeInstanceOf(RenderingSystem);
    expect(world.rendering.scene).toBe(world.scene);
    expect(world.rendering.container).toBe(viewport);
    expect(world.rendering.rendererFactory).toBe(rendererFactory);
    expect(authoring.scene.name).toBe('$llm-world');
    expect(authoring.scene.parent).toBe(world.rendering.decorationRoot);
  });

  it('composes articulation verification through AssetModule instead of WorldRuntime', async () => {
    const articulationVerifier = { verify:vi.fn(async (assetId) => ({ ok:true, assetId })) };
    const { world } = createSession(null, { environmentFactory, articulationVerifier });

    await expect(world.assetModule.verifyArticulation('cabinet')).resolves.toEqual({ ok:true, assetId:'cabinet' });
    expect(articulationVerifier.verify).toHaveBeenCalledWith('cabinet');
    expect(world.articulationVerifier).toBeUndefined();
  });
});
