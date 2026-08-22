import { readFile } from 'node:fs/promises';
import { WebIO } from '@gltf-transform/core';
import { expect, it, vi } from 'vitest';
import { AssetCompiler } from '../src/compiler/AssetCompiler.js';

it('materializes face segmentation returned by an external compiler provider', async () => {
  const bytes=new Uint8Array(await readFile('public/assets/cabinet.glb'));
  const store={ put:vi.fn(async (_key,output)=>{ store.bytes=output; }) };
  const provider={
    endpoint:'https://provider.test',
    isConfigured:()=>true,
    run:vi.fn(async()=>({
      partSegmentation:{
        version:1,source:'external-segmenter',faceCount:12,
        segments:[{id:'a',faceCount:6,confidence:.8},{id:'b',faceCount:6,confidence:.7}],
        materialization:{sourceNode:'Door',primitives:[{primitive:0,faceLabels:[...Array(6).fill('a'),...Array(6).fill('b')]}]}
      }
    }))
  };
  const result=await new AssetCompiler({store,provider,version:'test'}).compile({bytes,sourceName:'cabinet.glb',assetId:'provider_segments'});
  expect(provider.run).toHaveBeenCalledOnce();
  expect(result.partSegmentation.materialization.status).toBe('materialized');
  expect(result.partProposal.parts.map((part)=>part.node).sort()).toEqual(['Door__part_a','Door__part_b']);
  expect(result.partProposal.confidence).toBe(.7);
  const output=await new WebIO().readBinary(store.bytes);
  expect(output.getRoot().listNodes().map((node)=>node.getName())).toEqual(expect.arrayContaining(['Door__part_a','Door__part_b']));
});
