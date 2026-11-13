import { it, expect } from 'vitest';
import * as THREE from 'three';
import { WorldStorage } from '../../application/scene/WorldStorage.js';
import { attachNativeScene } from '../../application/native-scene/NativeSceneHost.js';
import {
  createNativeOverlayCheckpoint, openNativeOverlayCheckpoint, MemoryNativeOverlayHeadStore
} from '../../application/native-scene/NativeOverlayCheckpoint.js';

class MemoryBlocks {
  blocks = new Map();
  async write(hash, bytes) { if (!this.blocks.has(hash)) this.blocks.set(hash, bytes.slice()); }
  async read(hash, size) {
    const bytes = this.blocks.get(hash);
    if (!bytes || bytes.length !== size) throw new Error('MISSING_BLOCK');
    return bytes.slice();
  }
}
const host = () => {
  const scene = new THREE.Scene();
  const ground = new THREE.Mesh(new THREE.BoxGeometry(20, .2, 20), new THREE.MeshStandardMaterial());
  ground.position.y = -.1;
  scene.add(ground);
  return {scene,ground};
};
const attach = scene => attachNativeScene({
  scene, camera:new THREE.PerspectiveCamera(),
  renderer:{render() {},extensions:{has:()=>false}},
  autoStart:false,hostProjectId:'reliable-demo',hostRevision:'v1',
  colliders:[{shape:'box',halfExtents:[10,.1,10],translation:[0,-.1,0]}]
});
const cleanup = (session, ground) => { session.close();ground.geometry.dispose();ground.material.dispose(); };

it('publishes a verified overlay head and restores it on a fresh runtime', async () => {
  const storage = new WorldStorage(new MemoryBlocks()),heads = new MemoryNativeOverlayHeadStore();
  const {scene,ground} = host(), session = await attach(scene);
  let root;
  try {
    const checkpoint = createNativeOverlayCheckpoint(session.scene,storage,heads);
    expect(await checkpoint.restoreLatest()).toBeNull();
    await session.scene.addModel({id:'first_cup',asset:'builtin://cup',position:[1,2,0]});
    root=await checkpoint.saveLatest();
    expect(await heads.read()).toEqual(root);
    const second=await checkpoint.saveLatest();
    expect(await heads.read()).toEqual(second);
  } finally {cleanup(session,ground);}
  const {scene:again,ground:againGround}=host(),restored=await attach(again);
  try {
    const checkpoint=await openNativeOverlayCheckpoint(restored.scene,storage,heads);
    expect(await checkpoint.readLatest()).toMatchObject({kind:'native-overlay'});
    expect(restored.world.store.has('first_cup')).toBe(true);
    expect(again.children).toContain(againGround);
  } finally {cleanup(restored,againGround);}
});

it('keeps the previously published root when save verification or head publication fails', async () => {
  const storage=new WorldStorage(new MemoryBlocks()),heads=new MemoryNativeOverlayHeadStore();
  const {scene,ground}=host(),session=await attach(scene);
  try {
    const checkpoint=createNativeOverlayCheckpoint(session.scene,storage,heads);
    await session.scene.addModel({id:'original',asset:'builtin://cup',position:[0,1,0]});
    const previous=await checkpoint.saveLatest();
    const originalPrepare=session.scene.prepareOverlay;
    session.scene.prepareOverlay=async()=>{throw new Error('CORRUPT_NEW_DEPENDENCY');};
    await expect(checkpoint.saveLatest()).rejects.toThrow('CORRUPT_NEW_DEPENDENCY');
    session.scene.prepareOverlay=originalPrepare;
    expect(await heads.read()).toEqual(previous);

    const originalPublish=heads.publish.bind(heads);
    heads.publish=async()=>{throw new Error('DURABLE_PUBLISH_FAILED');};
    await expect(checkpoint.saveLatest()).rejects.toThrow('DURABLE_PUBLISH_FAILED');
    heads.publish=originalPublish;
    expect(await heads.read()).toEqual(previous);

    await session.scene.addModel({id:'later',asset:'builtin://chair',position:[1,0,1]});
    await checkpoint.restoreLatest();
    expect(session.world.store.has('original')).toBe(true);
    expect(session.world.store.has('later')).toBe(false);
  } finally {cleanup(session,ground);}
});

it('rejects stale concurrent head publication without replacing the newer head', async () => {
  const heads=new MemoryNativeOverlayHeadStore();
  const ref = character => ({kind:'native-overlay',hash:character.repeat(64),bytes:100});
  const first=ref('a'), second=ref('b');
  await heads.publish(null,first);
  await expect(heads.publish(null,second)).rejects.toMatchObject({code:'NATIVE_OVERLAY_HEAD_CONFLICT'});
  expect(await heads.read()).toEqual(first);
  await heads.publish(first,second);
  await expect(heads.publish(first,first)).rejects.toMatchObject({code:'NATIVE_OVERLAY_HEAD_CONFLICT'});
  expect(await heads.read()).toEqual(second);
});

it('never changes live scene when the newest head points to damaged data', async () => {
  const blocks=new MemoryBlocks(),storage=new WorldStorage(blocks),heads=new MemoryNativeOverlayHeadStore();
  const {scene,ground}=host(),session=await attach(scene);
  try {
    const checkpoint=createNativeOverlayCheckpoint(session.scene,storage,heads);
    await session.scene.addModel({id:'keep_cup',asset:'builtin://cup',position:[0,1,0]});
    const head=await checkpoint.saveLatest();
    blocks.blocks.set(head.hash,new Uint8Array([1,2,3]));
    await expect(checkpoint.restoreLatest()).rejects.toThrow();
    expect(session.world.store.has('keep_cup')).toBe(true);
  } finally {cleanup(session,ground);}
});
