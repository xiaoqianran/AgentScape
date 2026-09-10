import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AssetPlacementController, placementBounds } from '../../apps/studio/editor/AssetPlacementController.js';
import { assetManifests } from '../../modules/asset/manifests/index.js';

function fakeElement() {
  const classes=new Set();
  return {
    addEventListener:vi.fn(),
    removeEventListener:vi.fn(),
    contains:()=>false,
    getBoundingClientRect:()=>({left:0,top:0,width:200,height:100}),
    classList:{add:(value)=>classes.add(value),remove:(value)=>classes.delete(value),contains:(value)=>classes.has(value)}
  };
}

function harness({pose={checked:true,clear:true,blockedBy:[]}}={}) {
  const element=fakeElement();
  const scene=new THREE.Scene();
  const events={emit:vi.fn()};
  const physics={manifestPoseClear:vi.fn(()=>pose)};
  const world={
    rendering:{viewport:()=>({camera:new THREE.PerspectiveCamera(45,2,0.1,100),element})},
    assets:{getManifest:vi.fn((id)=>structuredClone(assetManifests[id]))},
    assetCatalog:{has:vi.fn((id)=>Boolean(assetManifests[id]))},
    physics,
    scene,
    events,
    environment:{root:new THREE.Group()},
    store:{list:()=>[]}
  };
  const tools={call:vi.fn(async()=> 'chair_instance')};
  const editor={select:vi.fn()};
  const log=vi.fn();
  const controller=new AssetPlacementController({world,tools,editor,log});
  return {controller,world,tools,editor,log,element,physics};
}

describe('AssetPlacementController',()=>{
  it('derives a stable preview volume from manifest colliders',()=>{
    const bounds=placementBounds(assetManifests.cup);
    expect(bounds.min).toEqual([-0.15,0,-0.15]);
    expect(bounds.max).toEqual([0.15,0.32,0.15]);
    expect(bounds.size).toEqual([0.3,0.32,0.3]);
  });

  it('places the normalized Asset root on the hit support surface instead of collider minimum',()=>{
    const {controller,physics}=harness();
    controller.beginDrag('chair');
    controller.surfacePoint=()=>({point:new THREE.Vector3(2,1,3),normal:new THREE.Vector3(0,1,0),object:null});
    const candidate=controller.updateCandidate(100,50);
    expect(candidate.position).toEqual([2,1.02,3]);
    expect(physics.manifestPoseClear).toHaveBeenCalledWith(expect.objectContaining({id:'chair'}),[2,1.02,3]);
    controller.dispose();
  });

  it('commits valid placement through spawnAsset and selects the resulting instance',async()=>{
    const {controller,tools,editor}=harness();
    controller.beginDrag('chair');
    controller.position=[1,0.02,2];
    controller.pose={checked:true,clear:true,valid:true,blockedBy:[]};
    const result=await controller.commit();
    expect(result).toMatchObject({status:'placement-committed',assetId:'chair',id:'chair_instance'});
    expect(tools.call).toHaveBeenCalledWith('spawnAsset',{assetId:'chair',position:[1,0.02,2]});
    expect(editor.select).toHaveBeenCalledWith('chair_instance');
    controller.dispose();
  });

  it('fails closed on a physics-blocked candidate without mutating the world',async()=>{
    const {controller,tools,log}=harness();
    controller.beginDrag('chair');
    controller.position=[1,0.02,2];
    controller.pose={checked:true,clear:false,valid:false,blockedBy:['object:table:root']};
    const result=await controller.commit();
    expect(result).toMatchObject({status:'placement-blocked',assetId:'chair'});
    expect(tools.call).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('无法放置 chair'),'error');
    controller.dispose();
  });
});
