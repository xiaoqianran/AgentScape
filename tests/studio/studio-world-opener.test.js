import { describe, expect, it, vi } from 'vitest';
import { StudioWorldOpener } from '../../apps/studio/runtime/StudioWorldOpener.js';

const builtin = { id:'woodland-workshop', title:'林间工坊' };

function harness({ authoring = null } = {}) {
  const session = { open:vi.fn(async(source, options) => ({
    status:'world-ready',
    materialized:typeof source === 'function' ? await source() : null,
    reason:options?.reason || null
  })) };
  const materializeBuiltin = vi.fn(async(definition) => ({ id:definition.id }));
  const materializeGenerated = vi.fn(async(artifactId) => ({ id:'generated', artifactId }));
  const opener = new StudioWorldOpener({
    session,
    builtins:[builtin],
    materializeBuiltin,
    materializeGenerated,
    authoring
  });
  return { opener, session, materializeBuiltin, materializeGenerated };
}

describe('StudioWorldOpener', () => {
  it('routes current persisted state through WorldSession.open()', async () => {
    const h = harness();
    await h.opener.open({ kind:'persisted' });
    expect(h.session.open).toHaveBeenCalledWith(null, { reason:'studio-persisted-world' });
  });

  it('materializes built-in worlds inside the WorldSession transaction', async () => {
    const h = harness();
    const result = await h.opener.open({ kind:'builtin', id:'woodland-workshop' });
    expect(h.materializeBuiltin).toHaveBeenCalledWith(builtin);
    expect(h.session.open).toHaveBeenCalledWith(expect.any(Function), { reason:'studio-builtin-world' });
    expect(result.materialized).toEqual({ id:'woodland-workshop' });
  });

  it('materializes persisted generated artifacts inside the same WorldSession transaction', async () => {
    const h = harness();
    const result = await h.opener.open({ kind:'generated', artifactId:'manifest_01' });
    expect(h.materializeGenerated).toHaveBeenCalledWith('manifest_01');
    expect(h.session.open).toHaveBeenCalledWith(expect.any(Function), { reason:'studio-generated-world' });
    expect(result.materialized).toEqual({ id:'generated', artifactId:'manifest_01' });
  });

  it('keeps AuthoringDocument lifecycle separate while sharing the product open entry', async () => {
    const authoring = {
      openWorld:vi.fn(async(id) => ({ id, persisted:true })),
      newWorld:vi.fn(async(options) => ({ id:null, name:options.name || 'Untitled World' }))
    };
    const h = harness({ authoring });

    await expect(h.opener.open({kind:'authoring',id:'garden'})).resolves.toEqual({id:'garden',persisted:true});
    await expect(h.opener.open({kind:'authoring-new',options:{name:'Draft'}})).resolves.toEqual({id:null,name:'Draft'});
    expect(authoring.openWorld).toHaveBeenCalledWith('garden');
    expect(authoring.newWorld).toHaveBeenCalledWith({name:'Draft'});
    expect(h.session.open).not.toHaveBeenCalled();
  });

  it('rejects unknown built-in IDs instead of silently falling back', async () => {
    const h = harness();
    await expect(h.opener.open({kind:'builtin',id:'missing-world'})).rejects.toThrow('Built-in world not found');
    expect(h.session.open).not.toHaveBeenCalled();
  });
});
