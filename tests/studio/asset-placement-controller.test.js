import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AssetPlacementController, placementBounds } from '../../apps/studio/editor/AssetPlacementController.js';
import { assetManifests } from '../../modules/asset/registry/manifests/index.js';

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
  const physics={checkManifestPose:vi.fn(()=>pose)};
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

const groundSurface = () => ({ point:new THREE.Vector3(1, 0, 2), normal:new THREE.Vector3(0, 1, 0), object:null });

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
    expect(physics.checkManifestPose).toHaveBeenCalledWith(expect.objectContaining({id:'chair'}),[2,1.02,3]);
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

  it('follows the real cursor with a ghost while armed for ground placement',()=>{
    const {controller,physics}=harness();
    controller.surfacePoint=groundSurface;
    expect(controller.armGroundPlacement('chair')).toBe(true);
    expect(controller.armMode).toBe('asset');
    expect(controller.preview.group.visible).toBe(false);

    controller.onArmMove({clientX:10,clientY:20,pointerId:1});
    expect(controller.preview.group.visible).toBe(true);
    expect(controller.preview.group.position.toArray()).toEqual([1,0.02,2]);
    expect(physics.checkManifestPose).toHaveBeenCalledWith(expect.objectContaining({id:'chair'}),[1,0.02,2]);
    controller.dispose();
  });

  it('pins a ground anchor first and reuses it when the generated asset is placed',async()=>{
    const {controller,tools,physics,log}=harness();
    controller.surfacePoint=groundSurface;
    expect(controller.armGenerationAnchor()).toBe(true);
    expect(controller.armMode).toBe('anchor');
    expect(controller.anchorMarker.group.visible).toBe(false);

    controller.onArmMove({clientX:10,clientY:20,pointerId:1});
    expect(controller.anchorMarker.group.visible).toBe(true);
    expect(controller.anchorMarker.group.position.toArray()).toEqual([1,0.02,2]);

    controller.onArmDown({button:0,clientX:10,clientY:20,pointerId:1});
    controller.onArmUp({clientX:10,clientY:20,pointerId:1});
    expect(controller.armMode).toBe(null);
    expect(controller.anchor.position).toEqual([1,0.02,2]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('生成落点已固定'),'result');

    const result=await controller.placeAtAnchor('chair');
    expect(result).toMatchObject({status:'placement-committed',assetId:'chair'});
    expect(physics.checkManifestPose).toHaveBeenCalledWith(expect.objectContaining({id:'chair'}),[1,0.02,2]);
    expect(tools.call).toHaveBeenCalledWith('spawnAsset',{assetId:'chair',position:[1,0.02,2]});

    expect(controller.clearAnchor()).toBe(true);
    expect(controller.anchor).toBe(null);
    controller.dispose();
  });

  it('stays armed after a blocked ground click so another spot can be chosen',async()=>{
    const {controller,tools,log}=harness({pose:{checked:true,clear:false,blockedBy:['environment:$environment']}});
    controller.surfacePoint=groundSurface;
    controller.armGroundPlacement('chair');
    controller.onArmDown({button:0,clientX:10,clientY:20,pointerId:1});
    controller.onArmUp({clientX:10,clientY:20,pointerId:1});
    await Promise.resolve();
    expect(tools.call).not.toHaveBeenCalled();
    expect(controller.armMode).toBe('asset');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('无法放置 chair'),'error');
    controller.dispose();
  });

  it('cancels an armed placement with Escape and clears the ghost resources',()=>{
    const {controller,element}=harness();
    controller.surfacePoint=groundSurface;
    controller.armGenerationAnchor();
    controller.onArmKeyDown({key:'Escape'});
    expect(controller.armMode).toBe(null);
    expect(controller.anchor).toBe(null);
    expect(element.classList.contains('asset-placement-armed')).toBe(false);
    controller.dispose();
  });
});
