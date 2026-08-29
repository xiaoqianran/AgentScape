import { readFile } from 'node:fs/promises';
import { WebIO } from '@gltf-transform/core';
import { expect, it, vi } from 'vitest';
import { AssetCompiler } from '../../asset/compiler/AssetCompiler.js';

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


it('upgrades a promoted materialized Part from browser AABB fallback to provider convex decomposition', async () => {
  const bytes=new Uint8Array(await readFile('public/assets/cabinet.glb'));
  const store={ put:vi.fn(async (_key,output)=>{ store.bytes=output; }) };
  const hull={shape:'convexHull',vertices:[-.8,-.9,-.04,.8,-.9,-.04,.8,.9,-.04,-.8,.9,.04]};
  const provider={
    endpoint:'https://provider.test',
    isConfigured:()=>true,
    run:vi.fn(async()=>({})),
    runPartGeometry:vi.fn(async(_bytes,parts)=>{
      expect(parts).toEqual([{id:'door',node:'Door__part_door',parent:'$root'}]);
      return {parts:{door:{
        collision:{strategy:'coacd-part',quality:'convex-decomposition',colliders:[hull]},
        physics:{friction:.5},
        geometry:{watertight:false,windingConsistent:true,components:1,volume:null,vertices:8,faces:12,extents:[1.6,1.9,.08]}
      }}};
    })
  };
  const result=await new AssetCompiler({store,provider,version:'test'}).compile({
    bytes,sourceName:'cabinet.glb',assetId:'provider_part_geometry',
    partSegmentation:{
      version:1,source:'external-segmenter',faceCount:12,
      segments:[{id:'door',faceCount:12,confidence:.9,semantic:'door'}],
      materialization:{sourceNode:'Door',primitives:[{primitive:0,faceLabels:Array(12).fill('door')}]}
    },
    partProposal:{version:1,source:'joint-provider',parts:[{
      id:'door',parent:'$root',actions:['open','close'],targets:{open:-1.2,close:0},
      joint:{type:'revolute',axis:[0,1,0],limits:[-1.2,0],parentAnchor:[-.82,1,.355],childAnchor:[-.81,0,0],motor:{stiffness:60,damping:10}}
    }]}
  });
  expect(provider.runPartGeometry).toHaveBeenCalledOnce();
  expect(result.manifest.parts.door.physics.colliders).toEqual([hull]);
  expect(result.manifest.parts.door.physics.collider).toMatchObject({strategy:'coacd-part',quality:'convex-decomposition',generated:false});
  expect(result.partGeometry.reports.door.collision).toEqual({strategy:'coacd-part',quality:'convex-decomposition',hulls:1});
  expect(result.partGeometry.reports.door).not.toHaveProperty('colliders');
  expect(result.quality.advisory.some((item)=>item.code==='PART_COLLIDER_COARSE')).toBe(false);
  expect(result.quality.advisory.some((item)=>item.code==='COLLIDER_COARSE')).toBe(true); // Root remains browser AABB.
});
