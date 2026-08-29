import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ObjectStore } from '../world/runtime/ObjectStore.js';
import { createRecastNavigationSystem } from './helpers/createRecastNavigationSystem.js';

const floor=()=>{
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(10,.2,8));
  mesh.position.y=-.1; mesh.updateMatrixWorld(true); return mesh;
};

const doorObstacle=()=>({
  id:'cabinet:door:0',objectId:'cabinet',part:'door',collider:0,
  shape:'box',sourceShape:'box',quality:'exact-yaw',
  position:[0,1,0],halfExtents:[.25,1,4],angle:0
});

const manifest=(sourceKind='builtin',verified=false)=>({
  id:'cabinet',type:'cabinet',source:{kind:sourceKind},actions:['open','close'],physics:{body:'fixed'},
  parts:{door:{node:'Door',actions:['open','close'],targets:{open:-1.2,close:0},physics:{body:'dynamic',colliders:[{shape:'box',halfExtents:[.25,1,4]}]},joint:{type:'revolute',axis:[0,1,0],limits:[-1.2,0]}}},
  ...(verified?{verification:{articulation:{ok:true,parts:[{part:'door',ok:true,actions:[{action:'open',ok:true},{action:'close',ok:true}]}]}}}:{})
});

const setup=(recordManifest,state={parts:{door:'close'}})=>{
  const store=new ObjectStore();
  store.add('cabinet',{id:'cabinet',assetId:'cabinet',object:new THREE.Group(),manifest:recordManifest,state});
  const physics={navigationObstacles:()=>({items:[doorObstacle()],skipped:[]})};
  const navigation=createRecastNavigationSystem({store,physics,environmentRoots:[floor()]});
  return {store,navigation};
};

describe('action-aware navigation diagnosis',()=>{
  it('finds a builtin executable door as a provisional single-action unlock while restoring current TileCache truth',async()=>{
    const {navigation}=setup(manifest());
    const result=await navigation.suggestActions([-4,0,0],[4,0,0]);
    expect(result.status).toBe('action-candidate');
    expect(result.current).toMatchObject({reachable:false,reason:'PARTIAL_PATH',scope:'current'});
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      objectId:'cabinet',partName:'door',action:'open',alreadyRequested:false,
      eligibility:{eligible:true,status:'declared-executable'},
      counterfactual:{provisional:true,assumption:'obstacle-suppressed',reachable:true}
    });
    expect(result.recommendation).toEqual({
      call:{name:'open',args:{id:'cabinet',partName:'door'}},
      then:{name:'findPath',args:{start:[-4,0,0],end:[4,0,0]},condition:'after-world-state-changes'},
      provisional:true
    });

    // Counterfactual diagnosis must not leak into current-world truth.
    const currentAgain=await navigation.findPath([-4,0,0],[4,0,0]);
    expect(currentAgain).toMatchObject({reachable:false,reason:'PARTIAL_PATH',scope:'current'});
    expect(navigation.status().dynamicObstacles.tracked).toBe(1);
    navigation.dispose();
  },15000);

  it('identifies an unverified compiled blocker but refuses to recommend its articulation action',async()=>{
    const {navigation}=setup(manifest('compiled',false));
    const result=await navigation.suggestActions([-4,0,0],[4,0,0]);
    expect(result.status).toBe('blocked');
    expect(result.recommendation).toBeNull();
    expect(result.candidates[0]).toMatchObject({
      eligibility:{eligible:false,status:'unverified',reason:'ARTICULATION_UNVERIFIED'},
      counterfactual:{reachable:true,provisional:true}
    });
    navigation.dispose();
  },15000);

  it('allows a compiled articulation only after persisted runtime verification succeeds',async()=>{
    const {navigation}=setup(manifest('compiled',true));
    const result=await navigation.suggestActions([-4,0,0],[4,0,0]);
    expect(result.status).toBe('action-candidate');
    expect(result.candidates[0].eligibility).toEqual({eligible:true,status:'runtime-verified',evidence:'verification.articulation'});
    navigation.dispose();
  },15000);

  it('does not reissue open while the current Rapier obstacle is still moving after an open request',async()=>{
    const {navigation}=setup(manifest(),{parts:{door:'open'}});
    const result=await navigation.suggestActions([-4,0,0],[4,0,0]);
    expect(result.status).toBe('waiting-for-world-update');
    expect(result.recommendation).toBeNull();
    expect(result.candidates[0]).toMatchObject({alreadyRequested:true,counterfactual:{reachable:true}});
    navigation.dispose();
  },15000);

  it('heals current-world obstacles from Rapier after a transient counterfactual restore failure',async()=>{
    const {navigation}=setup(manifest());
    expect((await navigation.findPath([-4,0,0],[4,0,0])).reachable).toBe(false);
    const original=navigation.backend.queueObstacle.bind(navigation.backend);
    let failOnce=true;
    navigation.backend.queueObstacle=(descriptor)=>{
      if(failOnce){ failOnce=false; return {success:false}; }
      return original(descriptor);
    };
    const diagnosis=await navigation.suggestActions([-4,0,0],[4,0,0]);
    expect(diagnosis.status).toBe('blocked');
    expect(diagnosis.candidates[0].counterfactual).toMatchObject({reachable:false,reason:'NAVIGATION_COUNTERFACTUAL_RESTORE_FAILED'});
    expect(navigation.status().dynamicObstacles.tracked).toBe(1);
    const current=await navigation.findPath([-4,0,0],[4,0,0]);
    expect(current).toMatchObject({reachable:false,reason:'PARTIAL_PATH',scope:'current'});
    navigation.dispose();
  },15000);

});
