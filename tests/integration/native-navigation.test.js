import * as THREE from 'three';
import {describe,it,expect} from 'vitest';
import {attachNativeScene} from '../../application/native-scene/NativeSceneHost.js';

const box=(size,position)=>{const o=new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshBasicMaterial());o.position.fromArray(position);return o;};
async function attach(scene,options={}){
  return attachNativeScene({scene,camera:new THREE.PerspectiveCamera(),renderer:{render(){},extensions:{has:()=>false}},autoStart:false,...options});
}
async function finish(scene,job,limit=2400){
  for(let n=0;n<limit&&scene.getJob(job.id).status==='running';n++){
    scene.step();if(n%12===0)await new Promise(resolve=>setTimeout(resolve,0));else await Promise.resolve();
  }
  expect(scene.getJob(job.id).status).not.toBe('running');return scene.waitJob(job.id);
}
async function agent(host,position){
  await host.scene.addModel({id:'actor',asset:'builtin://agent',position});
  for(let n=0;n<30;n++)host.scene.step();
}
const walk=(host,position)=>finish(host.scene,host.scene.interact({action:'navigate',actor:'actor',position}));
const floor=(width=12,depth=10)=>box([width,.2,depth],[0,-.1,0]);

describe('native physical navigation',()=>{
  it('uses a grouped static environment as collision and navmesh input; walks around the wall',async()=>{
    const root=new THREE.Scene(),room=new THREE.Group(),ground=floor(),wall=box([.3,2.5,6],[0,1.25,0]);
    room.add(ground,wall);root.add(room);
    const host=await attach(root,{staticMeshes:[room]});
    try{
      expect(host.scene.capabilities).toMatchObject({environmentColliders:2,navigationRegistered:true,navigationSource:'physics-colliders'});
      await agent(host,[-3,0,0]);
      const route=await host.world.navigation.findPath([-3,0,0],[3,0,0]);
      expect(route,JSON.stringify(route)).toMatchObject({reachable:true});
      expect(route.cost).toBeGreaterThan(8);
      expect(route.path.some(p=>Math.abs(p[2])>3)).toBe(true);
      expect(host.world.navigation.status().lastBuild.nativeColliderCount).toBe(2);
      const result=await walk(host,[3,0,0]);
      expect(result,JSON.stringify(result)).toMatchObject({status:'succeeded',result:{value:{status:'arrived'}}});
      expect(host.world.physics.getPosition('actor')[0]).toBeGreaterThan(2.7);
      expect(wall.parent).toBe(room);
    }finally{host.close();}
  });
  it('uses a native fixed binding collider rather than its visible mesh; invalidates on registration and removal',async()=>{
    const root=new THREE.Scene(),ground=floor(10,5);root.add(ground);
    const host=await attach(root,{walkableMesh:ground});
    try{
      const route=()=>host.world.navigation.findPath([-3,0,0],[3,0,0]);
      const first=await route();expect(first.reachable).toBe(true);
      const marker=box([.1,.1,.1],[0,1.3,0]);root.add(marker);
      const binding=host.scene.native.bindComponent({id:'barrier',object:marker,physics:{body:'fixed',
        colliders:[{shape:'box',halfExtents:[.15,1.3,3]}]}});
      expect(host.world.navigation.status().dirty).toBe(true);
      const blocked=await route();expect(blocked.reachable).toBe(false);
      expect(blocked.buildVersion).toBeGreaterThan(first.buildVersion);
      expect(binding.remove()).toBe(true);
      const again=await route();expect(again.reachable).toBe(true);
      expect(again.buildVersion).toBeGreaterThan(blocked.buildVersion);
      expect(marker.parent).toBe(root);
    }finally{host.close();}
  });
  it('reuses a real sliding gate collider as a dynamic obstacle; only routes through after opening',async()=>{
    const root=new THREE.Scene(),ground=floor(10,2.4);root.add(ground);
    const gate=new THREE.Group();root.add(gate);
    const door=box([.22,2.4,3.2],[0,1.2,0]);door.name='Gate';gate.add(door);
    const host=await attach(root,{walkableMesh:ground});
    try{
      host.scene.native.bindComponent({id:'gate',object:gate,physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.12,.1,.1],translation:[0,-.2,0]}]},
        parts:{gate:{node:'Gate',physics:{body:'dynamic',mass:.35,colliders:[{shape:'box',halfExtents:[.11,1.2,1.6]}]},
          joint:{type:'prismatic',axis:[0,1,0],limits:[0,2.8],motor:{stiffness:600,damping:45}}}}});
      await agent(host,[-1.2,0,0]);
      const query=()=>host.world.navigation.findPath(host.world.physics.getPosition('actor'),[3,0,0]);
      const closed=await query();expect(closed,JSON.stringify(closed)).toMatchObject({reachable:false});
      const before=host.scene.history().value;
      const diagnostic=await host.scene.diagnoseNavigation({actor:'actor',position:[3,0,0]});
      expect(diagnostic,JSON.stringify(diagnostic)).toMatchObject({status:'action-candidate',current:{reachable:false},
        recommendation:{provisional:true,interaction:{action:'invoke',actor:'actor',target:'gate',source:'native-physics',name:'slide',partName:'gate',args:{target:2.8}}}});
      expect(diagnostic.candidates[0]).toMatchObject({counterfactual:{reachable:true,assumption:'joint-target-pose'},sweep:{checked:true,actionIntroducesNoCollision:true}});
      expect((await query()).reachable).toBe(false);
      expect(host.world.physics.getArticulationState('gate','gate').coordinate).toBeCloseTo(0,2);
      expect(host.scene.history().value).toEqual(before);
      const open=await finish(host.scene,host.scene.interact(diagnostic.recommendation.interaction));
      expect(open,JSON.stringify(open)).toMatchObject({status:'succeeded',result:{value:{physicsVerified:true}}});
      const opened=await query();expect(opened,JSON.stringify(opened)).toMatchObject({reachable:true});
      expect(opened.buildVersion).toBe(closed.buildVersion);
      expect(opened.dynamicObstacles.syncVersion).toBeGreaterThan(closed.dynamicObstacles.syncVersion);
      const result=await walk(host,[3,0,0]);expect(result,JSON.stringify(result)).toMatchObject({status:'succeeded',result:{value:{status:'arrived'}}});
      expect(host.world.physics.getPosition('actor')[0]).toBeGreaterThan(2.7);
    }finally{host.close();}
  });
  it('walks onto an upper landing made of actual native stair meshes',async()=>{
    const root=new THREE.Scene(),stairs=new THREE.Group();root.add(stairs);
    stairs.add(box([6,.2,4],[-3,-.1,0]));
    for(let n=1;n<=8;n++){
      const height=n*.16;
      stairs.add(box([.5,height+.1,4],[(n-.5)*.5,(height-.1)/2,0]));
    }
    stairs.add(box([3,1.38,4],[5.5,.59,0]));
    const host=await attach(root,{staticMeshes:[stairs]});
    try{
      await agent(host,[-2,0,0]);
      const route=await host.world.navigation.findPath([-2,0,0],[5.5,1.28,0]);
      expect(route,JSON.stringify(route)).toMatchObject({reachable:true});
      expect(route.path.at(-1)[1]).toBeGreaterThan(1);
      const result=await walk(host,[5.5,1.28,0]);
      expect(result,JSON.stringify(result)).toMatchObject({status:'succeeded',result:{value:{status:'arrived'}}});
      const position=host.world.physics.getPosition('actor');expect(position[1]).toBeGreaterThan(1.1);expect(position[0]).toBeGreaterThan(5.2);
    }finally{host.close();}
  });
  it('does not report arrival on a disconnected floor at the same horizontal position',async()=>{
    const root=new THREE.Scene(),ground=floor(8,8),upper=box([8,.2,8],[0,3.1,0]);root.add(ground,upper);
    const host=await attach(root,{staticMeshes:[ground,upper]});
    try{
      await agent(host,[0,0,0]);
      const result=await walk(host,[0,3.2,0]);
      expect(result.status).toBe('failed');expect(host.world.physics.getPosition('actor')[1]).toBeLessThan(.2);
    }finally{host.close();}
  });
});


