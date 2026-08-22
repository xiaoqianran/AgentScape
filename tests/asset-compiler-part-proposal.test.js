import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { getBounds, WebIO } from '@gltf-transform/core';
import { AssetCompiler } from '../src/compiler/AssetCompiler.js';
import { validateAssetManifest } from '../src/assets/schema.js';

class MemoryStore {
  constructor(){ this.map=new Map(); }
  async put(key,bytes,metadata){ this.map.set(key,{bytes,metadata}); return key; }
}

const joint={type:'revolute',axis:[0,1,0],limits:[-1.2,0],parentAnchor:[0,0,0],childAnchor:[0,0,0],motor:{stiffness:60,damping:10}};
const physics={body:'dynamic',mass:1,colliders:[{shape:'box',halfExtents:[.3,.6,.03]}]};

async function compile(partProposal){
  const bytes=new Uint8Array(await readFile('public/assets/cabinet.glb'));
  return new AssetCompiler({store:new MemoryStore(),version:'test'}).compile({bytes,sourceName:'cabinet.glb',assetId:'cabinet_proposal',partProposal});
}

describe('AssetCompiler Part Proposal E2E', () => {
  it('promotes an executable proposal against real GLB node names', async () => {
    const result=await compile({version:1,source:'test',parts:[{
      id:'door',node:'doorHinge',semantic:'door',actions:['open','close'],targets:{open:-1.2,close:0},physics,joint
    }]});
    expect(result.partProposal.promoted).toEqual(['door']);
    expect(result.manifest.parts.door.node).toBe('doorHinge');
    expect(result.manifest.actions).toEqual(expect.arrayContaining(['move','open','close']));
    expect(result.quality.status).toBe('provisional');
    expect(result.quality.advisory.some((item)=>item.code==='ARTICULATION_UNVERIFIED')).toBe(true);
    expect(() => validateAssetManifest(result.manifest)).not.toThrow();
  });

  it('keeps a kinematics-only URDF-style proposal report-only', async () => {
    const result=await compile({version:1,source:'urdf/yourdfpy',parts:[{
      id:'door',node:'doorHinge',parent:'$root',joint:{
        type:'revolute',axis:[0,1,0],limits:[-1.2,0],urdf:{name:'door_hinge',parentLink:'body',childLink:'doorHinge',originMatrix:[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]}
      }
    }]});
    expect(result.partProposal.promoted).toEqual([]);
    expect(result.partProposal.unpromoted).toEqual([{part:'door',reason:'missing-anchor'}]);
    expect(result.manifest.parts).toBeUndefined();
    expect(result.manifest.actions).toEqual(['move']);
    expect(result.quality.advisory.some((item)=>item.code==='PART_PROPOSAL_PARTIAL')).toBe(true);
  });

  it('compiles URDF link-local frame evidence into anchors when the real GLB zero pose matches', async () => {
    const result=await compile({
      version:1,source:'urdf/yourdfpy',frameConvention:'urdf-link-local',parts:[{
        id:'door',node:'doorHinge',parent:'$root',semantic:'door',actions:['open','close'],targets:{open:-1.2,close:0},physics,
        joint:{type:'revolute',axis:[0,1,0],limits:[-1.2,0],motor:{stiffness:60,damping:10},urdf:{parentToJointMatrix:[[1,0,0,-.82],[0,1,0,1],[0,0,1,.39],[0,0,0,1]]}}
      }]
    });
    expect(result.partProposal.jointFrame.issues).toEqual([]);
    expect(result.partProposal.promoted).toEqual(['door']);
    expect(result.manifest.parts.door.joint.parentAnchor.map((v)=>Number(v.toFixed(6)))).toEqual([-.82,1,.355]);
    expect(result.manifest.parts.door.joint.childAnchor).toEqual([0,0,0]);
    expect(result.quality.advisory.some((item)=>item.code==='ARTICULATION_UNVERIFIED')).toBe(true);
  });


  it('preserves face-level segmentation as evidence without turning segments into runtime parts', async () => {
    const bytes=new Uint8Array(await readFile('public/assets/cabinet.glb'));
    const result=await new AssetCompiler({store:new MemoryStore(),version:'test'}).compile({
      bytes,sourceName:'cabinet.glb',assetId:'cabinet_segments',
      partSegmentation:{version:1,source:'p3sam/external',faceCount:100,segments:[{id:0,faceCount:60,semantic:'door'},{id:1,faceCount:40,semantic:'body'}]}
    });
    expect(result.partSegmentation.coverage).toBe(1);
    expect(result.manifest.compiler.partSegmentation.segments).toHaveLength(2);
    expect(result.manifest.parts).toBeUndefined();
    expect(result.quality.status).toBe('provisional');
    expect(result.quality.advisory.some((item)=>item.code==='PART_SEGMENTATION_UNMATERIALIZED')).toBe(true);
  });


  it('materializes real cabinet face labels into stable GLB child nodes without inventing runtime actions', async () => {
    const bytes=new Uint8Array(await readFile('public/assets/cabinet.glb'));
    const store=new MemoryStore();
    const compiler=new AssetCompiler({store,version:'test'});
    const result=await compiler.compile({
      bytes,sourceName:'cabinet.glb',assetId:'cabinet_materialized',
      partSegmentation:{
        version:1,source:'test-face-labels',faceCount:12,
        segments:[{id:'segment_a',faceCount:6},{id:'segment_b',faceCount:6}],
        materialization:{sourceNode:'Door',primitives:[{primitive:0,faceLabels:[...Array(6).fill('segment_a'),...Array(6).fill('segment_b')]}]}
      }
    });
    expect(result.partSegmentation.materialization.status).toBe('materialized');
    expect(result.partProposal.promoted).toEqual([]);
    expect(result.manifest.parts).toBeUndefined();
    expect(result.manifest.actions).toEqual(['move']);
    expect(result.quality.advisory.some((item)=>item.code==='PART_SEGMENTATION_UNMATERIALIZED')).toBe(false);
    expect(result.quality.advisory.some((item)=>item.code==='PART_PROPOSAL_PARTIAL')).toBe(true);
    expect(result.resources.metrics.drawCalls).toBe(3);

    const stored=store.map.get(result.manifest.source.key);
    const output=await new WebIO().readBinary(stored.bytes);
    const names=output.getRoot().listNodes().map((node)=>node.getName());
    expect(names).toEqual(expect.arrayContaining(['Door','Door__part_segment_a','Door__part_segment_b']));
    const scene=output.getRoot().getDefaultScene();
    const bounds=getBounds(scene);
    expect(bounds.min.map((v)=>Number(v.toFixed(6)))).toEqual(result.geometry.bounds.min.map((v)=>Number(v.toFixed(6))));
    expect(bounds.max.map((v)=>Number(v.toFixed(6)))).toEqual(result.geometry.bounds.max.map((v)=>Number(v.toFixed(6))));
    const door=output.getRoot().listNodes().find((node)=>node.getName()==='Door');
    expect(door.getMesh()).toBeNull();
    expect(door.listChildren().map((node)=>node.getName()).sort()).toEqual(['Door__part_segment_a','Door__part_segment_b']);
    const totalIndices=door.listChildren().reduce((sum,node)=>sum+node.getMesh().listPrimitives().reduce((n,p)=>n+(p.getIndices()?.getCount()||0),0),0);
    expect(totalIndices).toBe(36);
  });

});
