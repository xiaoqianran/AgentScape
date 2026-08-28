import { expect } from 'vitest';
import { NavigationBackend } from '../../src/runtime/navigation/NavigationBackend.js';

export const NAVIGATION_CAPABILITY_METHODS=Object.freeze({
  'static-routing':['build','isReady'],
  'route-query':['queryRoute'],
  'dynamic-obstacles':['syncObstacles'],
  'obstacle-suppression':['queryRoute'],
  'debug-geometry':['debugGeometry']
});

export function declaredNavigationCapabilityMethodGaps(backend){
  const gaps=[];
  for(const capability of backend.capabilities||[]){
    for(const method of NAVIGATION_CAPABILITY_METHODS[capability]||[]){
      if(backend[method]===NavigationBackend.prototype[method]) gaps.push({capability,method});
    }
  }
  return gaps;
}

export const floorGeometry=()=>[{
  positions:new Float32Array([
    -2,0,-2,
     2,0,-2,
     2,0, 2,
    -2,0, 2
  ]),
  // Counter-clockwise when viewed from above: Recast receives upward-facing walkable triangles.
  indices:Uint32Array.from([0,2,1,0,3,2])
}];

export async function expectRouteExecution(backend,{config}={}){
  const built=await backend.build(floorGeometry(),config||{
    agentRadius:.3,agentHeight:1.7,maxClimb:.3,maxSlope:45,maxSnapDistance:.75,endTolerance:.3
  });
  expect(built).toMatchObject({success:true});
  expect(backend.isReady()).toBe(true);
  const route=backend.queryRoute([-1,0,0],[1,0,0],{halfExtents:{x:.75,y:1.7,z:.75}});
  expect(route).toMatchObject({success:true,start:{success:true},end:{success:true},computed:{success:true}});
  expect(route.computed.path.length).toBeGreaterThan(0);
  return route;
}
