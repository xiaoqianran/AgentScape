import { describe, expect, it, vi } from 'vitest';
import { AssetCompiler } from '../src/compiler/AssetCompiler.js';
import { RESOURCE_BUDGET } from '../src/compiler/resourceBudget.js';

const compiler = () => new AssetCompiler({ store:{ put:vi.fn() } });

describe('AssetCompiler URL input budget', () => {
  it('rejects declared oversized GLB before reading the body', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({ ok:true, headers:new Headers({ 'content-length': String(RESOURCE_BUDGET.maxInputBytes + 1) }), body:null }));
    try { await expect(compiler().fetchBytes('https://x/model.glb')).rejects.toMatchObject({ code:'ASSET_INPUT_TOO_LARGE' }); }
    finally { globalThis.fetch = original; }
  });

  it('streams unknown-length responses and rejects once the limit is crossed', async () => {
    const original = globalThis.fetch;
    const chunk = new Uint8Array(Math.ceil(RESOURCE_BUDGET.maxInputBytes / 2) + 1);
    let reads = 0;
    const reader = { read:vi.fn(async () => reads++ < 2 ? { done:false, value:chunk } : { done:true }), cancel:vi.fn(async()=>{}) };
    globalThis.fetch = vi.fn(async () => ({ ok:true, headers:new Headers(), body:{ getReader:()=>reader } }));
    try {
      await expect(compiler().fetchBytes('https://x/model.glb')).rejects.toMatchObject({ code:'ASSET_INPUT_TOO_LARGE' });
      expect(reader.cancel).toHaveBeenCalledOnce();
    } finally { globalThis.fetch = original; }
  });
});
