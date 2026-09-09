import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { physicsManifestForUniformScale, uniformScaleValue } from '../../world/runtime/ObjectTransform.js';
import { WorldRuntime } from '../../world/runtime/WorldRuntime.js';
import { assetManifests } from '../../asset/manifests/index.js';
import { ObjectStore } from '../../world/runtime/ObjectStore.js';
import { createRapierPhysicsSystem } from '../helpers/createRapierPhysicsSystem.js';
import { createAssetModule } from '../../asset/AssetModule.js';
import { CommandHistory } from '../../world/runtime/CommandHistory.js';
import { SkillRegistry } from '../../agent/skills/SkillRegistry.js';
import { registerCoreSkills } from '../../agent/skills/registerCoreSkills.js';
import { AgentTools } from '../../agent/AgentTools.js';

describe('Object transform contract',()=>{
  it('scales collider geometry and mass without mutating the source manifest',()=>{
    const source=structuredClone(assetManifests.cup);
    const scaled=physicsManifestForUniformScale(source,2);
    expect(scaled.physics.colliders[0]).toMatchObject({halfHeight:.32,radius:.3,translation:[0,.32,0]});
    expect(scaled.physics.mass).toBeCloseTo(2.4,8);
    expect(source.physics.colliders[0]).toMatchObject({halfHeight:.16,radius:.15,translation:[0,.16,0]});
    expect(source.physics.mass).toBe(.3);
  });

  it('rejects non-uniform and articulated scale instead of creating false physics truth',()=>{
    expect(()=>uniformScaleValue([1,2,1])).toThrowError(expect.objectContaining({code:'OBJECT_SCALE_NON_UNIFORM_UNSUPPORTED'}));
    expect(()=>physicsManifestForUniformScale(assetManifests.cabinet,.8)).toThrowError(expect.objectContaining({code:'OBJECT_SCALE_ARTICULATED_UNSUPPORTED'}));
  });

  it('rebuilds Physics when uniform scale changes and keeps the Asset manifest unchanged',()=>{
    const object=new THREE.Group();
    const manifest=structuredClone(assetManifests.cup);
    const store=new ObjectStore();
    store.add('cup_01',{id:'cup_01',assetId:'cup',object,manifest,state:{},physicsScale:1});
    const physics={remove:vi.fn(),attach:vi.fn(),syncTransform:vi.fn()};
    const runtime={
      store,physics,
      navigation:{invalidateIfStatic:vi.fn()},
      events:{emit:vi.fn()}
    };
    const result=WorldRuntime.prototype.applyObjectTransform.call(runtime,'cup_01',{scale:.5},{source:'test'});
    expect(result).toMatchObject({status:'object-transformed',id:'cup_01',scale:.5,physicsRebuilt:true});
    expect(object.scale.toArray()).toEqual([.5,.5,.5]);
    expect(physics.remove).toHaveBeenCalledWith('cup_01');
    expect(physics.attach).toHaveBeenCalledWith('cup_01',expect.objectContaining({physics:expect.objectContaining({mass:.0375})}),object);
    expect(physics.attach.mock.calls[0][1].physics.colliders[0]).toMatchObject({halfHeight:.08,radius:.075,translation:[0,.08,0]});
    expect(manifest.physics.colliders[0]).toMatchObject({halfHeight:.16,radius:.15,translation:[0,.16,0]});
    expect(store.get('cup_01').physicsScale).toBe(.5);
  });

  it('uses pose sync without collider rebuild for move/rotate-only edits',()=>{
    const object=new THREE.Group();
    const manifest=structuredClone(assetManifests.chair);
    const store=new ObjectStore();
    store.add('chair_01',{id:'chair_01',assetId:'chair',object,manifest,state:{},physicsScale:1});
    const physics={remove:vi.fn(),attach:vi.fn(),syncTransform:vi.fn()};
    const runtime={store,physics,navigation:{invalidateIfStatic:vi.fn()},events:{emit:vi.fn()}};
    const result=WorldRuntime.prototype.applyObjectTransform.call(runtime,'chair_01',{position:[2,0,3],rotationDegrees:[0,90,0]},{source:'agent'});
    expect(result.physicsRebuilt).toBe(false);
    expect(object.position.toArray()).toEqual([2,0,3]);
    expect(physics.syncTransform).toHaveBeenCalledWith('chair_01',object);
    expect(physics.remove).not.toHaveBeenCalled();
  });

  it('rebuilds a real Rapier collider at the same uniform scale as the visual instance',async()=>{
    const physics=createRapierPhysicsSystem();
    await physics.init();
    const object=new THREE.Group();
    const manifest=structuredClone(assetManifests.cup);
    const store=new ObjectStore();
    store.add('cup_01',{id:'cup_01',assetId:'cup',object,manifest,state:{},physicsScale:1});
    physics.attach('cup_01',manifest,object);
    const runtime={store,physics,navigation:{invalidateIfStatic:()=>{}},events:{emit:()=>{}}};

    WorldRuntime.prototype.applyObjectTransform.call(runtime,'cup_01',{scale:.5},{source:'test'});

    const entry=physics.entries.get('cup_01');
    const snapshot=physics.backend.colliderSnapshot(entry.body.collider(0));
    expect(object.scale.toArray()).toEqual([.5,.5,.5]);
    expect(snapshot.shape).toMatchObject({kind:'cylinder',halfHeight:.08,radius:.075});
    physics.dispose();
  });

  it('records Human/Agent transform skills in the same History and restores scaled Physics state on undo/redo',async()=>{
    const physics={
      attach:vi.fn(),remove:vi.fn(),syncTransform:vi.fn(),resetWorld:vi.fn(),addEnvironment:vi.fn()
    };
    const runtime=new WorldRuntime({appendChild(){}},{
      environmentFactory:()=>null,
      assetModule:createAssetModule({manifestStore:null,libraryStore:null}),
      physicsFactory:()=>physics
    });
    runtime.scene=new THREE.Scene();
    runtime.environment={id:'test-world',colliders:[]};
    runtime.rendering={cameraState:()=>null,applyCameraState:vi.fn()};
    runtime.navigation={invalidateIfStatic:vi.fn()};
    runtime.locomotion={cancel:vi.fn(),cancelAll:vi.fn()};
    runtime.interactions={cancelPending:vi.fn(),beforeRemove:vi.fn(),rebuildHeldOwnership:vi.fn()};
    runtime.sceneGraph={
      batch:async(operation)=>operation(),changed:vi.fn(),update:vi.fn(),list:vi.fn(()=>[]),removeObject:vi.fn()
    };
    runtime.history=new CommandHistory({apply:(scene)=>runtime.restore(scene),events:runtime.events});
    runtime.skills=registerCoreSkills(new SkillRegistry({policy:runtime.policy,trace:runtime.trace,runtime}),runtime);
    const tools=new AgentTools(runtime,{actor:'human'});
    await runtime.spawn('cup',{id:'cup_01',position:[0,1,0]});

    await tools.call('scaleObject',{id:'cup_01',scale:.5});
    expect(runtime.store.get('cup_01').object.scale.toArray()).toEqual([.5,.5,.5]);
    expect(runtime.history.status()).toMatchObject({canUndo:true,undo:1});

    await runtime.history.undo();
    expect(runtime.store.get('cup_01').object.scale.toArray()).toEqual([1,1,1]);
    expect(runtime.store.get('cup_01').physicsScale).toBe(1);
    expect(runtime.history.status()).toMatchObject({canRedo:true,redo:1});

    await runtime.history.redo();
    expect(runtime.store.get('cup_01').object.scale.toArray()).toEqual([.5,.5,.5]);
    expect(runtime.store.get('cup_01').physicsScale).toBe(.5);
  });
});
