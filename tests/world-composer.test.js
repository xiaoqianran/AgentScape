import { describe, expect, it, vi } from 'vitest';
import { composeNearPlacement, composeWorldLayout, manifestFootprint, preflightWorldPosition } from '../src/pipeline/WorldComposer.js';

const box=(id,h=[.5,.5,.5])=>({id,physics:{body:'fixed',colliders:[{shape:'box',halfExtents:h,translation:[0,h[1],0]}]}});

describe('WorldComposer',()=>{
  it('derives conservative root footprints from manifest colliders',()=>{
    expect(manifestFootprint(box('a',[1,.5,2]))).toMatchObject({checked:true,radius:Math.hypot(1,2),minY:0,coverage:'full-root'});
  });

  it('places missing positions deterministically without batch overlap',()=>{
    const manifests={a:box('a'),b:box('b'),c:box('c')};
    const run=()=>composeWorldLayout([
      {id:'a1',assetRef:{assetId:'a'}},{id:'b1',assetRef:{assetId:'b'}},{id:'c1',assetRef:{assetId:'c'}}
    ],{
      getManifest:(id)=>manifests[id],poseClear:()=>({checked:true,clear:true,blockedBy:[]}),
      layout:{bounds:{min:[-5,-5],max:[5,5]},groundY:0,margin:.5},clearance:.25
    });
    const first=run(),second=run();
    expect(first).toEqual(second);
    expect(first.status).toBe('ready');
    expect(first.placements).toHaveLength(3);
    expect(new Set(first.placements.map((p)=>p.position.join(','))).size).toBe(3);
    expect(first.placements.every((p)=>p.mode==='auto')).toBe(true);
  });

  it('skips Physics-blocked candidates and rejects an explicitly blocked pose',()=>{
    const manifest=box('a');
    const poseClear=vi.fn((_m,p)=>Math.abs(p[0])<.1 && Math.abs(p[2])<.1
      ? {checked:true,clear:false,blockedBy:['environment:monument']}
      : {checked:true,clear:true,blockedBy:[]});
    const auto=composeWorldLayout([{id:'a1',assetRef:{assetId:'a'}}],{
      getManifest:()=>manifest,poseClear,layout:{bounds:{min:[-3,-3],max:[3,3]},groundY:0,margin:.5}
    });
    expect(auto.status).toBe('ready');
    expect(auto.placements[0].position.slice(0,3)).not.toEqual([0,.01,0]);
    const explicit=composeWorldLayout([{id:'a1',assetRef:{assetId:'a'},position:[0,.01,0]}],{
      getManifest:()=>manifest,poseClear,layout:{bounds:{min:[-3,-3],max:[3,3]},groundY:0,margin:.5}
    });
    expect(explicit).toMatchObject({status:'rejected',reason:'WORLD_POSE_BLOCKED'});
  });

  it('marks articulated root-only layout coverage provisional',()=>{
    const manifest={...box('cabinet'),parts:{door:{physics:{colliders:[{shape:'box',halfExtents:[.2,.5,.05]}]}}}};
    const result=composeWorldLayout([{id:'c1',assetRef:{assetId:'cabinet'}}],{
      getManifest:()=>manifest,poseClear:()=>({checked:true,clear:true}),layout:{bounds:{min:[-3,-3],max:[3,3]},groundY:0,margin:.5}
    });
    expect(result).toMatchObject({status:'provisional',reason:'ARTICULATED_LAYOUT_ROOT_ONLY',issues:[{reason:'ARTICULATED_LAYOUT_ROOT_ONLY'}]});
  });

  it('derives NEAR spacing from both collider footprints and picks the first Physics-clear direction',()=>{
    const subject=box('cabinet',[.6,.8,.5]),target=box('table',[1,.5,.7]);
    const calls=[];
    const result=composeNearPlacement(subject,target,[0,0,0],{
      subjectY:.01,
      poseClear:(_manifest,position)=>{calls.push(position);return position[0]>0?{checked:true,clear:false,blockedBy:['environment:pillar']}:{checked:true,clear:true,blockedBy:[]};}
    });
    const minimum=Math.hypot(.6,.5)+Math.hypot(1,.7)+.35;
    expect(result).toMatchObject({checked:true,mode:'runtime-derived',distance:Number(minimum.toFixed(4)),coverage:'full-root'});
    expect(result.position[0]).toBeLessThan(0);
    expect(calls).toHaveLength(2);
  });

  it('rejects an explicit NEAR distance that is smaller than collider-safe spacing',()=>{
    const result=composeNearPlacement(box('a',[1,.5,1]),box('b',[1,.5,1]),[0,0,0],{subjectY:0,distance:1,poseClear:()=>({checked:true,clear:true})});
    expect(result).toMatchObject({checked:false,reason:'NEAR_DISTANCE_TOO_SMALL',requestedDistance:1});
  });

});


it('preflights an existing object pose against bounds, occupied footprints, and Physics while allowing self exclusion',()=>{
  const moving=box('moving'),other=box('other');
  const poseClear=vi.fn(()=>({checked:true,clear:true,blockedBy:[]}));
  const layout={bounds:{min:[-4,-4],max:[4,4]},groundY:0,margin:.5};
  expect(preflightWorldPosition(moving,[2,.01,0],{
    layout,occupied:[{id:'other_01',manifest:other,position:[0,.01,0]}],poseClear,clearance:.25
  })).toMatchObject({checked:true,clear:true,status:'ready',coverage:'full-root'});
  expect(preflightWorldPosition(moving,[.5,.01,0],{
    layout,occupied:[{id:'other_01',manifest:other,position:[0,.01,0]}],poseClear,clearance:.25
  })).toMatchObject({checked:true,clear:false,status:'rejected',reason:'BATCH_FOOTPRINT_OVERLAP'});
  expect(preflightWorldPosition(moving,[3.8,.01,0],{layout,occupied:[],poseClear})).toMatchObject({checked:true,clear:false,reason:'OUTSIDE_LAYOUT_BOUNDS'});
});
