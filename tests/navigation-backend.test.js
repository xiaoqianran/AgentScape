import * as THREE from 'three';
import { describe,expect,it } from 'vitest';
import { NavigationBackend } from '../src/runtime/navigation/NavigationBackend.js';
import { RecastNavigationBackend } from '../src/runtime/navigation/RecastNavigationBackend.js';
import { NavigationSystem } from '../src/runtime/systems/NavigationSystem.js';
import { ObjectStore } from '../src/runtime/ObjectStore.js';

const CAPABILITY_METHODS={
  'static-navmesh':['build','isReady'],
  'route-query':['queryRoute'],
  'dynamic-obstacles':['syncObstacles'],
  'obstacle-suppression':['queryRoute'],
  'debug-geometry':['debugGeometry']
};
const declaredMethodGaps=(backend)=>{
  const gaps=[];
  for(const capability of backend.capabilities||[]){
    for(const method of CAPABILITY_METHODS[capability]||[]){
      if(backend[method]===NavigationBackend.prototype[method]) gaps.push({capability,method});
    }
  }
  return gaps;
};

class DirectNavigationBackend extends NavigationBackend {
  constructor(){ super('direct-test',{capabilities:['static-navmesh','route-query','dynamic-obstacles','obstacle-suppression','debug-geometry']}); this.ready=false; this.builds=0; this.obstacles=[]; }
  isReady(){ return this.ready; }
  async build(geometry){ this.ready=true; this.builds+=1; this.geometryCount=geometry.length; return {success:true}; }
  syncObstacles(descriptors=[]){ this.obstacles=structuredClone(descriptors); return {success:true,tracked:this.obstacles.length,changed:0,operations:0,updates:0,descriptors:this.obstacles}; }
  queryRoute(start,end){
    const toPoint=(v)=>({x:v[0],y:v[1],z:v[2]});
    return {success:true,start:{success:true,point:toPoint(start)},end:{success:true,point:toPoint(end)},computed:{success:true,path:[toPoint(start),toPoint(end)],error:null}};
  }
  debugGeometry(){ return [0,0,0,1,0,0,0,0,1]; }
  clear(){ this.ready=false; this.obstacles=[]; }
}

const floor=()=>{
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(4,.2,4));
  mesh.position.y=-.1; mesh.updateMatrixWorld(true); return mesh;
};

describe('NavigationBackend contract',()=>{
  it('requires each declared capability to override its semantic execution method',()=>{
    expect(declaredMethodGaps(new RecastNavigationBackend())).toEqual([]);
    expect(declaredMethodGaps(new DirectNavigationBackend())).toEqual([]);
    class LyingBackend extends NavigationBackend { constructor(){ super('lying',{capabilities:['route-query']}); } }
    expect(declaredMethodGaps(new LyingBackend())).toEqual([{capability:'route-query',method:'queryRoute'}]);
  });

  it('lets NavigationSystem run through a non-Recast backend without changing world semantics',async()=>{
    const backend=new DirectNavigationBackend();
    const navigation=new NavigationSystem({store:new ObjectStore(),environmentRoots:[floor()],backend});
    const result=await navigation.findPath([-1,0,0],[1,0,0]);
    expect(result).toMatchObject({reachable:true,scope:'static',sameIsland:true,path:[[-1,0,0],[1,0,0]]});
    expect(backend.builds).toBe(1);
    expect(backend.geometryCount).toBe(1);
    expect(navigation.status()).toMatchObject({state:'ready',backend:{identity:'direct-test'},capabilities:{routeQuery:true,obstacleSuppression:true}});
    expect(navigation.debugGeometry()).toHaveLength(9);
    navigation.dispose();
  });
});
