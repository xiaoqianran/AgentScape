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
      visual:{url:'/world/final.spz',status:'deferred'},
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

  it('loads modal-world runtime manifest and resolves artifact URLs relative to it',async()=>{
    const worldManifest={
      schemaVersion:1,id:'garden-v1',coordinateSystem:'z-up',
      artifacts:{
        environment:{path:'environment.ply',format:'ply'},
        visual:{path:'../gs_result/ply/point_cloud_7999.spz',format:'spz'},
        semantics:{path:'../objects.json',format:'json'}
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
    expect(environment.generated.manifest).toMatchObject({url:'https://world.test/jobs/garden-v1/runtime/world.json',schemaVersion:1,mesh:worldManifest.mesh,compiler:worldManifest.compiler});
    environment.dispose();
  });

  it('validates triangle geometry for the Rapier trimesh boundary',()=>{
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
    geometry.setIndex([0,1,2]);
    expect(geometryToTrimeshCollider(geometry)).toMatchObject({shape:'trimesh',indices:[0,1,2]});
  });
});


