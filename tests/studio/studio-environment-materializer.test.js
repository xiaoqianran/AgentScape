import { describe, expect, it, vi } from 'vitest';
import { StudioEnvironmentMaterializer } from '../../apps/studio/ui/StudioEnvironmentMaterializer.js';

describe('StudioEnvironmentMaterializer', () => {
  it('gives inline editors the Environment lifetime instead of the interaction-overlay lifetime', async () => {
    const host = { remove:vi.fn() };
    const createEditors = vi.fn(() => host);
    const dispose = vi.fn();
    const factory = vi.fn(async(options) => ({ id:'woodland-workshop', options, dispose }));
    const definition = {
      id:'woodland-workshop',
      inlineEditors:[{id:'board',label:'Board'}],
      load:vi.fn(async() => factory)
    };
    const parent = {};
    const materializer = new StudioEnvironmentMaterializer({ parent, createEditors });

    const environment = await materializer.materialize(definition, { scene:'runtime-scene' });
    expect(createEditors).toHaveBeenCalledWith(parent, definition.inlineEditors);
    expect(factory).toHaveBeenCalledWith({scene:'runtime-scene',editorHost:host});
    expect(materializer.hostFor(environment)).toBe(host);
    expect(host.remove).not.toHaveBeenCalled();

    environment.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    expect(host.remove).toHaveBeenCalledOnce();
    expect(materializer.hostFor(environment)).toBeNull();

    environment.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    expect(host.remove).toHaveBeenCalledOnce();
  });

  it('removes a candidate editor host when materialization fails before a WorldSession replacement', async () => {
    const host = { remove:vi.fn() };
    const materializer = new StudioEnvironmentMaterializer({
      parent:{},
      createEditors:() => host
    });
    const definition = {
      id:'broken-world',
      cabin:true,
      load:async() => async() => { throw new Error('factory failed'); }
    };

    await expect(materializer.materialize(definition)).rejects.toThrow('factory failed');
    expect(host.remove).toHaveBeenCalledOnce();
  });

  it('does not create an editor host for worlds without inline authoring controls', async () => {
    const createEditors = vi.fn();
    const materializer = new StudioEnvironmentMaterializer({ parent:{}, createEditors });
    const definition = {
      id:'monument-hall',
      load:async() => async(options) => ({ id:'monument-hall', options })
    };

    const environment = await materializer.materialize(definition, { scene:'scene' });
    expect(createEditors).not.toHaveBeenCalled();
    expect(environment.options).toEqual({scene:'scene',editorHost:null});
    expect(materializer.hostFor(environment)).toBeNull();
  });
});
