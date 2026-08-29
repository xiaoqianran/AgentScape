import * as THREE from 'three';
import { describe,expect,it } from 'vitest';
import { NavigationBackend } from '../world/runtime/navigation/NavigationBackend.js';
import { RecastNavigationBackend } from '../world/runtime/navigation/RecastNavigationBackend.js';
import { NavigationSystem } from '../world/runtime/systems/NavigationSystem.js';
import { ObjectStore } from '../world/runtime/ObjectStore.js';

import { declaredNavigationCapabilityMethodGaps,expectRouteExecution } from './helpers/navigationBackendConformance.js';

class DirectNavigationBackend extends NavigationBackend {
  constructor(){ super('direct-test',{capabilities:['static-routing','route-query','debug-geometry']}); this.ready=false; this.builds=0; this.obstacles=[]; }
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
    expect(declaredNavigationCapabilityMethodGaps(new RecastNavigationBackend())).toEqual([]);
    expect(declaredNavigationCapabilityMethodGaps(new DirectNavigationBackend())).toEqual([]);
    class LyingBackend extends NavigationBackend { constructor(){ super('lying',{capabilities:['route-query']}); } }
    expect(declaredNavigationCapabilityMethodGaps(new LyingBackend())).toEqual([{capability:'route-query',method:'queryRoute'}]);
  });

  it('lets NavigationSystem run through a non-Recast backend without changing world semantics',async()=>{
    const backend=new DirectNavigationBackend();
    const navigation=new NavigationSystem({store:new ObjectStore(),environmentRoots:[floor()],backend});
    const result=await navigation.findPath([-1,0,0],[1,0,0]);
    expect(result).toMatchObject({reachable:true,scope:'static',sameIsland:true,path:[[-1,0,0],[1,0,0]]});
    expect(backend.builds).toBe(1);
    expect(backend.geometryCount).toBe(1);
    expect(navigation.status()).toMatchObject({state:'ready',backend:{identity:'direct-test'},capabilities:{staticRouting:true,routeQuery:true,obstacleSuppression:false,counterfactual:'none'}});
    expect(navigation.profile()).toMatchObject({identity:'direct-test',backendCapabilities:['static-routing','route-query','debug-geometry'],runtimeCapabilities:['action-aware-diagnostics']});
    expect(navigation.debugGeometry()).toHaveLength(9);
    navigation.dispose();
  });

  it('executes the Recast static-routing and route-query contract through plain geometry',async()=>{
    const backend=new RecastNavigationBackend();
    try {
      const route=await expectRouteExecution(backend);
      expect(route.computed.path.length).toBeGreaterThan(1);
    } finally { backend.dispose(); }
  });

  it('executes dynamic obstacle synchronization only when the backend declares it',async()=>{
    const backend=new RecastNavigationBackend();
    try {
      await expectRouteExecution(backend);
      const synced=backend.syncObstacles([{id:'blocker:0',shape:'box',sourceShape:'box',quality:'exact',position:[0,0,0],halfExtents:[.25,.8,2],angle:0}]);
      expect(synced).toMatchObject({success:true,tracked:1,changed:1});
      expect(backend.profile().capabilities).toContain('dynamic-obstacles');
    } finally { backend.dispose(); }
  });

});
