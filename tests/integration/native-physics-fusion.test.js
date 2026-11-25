import * as THREE from 'three';
import {describe,it,expect} from 'vitest';
import {attachNativeScene} from '../../application/native-scene/NativeSceneHost.js';
import {openCodeProject} from '../../application/native-scene/CodeProject.js';
import {createSceneObserver} from '../../application/native-scene/SceneObserver.js';
import {analyzeNativePhysicsGeometry} from '../../application/native-scene/NativePhysicsGeometry.js';

const renderer=()=>({render(){},extensions:{has:()=>false}});
const box=(x,y,z)=>new THREE.Mesh(new THREE.BoxGeometry(x,y,z),new THREE.MeshBasicMaterial());
const attach=(scene,options={})=>attachNativeScene({scene,camera:new THREE.PerspectiveCamera(),renderer:renderer(),autoStart:false,...options});
const step=(host,frames)=>{for(let i=0;i<frames;i++)host.scene.step();};

describe('native mesh physics fusion',()=>{
  it('measures local compound oriented boxes, not one solid box across empty space',()=>{
    const scene=new THREE.Scene(),root=new THREE.Group(),left=box(1,.2,1),right=box(1,.2,1);
    root.position.set(2,3,4);root.rotation.y=.4;
    left.position.set(-2,0,0);right.position.set(2,0,0);right.rotation.z=.5;right.scale.set(1,2,1);
    root.add(left,right);scene.add(root);
    const result=analyzeNativePhysicsGeometry(root);
    expect(result).toMatchObject({meshCount:2,colliderSource:'mesh-bounds',physicsVerified:false});
    expect(result.colliders[0].translation[0]).toBeCloseTo(-2);
    expect(result.colliders[1].translation[0]).toBeCloseTo(2);
    expect(result.colliders[1].halfExtents[1]).toBeCloseTo(.2);
    expect(Math.abs(new THREE.Quaternion(...result.colliders[1].rotation).dot(right.quaternion))).toBeCloseTo(1);
  });
  it('rejects incomplete/unsafe geometry instead of silently approximating it',()=>{
    const root=new THREE.Group(),mesh=box(1,1,1);root.add(mesh);
    root.scale.set(2,1,1);
    expect(()=>analyzeNativePhysicsGeometry(root)).toThrow('NATIVE_PHYSICS_SCALE_UNSUPPORTED');
    root.scale.set(1,1,1);mesh.material=new THREE.ShaderMaterial();
    expect(()=>analyzeNativePhysicsGeometry(root)).toThrow('NATIVE_PHYSICS_DEFORMED_GEOMETRY');
    mesh.material=new THREE.MeshBasicMaterial();mesh.geometry=new THREE.PlaneGeometry(1,1);
    expect(()=>analyzeNativePhysicsGeometry(root)).toThrow('NATIVE_PHYSICS_GEOMETRY_INVALID');
    root.remove(mesh);root.add(new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),2));
    expect(()=>analyzeNativePhysicsGeometry(root)).toThrow('NATIVE_PHYSICS_DEFORMED_GEOMETRY');
  });
  it('discovers without mutation, binds exact native objects, measures a real solver and protects transform ownership',async()=>{
    const scene=new THREE.Scene(),platform=box(3,.2,3),ball=box(.4,.4,.4);
    platform.name='Platform';platform.position.y=1;ball.position.y=3;scene.add(platform,ball);
    const host=await attach(scene);
    try{
      const native=host.scene.native,observer=createSceneObserver(native);
      const found=observer.search({query:'Platform'}).items[0];
      expect(()=>observer.physicsCandidate({nodePath:found.nodePath,objectUuid:'wrong'})).toThrow('NATIVE_INSPECT_OBJECT_CONFLICT');
      const candidate=observer.physicsCandidate(found);
      expect(candidate).toMatchObject({meshCount:1,physicsVerified:false});
      expect(host.world.physics.entries.size).toBe(0);
      expect(()=>native.bindComponent({id:'ball',object:ball,physics:{body:'dynamic',colliders:'mesh-bounds'}})).toThrow('NATIVE_PHYSICS_MASS_REQUIRED');
      native.bindComponent({id:'platform',object:platform,physics:{body:'fixed',colliders:'mesh-bounds'}});
      const unreg=host.scene.registerEditable({id:'ball',object:ball,properties:['position']});
      expect(()=>native.bindComponent({id:'ball',object:ball,physics:{body:'dynamic',mass:1,colliders:'mesh-bounds'}})).toThrow('NATIVE_EDIT_PHYSICS_AUTHORITY_CONFLICT');
      unreg();
      const binding=native.bindComponent({id:'ball',object:ball,physics:{body:'dynamic',mass:1,colliders:'mesh-bounds'}});
      expect(binding.object).toBe(ball);
      expect(()=>host.scene.registerEditable({id:'ball',object:ball,properties:['scale']})).toThrow('NATIVE_EDIT_PHYSICS_AUTHORITY_CONFLICT');
      expect(()=>native.analyzePhysics(ball)).toThrow('NATIVE_PHYSICS_COMPONENT_OVERLAP');
      step(host,180);
      expect(ball.position.y).toBeCloseTo(1.3,1);
      const state=host.scene.inspect('ball');
      expect(state).toMatchObject({source:'project',physics:{source:'native-physics',colliderSource:'mesh-bounds',
        transformAuthority:'physics',state:{registered:true,body:'dynamic',colliderCount:1},physicsVerified:false}});
      expect(state.physics.position[1]).toBeCloseTo(ball.position.y,5);
      expect(state.capabilities).toEqual([]);
      expect(host.scene.observe().project.entities.find(e=>e.id==='ball').physics.state.registered).toBe(true);
      const verified=host.scene.verify([{id:'registered',kind:'state-equals',targetId:'ball',source:'native-physics',stateKey:'registered',value:true},
        {id:'body',kind:'state-equals',targetId:'ball',source:'native-physics',stateKey:'body',value:'dynamic'}]);
      expect(verified.verification.status).toBe('verified');
      expect(binding.remove()).toBe(true);
      expect(ball.parent).toBe(scene);expect(()=>host.scene.inspect('ball')).toThrow('OBJECT_NOT_FOUND');
    }finally{host.close();}
  });
  it('uses actual compound collision gaps and real ground meshes; an opted-in kinematic action changes collision behavior',async()=>{
    const scene=new THREE.Scene(),ground=box(10,.2,10),gate=new THREE.Group();
    ground.position.y=-.1;gate.position.y=1;
    const left=box(1,.2,2),right=box(1,.2,2);left.position.x=-1.5;right.position.x=1.5;gate.add(left,right);
    const supported=box(.3,.3,.3),gap=box(.3,.3,.3);supported.position.set(-1.5,3,0);gap.position.set(0,3,0);
    scene.add(ground,gate,supported,gap);
    const host=await attach(scene,{walkableMesh:ground});
    try{
      const native=host.scene.native;
      expect(()=>native.analyzePhysics(ground)).toThrow('NATIVE_PHYSICS_ENVIRONMENT_OVERLAP');
      let open=false;
      native.bindComponent({id:'gate',object:gate,physics:{body:'kinematic',colliders:'mesh-bounds'},
        semantic:{read:()=>({open})},actions:[{name:'open',execute(){gate.position.z=4;open=true;},verify:({after})=>after.open}]});
      for(const [id,object] of [['supported',supported],['gap',gap]])
        native.bindComponent({id,object,physics:{body:'dynamic',mass:.5,colliders:'mesh-bounds'}});
      step(host,180);
      expect(supported.position.y).toBeCloseTo(1.25,1);expect(gap.position.y).toBeCloseTo(.15,1);
      const job=host.scene.interact({action:'invoke',target:'gate',name:'open',source:'project'});
      const result=await host.scene.waitJob(job.id);
      expect(result).toMatchObject({status:'succeeded',result:{verification:{status:'verified'}}});
      step(host,180);
      expect(supported.position.y).toBeCloseTo(.15,1);
      expect(host.scene.inspect('gate').physics.position[2]).toBeCloseTo(4,4);
      expect(host.scene.inspect('gate').physics.physicsVerified).toBe(false);
    }finally{host.close();}
  });
  it('passes walkableMesh and staticMeshes declared by a complete code project to the native runtime',async()=>{
    const project={schema:'agentscape.code-project',schemaVersion:1,id:'native_physics_world',name:'Native physics',resources:{},source:
      `export function createProject({THREE}){
        const scene=new THREE.Scene(),ground=new THREE.Mesh(new THREE.BoxGeometry(4,.2,4),new THREE.MeshBasicMaterial());
        ground.position.y=-.1;const object=new THREE.Mesh(new THREE.BoxGeometry(.4,.4,.4),new THREE.MeshBasicMaterial());object.position.y=2;scene.add(ground,object);
        return {scene,camera:new THREE.PerspectiveCamera(),renderer:{render(){},extensions:{has:()=>false}},walkableMesh:ground,
          setup({scene:api}){api.native.bindComponent({id:'object',object,physics:{body:'dynamic',mass:1,colliders:'mesh-bounds'}});}};
      }`};
    const host=await openCodeProject({project,authorized:true,autoStart:false});
    try{
      expect(host.scene.capabilities).toMatchObject({environmentColliders:1,navigationRegistered:true});
      await host.playback.control({command:'pause'});await host.playback.control({command:'step',steps:120});await host.playback.control({command:'step',steps:120});
      expect(host.scene.inspect('object').physics.position[1]).toBeCloseTo(.2,1);
    }finally{host.close();}
  });
});
