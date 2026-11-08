import { it, expect } from 'vitest';
import * as THREE from 'three';
import { attachNativeScene } from '../../application/native-scene/NativeSceneHost.js';
import { extractNativeStaticColliders } from '../../application/native-scene/NativeEnvironmentGeometry.js';

const mesh = (geometry = new THREE.BoxGeometry(24, .2, 24)) =>
  new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());

it('extracts world-space triangles under transformed host parents without touching source geometry', () => {
  const scene = new THREE.Scene(), group = new THREE.Group();
  group.position.set(2, 0, -1);
  const floor = mesh(new THREE.BoxGeometry(4, .2, 4));
  floor.position.y = -.1;
  group.add(floor); scene.add(group);
  const before = floor.geometry.getAttribute('position').array.slice();
  const colliders = extractNativeStaticColliders(scene, { walkableMesh: floor });
  expect(colliders).toHaveLength(1);
  expect(colliders[0].shape).toBe('trimesh');
  expect(colliders[0].indices).toHaveLength(36);
  const x = colliders[0].vertices.filter((_, index) => index % 3 === 0);
  expect(Math.min(...x)).toBeCloseTo(0);
  expect(Math.max(...x)).toBeCloseTo(4);
  expect(floor.geometry.getAttribute('position').array).toEqual(before);
  floor.geometry.dispose(); floor.material.dispose();
});

it('rejects unsupported, foreign and oversized meshes instead of silently registering wrong physics', () => {
  const scene = new THREE.Scene();
  const floor = mesh();
  scene.add(floor);
  expect(() => extractNativeStaticColliders(scene, { staticMeshes: [floor, floor] }))
    .toThrow('NATIVE_STATIC_MESH_LIMIT');
  floor.userData.agentscapeDynamic = true;
  expect(() => extractNativeStaticColliders(scene, { walkableMesh: floor }))
    .toThrow('NATIVE_STATIC_MESH_UNSUPPORTED');
  delete floor.userData.agentscapeDynamic;
  scene.remove(floor);
  expect(() => extractNativeStaticColliders(scene, { walkableMesh: floor }))
    .toThrow('NATIVE_STATIC_MESH_NOT_IN_SCENE');
  scene.add(floor);
  const huge = mesh(new THREE.PlaneGeometry(1, 1, 360, 360));
  scene.add(huge);
  expect(() => extractNativeStaticColliders(scene, { staticMeshes: [huge] }))
    .toThrow('NATIVE_STATIC_TRIANGLE_LIMIT');
  const expensive = mesh(new THREE.BufferGeometry());
  scene.add(expensive);
  expensive.geometry.getAttribute = () => ({ itemSize:3, count:200_001 });
  expensive.geometry.getIndex = () => ({ count:3 });
  expect(() => extractNativeStaticColliders(scene, { staticMeshes:[expensive] }))
    .toThrow('NATIVE_STATIC_VERTEX_LIMIT');
  scene.remove(expensive);
  floor.geometry.dispose();floor.material.dispose();
  huge.geometry.dispose();huge.material.dispose();
  expensive.geometry.dispose();expensive.material.dispose();
});

it('creates real collision and a verified navigable native floor without manual collider coordinates', async () => {
  const scene = new THREE.Scene(), floor = mesh();
  floor.position.y = -.1;
  scene.add(floor);
  const renderer = { render() {}, dispose() { throw new Error('HOST_DISPOSED'); }, extensions: { has: () => false } };
  const session = await attachNativeScene({
    scene, camera: new THREE.PerspectiveCamera(), renderer,
    autoStart: false, walkableMesh: floor
  });
  try {
    expect(session.scene.capabilities).toMatchObject({environmentColliders:1,navigationRegistered:true});
    await session.scene.addModel({ id:'falling_cup',asset:'builtin://cup',position:[0,2,0] });
    await session.scene.addModel({ id:'walker',asset:'builtin://agent',position:[0,0,2] });
    for (let i=0;i<240;i++) session.scene.step();
    const y=session.world.physics.getPosition('falling_cup')[1];
    expect(y).toBeGreaterThan(-.1);
    expect(y).toBeLessThan(.5);
    const job=session.scene.interact({actor:'walker',action:'navigate',position:[3,0,3]});
    for (let i=0;i<3000 && session.scene.getJob(job.id).status==='running';i++) {
      session.scene.step();
      if(i%12===0) await new Promise(resolve=>setTimeout(resolve,0));
      else await Promise.resolve();
    }
    expect(session.scene.getJob(job.id)).toMatchObject({
      status:'succeeded',result:{verification:{status:'verified'}}
    });
  } finally {
    session.close();
    expect(scene.children).toEqual([floor]);
    floor.geometry.dispose();floor.material.dispose();
  }
},30000);
