import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { InteractionSystem } from '../src/runtime/systems/InteractionSystem.js';

const events={emit:vi.fn()};

describe('InteractionSystem recovery cleanup contracts',()=>{
  it('tracks recovery provenance only for the object actually held by the Agent and clears it on release',()=>{
    const record={state:{heldBy:{kind:'agent',id:'agent_01',anchor:'hold'}}};
    const store={has:()=>true,get:()=>record,list:()=>[]};
    const physics={setHeld:vi.fn()};
    const system=new InteractionSystem({store,physics,spatial:{},events});
    system.agentHeld.set('agent_01','blocker_01');
    expect(system.markRecoveryHeld('agent_01',{blockerId:'blocker_02',targetId:'cabinet_01',partName:'door',action:'open'})).toBe(false);
    expect(system.markRecoveryHeld('agent_01',{blockerId:'blocker_01',targetId:'cabinet_01',partName:'door',action:'open'})).toBe(true);
    expect(system.recoveryHeldStatus('agent_01')).toEqual({blockerId:'blocker_01',targetId:'cabinet_01',partName:'door',action:'open'});
    expect(system.releaseHeld('blocker_01','TEST')).toBe(true);
    expect(system.recoveryHeldStatus('agent_01')).toBeNull();
    expect(system.heldByAgent('agent_01')).toBeNull();
  });

  it('finds a deterministic Environment-supported cleanup plan outside the original action sweep',async()=>{
    const system=new InteractionSystem({store:{},physics:{},spatial:{},navigation:{},locomotion:{},events});
    system.recoveryHeldStatus=vi.fn(()=>({blockerId:'blocker_01',targetId:'cabinet_01',partName:'door',action:'open'}));
    system.heldByAgent=vi.fn(()=>'blocker_01');
    const sweepBox=new THREE.Box3(new THREE.Vector3(-.5,0,-.5),new THREE.Vector3(.5,1.5,.5));
    system.actionSweepBounds=vi.fn(()=>({checked:true,partName:'door',action:'open',bounds:{min:[-.5,0,-.5],max:[.5,1.5,.5]},box:sweepBox}));
    system.spatial={getBounds:vi.fn(()=>({min:[-.2,0,-.2],max:[.2,.4,.2],center:[0,.2,0],size:[.4,.4,.4]}))};
    system.physics={
      getPosition:vi.fn((id)=>id==='agent_01'?[0,0,2]:[0,.95,1.38]),
      raycast:vi.fn((origin)=>({environment:true,distance:origin[1],point:[origin[0],0,origin[2]]})),
      bodyMotionClear:vi.fn(()=>({clear:true})),
      bodyPoseClear:vi.fn(()=>({clear:true}))
    };
    system.holdAnchor=vi.fn(()=>({translation:[0,.95,-.62],rotation:[0,0,0,1]}));
    system.actorMetrics=vi.fn(()=>({radius:.32,height:1.7}));
    system.carryStandOff=vi.fn(()=>.8);
    system.actorBoxAt=vi.fn((_id,position)=>new THREE.Box3(new THREE.Vector3(position[0]-.32,0,position[2]-.32),new THREE.Vector3(position[0]+.32,1.7,position[2]+.32)));
    system.navigation={findPath:vi.fn(async(start,end)=>({reachable:true,cost:Math.hypot(end[0]-start[0],end[2]-start[2]),path:[start,end],end:{snapped:end}}))};
    const plan=await system.findRecoveryCleanupPlan('agent_01','cabinet_01',{partName:'door',action:'open',blockerId:'blocker_01'});
    expect(plan).toMatchObject({
      status:'cleanup-proposed',actorId:'agent_01',targetId:'cabinet_01',partName:'door',action:'open',blockerId:'blocker_01',
      support:{environment:true},preflight:{sweepClear:true,endpointClear:true}
    });
    const releaseBox=new THREE.Box3(
      new THREE.Vector3(plan.release[0]-.2,plan.release[1],plan.release[2]-.2),
      new THREE.Vector3(plan.release[0]+.2,plan.release[1]+.4,plan.release[2]+.2)
    );
    expect(sweepBox.intersectsBox(releaseBox)).toBe(false);
    expect(system.physics.raycast).toHaveBeenCalled();
    expect(system.physics.bodyPoseClear).toHaveBeenCalledWith('blocker_01',expect.any(Array),expect.any(Array),{excludeIds:['agent_01']});
    expect(system.navigation.findPath).toHaveBeenCalled();
  });

  it('executes cleanup through revalidation, shared transfer, release and verified settle',async()=>{
    const system=new InteractionSystem({store:{},physics:{},spatial:{},navigation:{},locomotion:{},events});
    const plan={status:'cleanup-proposed',actorId:'agent_01',targetId:'cabinet_01',partName:'door',action:'open',blockerId:'blocker_01',pose:{status:'current-pose',position:[1,0,1],routeCost:0},release:[1,.05,1]};
    system.findRecoveryCleanupPlan=vi.fn(async()=>structuredClone(plan));
    system.reorientHeldToward=vi.fn(()=>({clear:true,steps:1,yaw:0}));
    system.physics={getPosition:vi.fn(()=>[1,.95,1])};
    system.transferHeldToRelease=vi.fn(()=>({clear:true,transfer:[{point:[1,1.5,1],clear:true},{point:[1,1.5,1],clear:true},{point:[1,.05,1],clear:true}]}));
    system.recoveryHeldStatus=vi.fn(()=>({blockerId:'blocker_01',targetId:'cabinet_01',partName:'door',action:'open'}));
    system.releaseHeld=vi.fn(()=>true);
    system.waitForRecoveryCleanupSettle=vi.fn(async()=>({status:'recovery-cleaned',released:true,settled:true,sweepClear:true,contactClear:true}));
    const result=await system.cleanupRecoveryBlocker('agent_01','cabinet_01',{partName:'door',action:'open',blockerId:'blocker_01'});
    expect(system.findRecoveryCleanupPlan).toHaveBeenCalledTimes(2);
    expect(system.transferHeldToRelease).toHaveBeenCalledWith('agent_01','blocker_01',expect.any(THREE.Vector3));
    expect(system.releaseHeld).toHaveBeenCalledWith('blocker_01','RECOVERY_CLEANUP_RELEASE');
    expect(system.waitForRecoveryCleanupSettle).toHaveBeenCalledWith('agent_01','blocker_01','cabinet_01','door','open');
    expect(result).toMatchObject({status:'recovery-cleaned',released:true,settled:true,sweepClear:true,contactClear:true,stillHeld:false,recovery:{blockerId:'blocker_01'}});
  });

  it('shares one three-segment held transfer and restores the original pose when any segment blocks',()=>{
    const positions=[];
    const physics={
      getPosition:vi.fn(()=>[0,.95,0]),
      getRotation:vi.fn(()=>[0,0,0,1]),
      bodyMotionClear:vi.fn(()=>({clear:true})),
      setHeldPose:vi.fn((_id,position)=>positions.push([...position]))
    };
    const spatial={getBounds:vi.fn(()=>({size:[.4,.6,.4]}))};
    const system=new InteractionSystem({store:{},physics,spatial,events});
    const success=system.transferHeldToRelease('agent_01','blocker_01',[1,.05,1]);
    expect(success.clear).toBe(true);
    expect(success.transfer).toHaveLength(3);
    expect(positions).toEqual([[0,.95,0],[1,.95,1],[1,.05,1]]);

    positions.length=0;
    physics.bodyMotionClear
      .mockImplementationOnce(()=>({clear:true}))
      .mockImplementationOnce(()=>({clear:false,code:'CARRY_SWEEP_BLOCKED',blockedBy:['wall']}));
    const blocked=system.transferHeldToRelease('agent_01','blocker_01',[1,.05,1]);
    expect(blocked).toMatchObject({clear:false,reason:'TRANSFER_BLOCKED',transfer:[{clear:true},{clear:false,code:'CARRY_SWEEP_BLOCKED'}]});
    expect(positions).toEqual([[0,.95,0],[0,.95,0]]);
  });


  it('treats recovery provenance as ephemeral task context and does not reconstruct it from durable heldBy ownership',()=>{
    const store={has:()=>false,get:()=>null,list:()=>[]};
    const system=new InteractionSystem({store,physics:{},spatial:{},events});
    system.recoveryHeld.set('agent_01',{blockerId:'blocker_01',targetId:'cabinet_01',partName:'door',action:'open'});
    system.rebuildHeldOwnership();
    expect(system.recoveryHeldStatus('agent_01')).toBeNull();
  });

  it('rejects a cleanup plan when every release endpoint is occupied in Rapier',async()=>{
    const system=new InteractionSystem({store:{},physics:{},spatial:{},navigation:{},locomotion:{},events});
    system.recoveryHeldStatus=vi.fn(()=>({blockerId:'blocker_01',targetId:'cabinet_01',partName:'door',action:'open'}));
    system.heldByAgent=vi.fn(()=>'blocker_01');
    const sweepBox=new THREE.Box3(new THREE.Vector3(-.5,0,-.5),new THREE.Vector3(.5,1.5,.5));
    system.actionSweepBounds=vi.fn(()=>({checked:true,partName:'door',action:'open',bounds:{min:[-.5,0,-.5],max:[.5,1.5,.5]},box:sweepBox}));
    system.spatial={getBounds:vi.fn(()=>({min:[-.2,0,-.2],max:[.2,.4,.2],center:[0,.2,0],size:[.4,.4,.4]}))};
    system.physics={
      getPosition:vi.fn((id)=>id==='agent_01'?[0,0,2]:[0,.95,1.38]),
      raycast:vi.fn((origin)=>({environment:true,distance:origin[1],point:[origin[0],0,origin[2]]})),
      bodyPoseClear:vi.fn(()=>({clear:false,code:'CARRY_TARGET_BLOCKED',blockedBy:['crate_99']}))
    };
    system.holdAnchor=vi.fn(()=>({translation:[0,.95,-.62],rotation:[0,0,0,1]}));
    system.actorMetrics=vi.fn(()=>({radius:.32,height:1.7}));
    system.carryStandOff=vi.fn(()=>.8);
    system.actorBoxAt=vi.fn((_id,position)=>new THREE.Box3(new THREE.Vector3(position[0]-.32,0,position[2]-.32),new THREE.Vector3(position[0]+.32,1.7,position[2]+.32)));
    system.navigation={findPath:vi.fn(async(start,end)=>({reachable:true,cost:1,path:[start,end],end:{snapped:end}}))};
    const plan=await system.findRecoveryCleanupPlan('agent_01','cabinet_01',{partName:'door',action:'open',blockerId:'blocker_01'});
    expect(plan).toMatchObject({status:'cleanup-unavailable',reason:'NO_SAFE_CLEANUP_SPACE',blockerId:'blocker_01'});
    expect(system.physics.bodyPoseClear).toHaveBeenCalled();
  });


  it('does not verify cleanup when a settled released blocker still occupies the original action sweep',()=>{
    const blocker={state:{}};
    const store={has:(id)=>['blocker_01','cabinet_01'].includes(id),get:()=>blocker};
    const system=new InteractionSystem({store,physics:{},spatial:{},events});
    system.heldByAgent=vi.fn(()=>null);
    const sweepBox=new THREE.Box3(new THREE.Vector3(-1,0,-1),new THREE.Vector3(1,2,1));
    system.actionSweepBounds=vi.fn(()=>({checked:true,partName:'door',action:'open',bounds:{min:[-1,0,-1],max:[1,2,1]},box:sweepBox}));
    system.spatial={getBounds:vi.fn(()=>({min:[-.2,0,-.2],max:[.2,.4,.2],center:[0,.2,0],size:[.4,.4,.4]}))};
    system.physics={articulationContacts:vi.fn(()=>[])};
    const result=system.recoveryCleanupSettleResult({
      objectId:'blocker_01',targetId:'cabinet_01',actorId:'agent_01',partName:'door',action:'open',elapsed:.5
    },{sleeping:true,linearSpeed:0,angularSpeed:0},{settled:true});
    expect(result).toMatchObject({
      status:'recovery-cleanup-failed',reason:'ACTION_SWEEP_OCCUPIED',released:true,settled:true,sweepClear:false,contactClear:true
    });
  });


  it('samples deterministic Environment-supported release candidates outside the action sweep',()=>{
    const system=new InteractionSystem({store:{},physics:{},spatial:{},events});
    const sweepBox=new THREE.Box3(new THREE.Vector3(-.5,0,-.5),new THREE.Vector3(.5,1.5,.5));
    system.actionSweepBounds=vi.fn(()=>({checked:true,partName:'door',action:'open',bounds:{min:[-.5,0,-.5],max:[.5,1.5,.5]},box:sweepBox}));
    system.spatial={getBounds:vi.fn(()=>({min:[-.2,0,-.2],max:[.2,.4,.2],center:[0,.2,0],size:[.4,.4,.4]}))};
    system.physics={
      getPosition:vi.fn(()=>[0,.95,1.38]),
      raycast:vi.fn((origin)=>({environment:true,distance:origin[1],point:[origin[0],0,origin[2]]}))
    };
    const result=system.cleanupReleaseCandidates('agent_01','cabinet_01','door','open','blocker_01');
    expect(result.sweep).toMatchObject({checked:true,partName:'door'});
    expect(result.candidates).toHaveLength(8);
    expect(system.physics.raycast).toHaveBeenCalledTimes(8);
    for(const candidate of result.candidates) {
      expect(candidate.support).toMatchObject({environment:true});
      expect(sweepBox.clone().expandByScalar(.175).intersectsBox(candidate.box)).toBe(false);
    }
  });

});
