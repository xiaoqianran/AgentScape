import { expect } from 'vitest';
import { PhysicsBackend } from '../../src/runtime/physics/PhysicsBackend.js';

export const CAPABILITY_METHODS=Object.freeze({
  'rigid-body':['createBody','removeBody','bodyKey','bodyType','setBodyType','bodyPose','setBodyPose','translateBody','clearBodyMotion','bodyMotion','wakeBody'],
  'collision':['createColliders','colliders','colliderKey','colliderParent','colliderSnapshot'],
  'articulated-body':['createJoint','setJointTarget'],
  'joints':['createJoint','setJointTarget'],
  'character-controller':['createCharacterController','removeCharacterController','cancelCharacterMovement','moveCharacter'],
  'scene-query':['syncSceneQueries','createQueryShape','disposeQueryShape','intersectionsWithShape','castCollider','raycast','contactPairs','penetrations','shapesIntersect']
});

export function declaredCapabilityMethodGaps(backend){
  const gaps=[];
  for(const capability of backend.capabilities||[]){
    for(const method of CAPABILITY_METHODS[capability]||[]){
      if(backend[method]===PhysicsBackend.prototype[method]) gaps.push({capability,method});
    }
  }
  return gaps;
}

export function unexpectedPublicBackendMethods(backend){
  const contract=new Set(Object.getOwnPropertyNames(PhysicsBackend.prototype).filter((name)=>name!=='constructor'));
  return Object.getOwnPropertyNames(Object.getPrototypeOf(backend))
    .filter((name)=>name!=='constructor' && !name.startsWith('_') && typeof backend[name]==='function')
    .filter((name)=>!contract.has(name))
    .sort();
}

export async function createConformanceWorld(createBackend){
  const backend=createBackend();
  await backend.init();
  const world=backend.createWorld();
  return {backend,world,dispose:()=>backend.dispose(world)};
}

export function expectSemanticBodyRoundTrip(backend,world){
  const body=backend.createBody(world,{type:'dynamic',position:[1,2,3]});
  expect(backend.bodyType(body)).toBe('dynamic');
  expect(backend.bodyPose(body).position).toEqual([1,2,3]);
  backend.setBodyPose(body,{position:[2,3,4],rotation:[0,0,0,1]});
  expect(backend.bodyPose(body)).toMatchObject({position:[2,3,4],rotation:[0,0,0,1]});
  backend.clearBodyMotion(body);
  expect(backend.bodyMotion(body)).toMatchObject({linearSpeed:0,angularSpeed:0});
  backend.removeBody(world,body);
}

export function expectCollisionRoundTrip(backend,world){
  const body=backend.createBody(world,{type:'fixed',position:[0,0,0]});
  const colliders=backend.createColliders(world,body,[{shape:'box',halfExtents:[.5,.5,.5]}]);
  expect(colliders).toHaveLength(1);
  expect(backend.colliders(body)).toHaveLength(1);
  expect(backend.colliderParent(colliders[0])).toBe(body);
  expect(backend.colliderSnapshot(colliders[0])).toMatchObject({shape:{kind:'box',halfExtents:{x:.5,y:.5,z:.5}}});
  return {body,collider:colliders[0]};
}