it('uses declared collision-only terrain and rejects an excessive native navmesh extent before build',async()=>{
  const root=new THREE.Scene();
  const host=await attach(root,{colliders:[{shape:'box',halfExtents:[8,.1,5],translation:[0,-.1,0]}]});
  try{
    expect((await host.world.navigation.findPath([-2,0,0],[2,0,0])).reachable).toBe(true);
    const distant=box([1,1,1],[300,1,0]);root.add(distant);
    const b=host.scene.native.bindComponent({id:'distant',object:distant,physics:{body:'fixed',colliders:'mesh-bounds'}});
    const bad=await host.world.navigation.findPath([-2,0,0],[2,0,0]);
    expect(bad).toMatchObject({reachable:false,reason:'NATIVE_NAVIGATION_EXTENT_LIMIT'});
    expect(b.remove()).toBe(true);
    expect((await host.world.navigation.findPath([-2,0,0],[2,0,0])).reachable).toBe(true);
  }finally{host.close();}
});


it('previews the real navigation route through SceneFacade without moving the actor or recording history',async()=>{
  const root=new THREE.Scene(),ground=floor();root.add(ground);
  const host=await attach(root,{walkableMesh:ground});
  try{
    await agent(host,[-2,0,0]);
    const before=host.world.physics.getPosition('actor'),history=host.scene.history().value,revision=host.scene.observe({limit:1}).revision;
    const route=await host.scene.previewNavigation({actor:'actor',position:[2,0,0]});
    expect(route).toMatchObject({reachable:true,path:expect.any(Array)});
    expect(host.world.physics.getPosition('actor')).toEqual(before);
    expect(host.scene.history().value).toEqual(history);
    expect(host.scene.observe({limit:1}).revision).toBe(revision);
    await expect(host.scene.previewNavigation({actor:'missing',position:[2,0,0]})).rejects.toMatchObject({code:'ACTOR_NOT_AGENT'});
  }finally{host.close();}
});
