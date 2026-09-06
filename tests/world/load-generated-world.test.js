import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { geometryToTrimeshCollider, loadGeneratedWorld, loadGeneratedWorldManifest } from '../../world/loadGeneratedWorld.js';

vi.mock('three/examples/jsm/loaders/PLYLoader.js',()=>({
  PLYLoader:class {
    async loadAsync(){
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.Float32BufferAttribute([
        -2,0,-2, 2,0,-2, 2,0,2, -2,0,2
      ],3));
      geometry.setIndex([0,2,1,0,3,2]);
      return geometry;
    }
    parse(){
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,0,1],3));
      geometry.setIndex([0,2,1]);
      return geometry;
    }
  }
}));

vi.mock('three/examples/jsm/loaders/GLTFLoader.js',()=>({
  GLTFLoader:class {
    async parseAsync(){
      const scene=new THREE.Group();
      const mesh=new THREE.Mesh(new THREE.BufferGeometry());
      mesh.geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,0,1],3));
      mesh.geometry.setIndex([0,2,1]);
      mesh.position.set(2,0,0);
      scene.add(mesh);
      return {scene};
    }
    async loadAsync(){ return this.parseAsync(); }
  }
}));

describe('loadGeneratedWorld',()=>{
  const semantics={objects:[{id:1,label:'bench',center:[1,2,3]}]};

  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,status:200,json:async()=>semantics})));
  it('loads one mesh into the existing Environment contract and preserves optional artifact URLs',async()=>{
    const environment=await loadGeneratedWorld({
      mesh:{url:'/world/global_mesh.ply',format:'ply'},
      visual:'/world/final.spz',
      semantics:'/world/semantics.json',
      coordinateSystem:'y-up'
    });
    expect(environment.root.getObjectByName('GeneratedWorldMesh')).toBeTruthy();
    expect(environment.colliders[0]).toMatchObject({shape:'trimesh'});
    expect(environment.generated).toMatchObject({
      mesh:{url:'/world/global_mesh.ply',format:'ply'},
      visual:{url:'/world/final.spz',format:'spz',status:'deferred'},
      semantics:{url:'/world/semantics.json',data:semantics},
      coordinateSystem:'y-up'
    });
    expect(environment.root.userData.generatedSemantics).toEqual(semantics);
  });

  it('converts z-up generated geometry once before render, physics and navigation share it',async()=>{
    const environment=await loadGeneratedWorld({mesh:'/world/global_mesh.ply',coordinateSystem:'z-up'});
    const positions=Array.from(environment.floor.geometry.getAttribute('position').array);
    expect(positions[0]).toBeCloseTo(-2);
    expect(positions[1]).toBeCloseTo(-2);
    expect(positions[2]).toBeCloseTo(0);
    expect(environment.colliders[0].vertices.slice(0,3)).toEqual(positions.slice(0,3));
  });

  it('uses dedicated navigation geometry for locomotion while retaining the environment mesh for physics',async()=>{
    const navPly=new TextEncoder().encode(`ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
element face 1
property list uchar int vertex_indices
end_header
0 0 0
1 0 0
0 0 1
3 0 2 1
`);
    const environment=await loadGeneratedWorld({
      mesh:{url:'/world/environment.ply',format:'ply'},
      navigation:{data:navPly,format:'ply'},
      coordinateSystem:'y-up'
    });
    expect(environment.floor.geometry.getAttribute('position').count).toBe(4);
    expect(environment.navigationRoot.children[0].geometry.getAttribute('position').count).toBe(3);
    expect(environment.colliders[0].vertices).toEqual(Array.from(environment.floor.geometry.getAttribute('position').array));
    expect(environment.generated.navigation).toMatchObject({format:'ply',bytes:navPly.byteLength,locomotionGround:true});
    expect(environment.generated.collisionGeometry).toBe('environment');
    environment.dispose();
  });

  it('loads verified artifact bytes without knowing about Connector transport',async()=>{
    const ply=new TextEncoder().encode(`ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
element face 1
property list uchar int vertex_indices
end_header
0 0 0
1 0 0
0 0 1
3 0 2 1
`);
    const semantics=new TextEncoder().encode(JSON.stringify([{id:'chair_01',label:'chair'}]));
    const environment=await loadGeneratedWorld({
      mesh:{data:ply,format:'ply'},
      semantics:{data:semantics,format:'json'},
      coordinateSystem:'y-up'
    });
    expect(environment.floor.geometry.getAttribute('position').count).toBe(3);
    expect(environment.semantics).toEqual([{id:'chair_01',label:'chair'}]);
    expect(environment.generated.mesh).toEqual({format:'ply',bytes:ply.byteLength});
    expect(environment.generated.semantics).toMatchObject({format:'json',bytes:semantics.byteLength,data:[{id:'chair_01',label:'chair'}]});
  });

  it('loads GLB collision bytes and bakes node transforms into one runtime geometry',async()=>{
    const glb=new Uint8Array([0x67,0x6c,0x54,0x46]);
    const environment=await loadGeneratedWorld({mesh:{data:glb,format:'glb'},coordinateSystem:'y-up',metersPerUnit:2});
    const positions=Array.from(environment.floor.geometry.getAttribute('position').array);
    expect(positions.slice(0,3)).toEqual([4,0,0]);
    expect(environment.colliders[0]).toMatchObject({shape:'trimesh',indices:[0,2,1]});
    expect(environment.generated.mesh).toEqual({format:'glb',bytes:glb.byteLength});
    expect(environment.generated.metersPerUnit).toBe(2);
    environment.dispose();
  });

  it('loads modal-world runtime manifest and resolves artifact URLs relative to it',async()=>{
    const worldManifest={
      schemaVersion:1,id:'garden-v1',coordinateSystem:'z-up',metersPerUnit:1,
      artifacts:{
        environment:{path:'environment.ply',format:'ply'},
        visual:{path:'../gs_result/ply/point_cloud_7999.spz',format:'spz'},
        semantics:{path:'../objects.json',format:'json'},
        navigation:{path:'navigation.ply',format:'ply',role:'world-navigation',runtimeMode:'dedicated-geometry'}
      },
      layout:{bounds:{min:[-6,-6],max:[6,5]},groundY:0,margin:.5},
      mesh:{sourceTriangles:744212,runtimeTriangles:100000},
      compiler:{profile:'agentscape-environment-v1'}
    };
    const fetchMock=vi.fn(async(url)=>{
      if(String(url).endsWith('/runtime/world.json')) return {ok:true,status:200,url:'https://world.test/jobs/garden-v1/runtime/world.json',json:async()=>worldManifest};
      if(String(url).endsWith('/objects.json')) return {ok:true,status:200,url:String(url),json:async()=>semantics};
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch',fetchMock);
    const environment=await loadGeneratedWorldManifest('https://world.test/jobs/garden-v1/runtime/world.json');
    expect(environment.id).toBe('garden-v1');
    expect(environment.layout).toEqual(worldManifest.layout);
    expect(environment.generated.mesh.url).toBe('https://world.test/jobs/garden-v1/runtime/environment.ply');
    expect(environment.generated.visual.url).toBe('https://world.test/jobs/garden-v1/gs_result/ply/point_cloud_7999.spz');
    expect(environment.generated.semantics.url).toBe('https://world.test/jobs/garden-v1/objects.json');
    expect(environment.generated.navigation.url).toBe('https://world.test/jobs/garden-v1/runtime/navigation.ply');
    expect(environment.navigationRoot?.children?.[0]?.name).toBe('GeneratedWorldNavigationMesh');
    expect(environment.navigationRoot?.children?.[0]?.material?.visible).toBe(false);
    expect(environment.generated.metersPerUnit).toBe(1);
    expect(environment.generated.manifest).toMatchObject({url:'https://world.test/jobs/garden-v1/runtime/world.json',schemaVersion:1,mesh:worldManifest.mesh,compiler:worldManifest.compiler});
    environment.dispose();
  });

  it('transforms evidenced semantic instances into runtime coordinates without objectizing them',async()=>{
    const semanticPayload={
      schemaVersion:1,granularity:'instance',categories:['bench'],
      instances:[{id:'bench_01',label:'bench',center:[1,2,3],bbox:{min:[0,1,2],max:[2,3,4]},confidence:.9}],
      provenance:{kind:'provider-instance-evidence',source:'instances.json'}
    };
    const bytes=new TextEncoder().encode(JSON.stringify(semanticPayload));
    const environment=await loadGeneratedWorld({
      mesh:{url:'/world/environment.ply',format:'ply'},
      semantics:{data:bytes,format:'json'},
      coordinateSystem:'z-up',metersPerUnit:2
    });
    expect(environment.semantics.instances[0]).toMatchObject({id:'bench_01',label:'bench',confidence:.9});
    expect(environment.semantics.instances[0].center[0]).toBeCloseTo(2,6);
    expect(environment.semantics.instances[0].center[1]).toBeCloseTo(6,6);
    expect(environment.semantics.instances[0].center[2]).toBeCloseTo(-4,6);
    expect(environment.semantics.instances[0].bbox.min[0]).toBeCloseTo(0,6);
    expect(environment.semantics.instances[0].bbox.min[1]).toBeCloseTo(4,6);
    expect(environment.semantics.instances[0].bbox.min[2]).toBeCloseTo(-6,6);
    expect(environment.semantics.instances[0].bbox.max[0]).toBeCloseTo(4,6);
    expect(environment.semantics.instances[0].bbox.max[1]).toBeCloseTo(8,6);
    expect(environment.semantics.instances[0].bbox.max[2]).toBeCloseTo(-2,6);
  });

  it('validates triangle geometry for the Rapier trimesh boundary',()=>{
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
    geometry.setIndex([0,1,2]);
    expect(geometryToTrimeshCollider(geometry)).toMatchObject({shape:'trimesh',indices:[0,1,2]});
  });

  it('transforms point-scale semantic evidence without inventing bounds',async()=>{
    const semantics={
      schemaVersion:2,granularity:'instance',categories:['door'],
      instances:[{id:'hyworld2-target-4',label:'door',confidence:.95,localization:{kind:'point-scale',center:[1,2,3],scale:.5,leftPoint:[0,2,3],rightPoint:[2,2,3]},evidence:{sourceId:4}}],
      provenance:{kind:'hyworld2-sam3-depth-targets',instancesSource:'../camera_trajectory/target_camera.json'}
    };
    const bytes=new TextEncoder().encode(JSON.stringify(semantics));
    const environment=await loadGeneratedWorld({
      mesh:{url:'/world/environment.ply',format:'ply'},semantics:{data:bytes,format:'json'},coordinateSystem:'z-up',metersPerUnit:2
    });
    const instance=environment.semantics.instances[0];
    expect(instance.localization.center[0]).toBeCloseTo(2,6);
    expect(instance.localization.center[1]).toBeCloseTo(6,6);
    expect(instance.localization.center[2]).toBeCloseTo(-4,6);
    expect(instance.localization.scale).toBeCloseTo(1,6);
    expect(instance).not.toHaveProperty('bbox');
    environment.dispose();
  });

});
