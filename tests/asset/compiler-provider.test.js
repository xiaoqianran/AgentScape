import { expect, it, vi } from 'vitest';
import { HttpCompilerProvider } from '../../asset/compiler/providers/HttpCompilerProvider.js';

it('uses a stage-based provider contract for heavy compiler passes', async () => {
  const fetchImpl = vi.fn(async () => ({ ok:true, json:async () => ({ physics:{mass:2} }) }));
  const provider = new HttpCompilerProvider({ endpoint:'https://compiler.test', fetchImpl });
  const result = await provider.run('enrich', { geometry:{} });
  expect(result.physics.mass).toBe(2);
  const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
  expect(body.stage).toBe('enrich');
});


it('uploads materialized GLB bytes with part metadata using multipart form data', async () => {
  const fetchImpl=vi.fn(async (_url,options)=>({ok:true,json:async()=>({parts:{}})}));
  const provider=new HttpCompilerProvider({endpoint:'https://compiler.test/compile',fetchImpl});
  await provider.runPartGeometry(new Uint8Array([1,2,3]),[{id:'door',node:'Door'}]);
  const options=fetchImpl.mock.calls[0][1];
  expect(options.body).toBeInstanceOf(FormData);
  expect(options.headers).toBeUndefined();
  expect(options.body.get('stage')).toBe('part-geometry');
  expect(JSON.parse(options.body.get('metadata'))).toEqual({parts:[{id:'door',node:'Door'}]});
  expect(options.body.get('asset')).toBeInstanceOf(Blob);
});


it('uploads verified URDF bytes through the existing multipart compiler endpoint', async () => {
  const fetchImpl=vi.fn(async (_url,options)=>({
    ok:true,
    json:async()=>({partProposal:{version:1,source:'urdf/yourdfpy',frameConvention:'urdf-link-local',confidence:1,parts:[]}})
  }));
  const provider=new HttpCompilerProvider({endpoint:'https://compiler.test/compile',fetchImpl});
  const result=await provider.runUrdfProposal(new TextEncoder().encode('<robot name="x"></robot>'));
  expect(result.partProposal.frameConvention).toBe('urdf-link-local');
  const options=fetchImpl.mock.calls[0][1];
  expect(options.body).toBeInstanceOf(FormData);
  expect(options.headers).toBeUndefined();
  expect(options.body.get('stage')).toBe('urdf-proposal');
  const asset=options.body.get('asset');
  expect(asset).toBeInstanceOf(Blob);
  expect(asset.type).toBe('application/xml');
  expect(asset.size).toBeGreaterThan(0);
});

it('rejects empty URDF uploads before HTTP transport', async () => {
  const fetchImpl=vi.fn();
  const provider=new HttpCompilerProvider({endpoint:'https://compiler.test/compile',fetchImpl});
  await expect(provider.runUrdfProposal(new Uint8Array())).rejects.toThrow(/non-empty bytes/);
  expect(fetchImpl).not.toHaveBeenCalled();
});
