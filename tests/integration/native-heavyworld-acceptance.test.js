import { it, expect } from 'vitest';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createHeadlessGLTFLoader } from '../../apps/mcp-server/HeadlessGLTFLoader.js';
import { attachNativeScene } from '../../application/native-scene/NativeSceneHost.js';
import { WorldStorage } from '../../application/scene/WorldStorage.js';
import { createAssetModule } from '../../modules/asset/AssetModule.js';
import { installHeadlessAssetIO } from '../../apps/mcp-server/HeadlessAssetIO.js';
import { industrialCabinetDraft } from '../../modules/asset/model/MechanicalAssetDraft.js';
import { MemoryNativeOverlayHeadStore, createNativeOverlayCheckpoint } from '../../application/native-scene/NativeOverlayCheckpoint.js';

class MemoryBlocks {
  blocks = new Map();
  async write(hash, bytes) {
    if (!this.blocks.has(hash)) this.blocks.set(hash, bytes.slice());
  }
  async read(hash, size) {
    const bytes = this.blocks.get(hash);
    if (!bytes || bytes.length !== size) throw new Error('MISSING_BLOCK');
    return bytes.slice();
  }
}
const native = () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(150, .2, 150), new THREE.MeshStandardMaterial());
  floor.position.y = -.1;
  floor.name = 'NativeFloor';
  scene.add(floor);
  const renderer = { render() {}, dispose() { throw new Error('HOST_RENDERER_DISPOSED'); }, extensions: { has: () => false } };
  return { scene, camera, renderer, floor };
};
const attach = host => attachNativeScene({
  scene:host.scene, camera:host.camera, renderer:host.renderer,
  autoStart:false, hostProjectId:'native-heavy-acceptance', hostRevision:'geometry-v1',
  walkableMesh:host.floor
});

it('keeps actual GLB geometry, host renderer and all native meshes untouched across repeated attachment cycles', async () => {
  const host = native();
  const loader = createHeadlessGLTFLoader();
  const bytes = new Uint8Array(await readFile(new URL('../../public/assets/cabinet.glb', import.meta.url)));
  const glb = await loader.loadBytes(bytes);
  const meshes = [];
  glb.traverse(object => { if (object.isMesh) meshes.push(object); });
  expect(meshes.length).toBeGreaterThanOrEqual(2);
  const originals = meshes.map(item => [item.geometry, item.material]);
  for (let i = 0; i < 50; i++) {
    const clone = glb.clone(true);
    clone.position.set((i % 10) * 5, 0, Math.floor(i / 10) * 5);
    host.scene.add(clone);
  }
  const before = [...host.scene.children];
  const allMeshes = [];
  host.scene.traverse(obj => { if (obj !== host.floor && obj.isMesh) allMeshes.push(obj); });
  expect(allMeshes.length).toBeGreaterThanOrEqual(100);
  const stamp = performance.now();
  for (let i = 0; i < 4; i++) {
    const session = await attachNativeScene({
      ...host, autoStart:false,
      hostProjectId:'native-heavy-acceptance', hostRevision:'geometry-v1',
      walkableMesh:host.floor, staticMeshes:allMeshes.slice(0, 16)
    });
    expect(session.scene.capabilities.environmentColliders).toBe(17);
    session.scene.step();
    session.close();
    expect(host.scene.children).toEqual(before);
    expect(session.world.scene.parent).toBeNull();
    expect(session.world.physics.entries.size).toBe(0);
  }
  console.info('[native-heavyworld]',JSON.stringify({
    mode:'host-glb-lifecycle',fixtureBytes:bytes.byteLength,nativeMeshCount:allMeshes.length,
    staticColliders:17,cycles:4,elapsedMs:Math.round(performance.now()-stamp)
  }));
  meshes.forEach((item,index) => {
    expect(item.geometry).toBe(originals[index][0]);
    expect(item.material).toBe(originals[index][1]);
  });
  host.floor.geometry.dispose();host.floor.material.dispose();
},60000);

/** Produce a valid, self-contained glTF 2.0 binary with 64,800 triangles. */
function makeHighPolyGlb(cells = 180) {
  const side = cells + 1, positions = new Float32Array(side * side * 3);
  for (let z = 0; z < side; z++) for (let x = 0; x < side; x++) {
    const i = (z * side + x) * 3;
    positions[i] = x * .1; positions[i + 1] = .2 * Math.sin(x / 8) * Math.cos(z / 9); positions[i + 2] = z * .1;
  }
  const indices = new Uint32Array(cells * cells * 6);
  let n = 0;
  for (let z = 0; z < cells; z++) for (let x = 0; x < cells; x++) {
    const a = z * side + x, b = a + 1, c = a + side, d = c + 1;
    indices[n++] = a; indices[n++] = c; indices[n++] = b;
    indices[n++] = b; indices[n++] = c; indices[n++] = d;
  }
  const pbytes = Buffer.from(positions.buffer), ibytes = Buffer.from(indices.buffer);
  const json = {
    asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],
    meshes:[{primitives:[{attributes:{POSITION:0},indices:1}]}],
    buffers:[{byteLength:pbytes.length+ibytes.length}],
    bufferViews:[{buffer:0,byteOffset:0,byteLength:pbytes.length,target:34962},
      {buffer:0,byteOffset:pbytes.length,byteLength:ibytes.length,target:34963}],
    accessors:[{bufferView:0,componentType:5126,count:side*side,type:'VEC3',
      min:[0,-.2,0],max:[cells*.1,.2,cells*.1]},
      {bufferView:1,componentType:5125,count:indices.length,type:'SCALAR'}]
  };
  const raw = Buffer.from(JSON.stringify(json));
  const jsonLen = Math.ceil(raw.length/4)*4;
  const output=Buffer.alloc(12+8+jsonLen+8+pbytes.length+ibytes.length);
  output.writeUInt32LE(0x46546c67,0);output.writeUInt32LE(2,4);output.writeUInt32LE(output.length,8);
  output.writeUInt32LE(jsonLen,12);output.writeUInt32LE(0x4e4f534a,16);
  raw.copy(output,20);output.fill(0x20,20+raw.length,20+jsonLen);
  const at=20+jsonLen;output.writeUInt32LE(pbytes.length+ibytes.length,at);
  output.writeUInt32LE(0x004e4942,at+4);
  pbytes.copy(output,at+8);ibytes.copy(output,at+8+pbytes.length);
  return new Uint8Array(output);
}

it('parses a >1 MiB high-polygon GLB and registers its true static triangles without taking host ownership',async()=>{
  const host=native(), loader=createHeadlessGLTFLoader();
  const bytes=makeHighPolyGlb();
  expect(bytes.byteLength).toBeGreaterThan(1_000_000);
  const model=await loader.loadBytes(bytes);
  const meshes=[];
  model.traverse(item=>{if(item.isMesh)meshes.push(item);});
  expect(meshes).toHaveLength(1);
  const terrain=meshes[0],geometry=terrain.geometry;
  expect(geometry.getAttribute('position').count).toBe(181*181);
  host.scene.add(model);
  const before=[...host.scene.children],at=performance.now();
  const session=await attachNativeScene({
    ...host,autoStart:false,hostProjectId:'native-heavy-acceptance',hostRevision:'geometry-v1',
    walkableMesh:host.floor,staticMeshes:[terrain]
  });
  try {
    expect(session.scene.capabilities.environmentColliders).toBe(2);
    session.scene.step();
    expect(session.world.physics).toBeTruthy();
    console.info('[native-heavyworld]',JSON.stringify({
      mode:'high-poly-glb',glbBytes:bytes.byteLength,vertices:181*181,
      triangles:180*180*2,registerMs:Math.round(performance.now()-at)
    }));
  } finally {
    session.close();
    expect(host.scene.children).toEqual(before);
    expect(terrain.geometry).toBe(geometry);
    geometry.dispose();
    if(Array.isArray(terrain.material))terrain.material.forEach(material=>material.dispose());
    else terrain.material.dispose();
    host.floor.geometry.dispose();host.floor.material.dispose();
  }
},60000);
it('saves and restores over one thousand independently addressable physical objects using bounded activation and immutable blocks', async () => {
  const host = native(), backend = new MemoryBlocks(), storage = new WorldStorage(backend);
  const heads = new MemoryNativeOverlayHeadStore();
  const session = await attach(host);
  const TOTAL=1024, ACTIVE=128;
  const timings={};
  let root;
  try {
    let started = performance.now();
    for (let i=0;i<TOTAL;i++) {
      await session.world.spawn('cup', {
        id:'cup_'+i, position:[(i%20)*2,1+Math.floor(i/20)*.1,Math.floor(i/20)*2],
        active:i<ACTIVE
      });
    }
    timings.createMs=Math.round(performance.now()-started);
    expect(session.world.store.size).toBe(TOTAL);
    started=performance.now();
    const checkpoint=createNativeOverlayCheckpoint(session.scene,storage,heads);
    root=await checkpoint.saveLatest();
    timings.saveAndVerifyMs=Math.round(performance.now()-started);
    expect(root.kind).toBe('native-overlay');
    expect((await heads.read())).toEqual(root);
    const count=backend.blocks.size;
    expect(count).toBeGreaterThan(3);
    const nextRoot = await checkpoint.saveLatest();
    expect(await heads.read()).toEqual(nextRoot);
    const [first, second] = await Promise.all([storage.node(root), storage.node(nextRoot)]);
    const [originalWorld, nextWorld] = await Promise.all([storage.node(first.data.world), storage.node(second.data.world)]);
    // Save timestamps can change root hashes; unchanged entity/asset pages stay deduplicated.
    expect(nextWorld.data.entities).toEqual(originalWorld.data.entities);
    expect(nextWorld.data.assets).toEqual(originalWorld.data.assets);
    expect(backend.blocks.size - count).toBeLessThanOrEqual(3);
    root = nextRoot;
    timings.blockCount=backend.blocks.size;

    const prepared=await session.scene.prepareOverlay(storage,root,{maxActiveEntities:ACTIVE});
    expect(prepared.summary).toMatchObject({entities:TOTAL,activeEntities:ACTIVE,dormantEntities:TOTAL-ACTIVE});
    prepared.dispose();
    const snapshot=JSON.stringify(session.world.snapshot());
    const originalRead=backend.read.bind(backend);
    let reads=0;
    backend.read=async(...args)=>{ if (++reads===5) throw new Error('INJECTED_BLOCK_READ_FAILED'); return originalRead(...args); };
    await expect(session.scene.prepareOverlay(storage,root)).rejects.toMatchObject({code:'WORLD_NODE_INVALID'});
    backend.read=originalRead;
    expect(JSON.stringify(session.world.snapshot())).toBe(snapshot);

    await session.world.spawn('chair',{id:'not_in_saved_overlay',position:[0,0,0]});
    started=performance.now();
    await session.scene.restoreOverlay(storage,root,{maxActiveEntities:ACTIVE});
    timings.restoreMs=Math.round(performance.now()-started);
    expect(session.world.store.size).toBe(TOTAL);
    expect(session.world.store.has('not_in_saved_overlay')).toBe(false);
    expect(session.world.store.get('cup_0').active).toBe(true);
    expect(session.world.store.get('cup_'+(TOTAL-1)).active).toBe(false);
    expect(session.world.physics.entries.size).toBeLessThanOrEqual(ACTIVE);
    expect(session.world.store.get('cup_157').id).toBe('cup_157');
    console.info('[native-heavyworld]',JSON.stringify({
      mode:'1024-entity-overlay',entities:TOTAL,active:ACTIVE,
      ...timings,rootBytes:root.bytes
    }));
  } finally {
    session.close();
    expect(host.scene.children).toEqual([host.floor]);
    host.floor.geometry.dispose();host.floor.material.dispose();
  }
},120000);

it('restores real compiled multi-joint GLB assets, not only builtin meshes, through native overlay',async()=>{
  installHeadlessAssetIO();
  const host=native(), storage=new WorldStorage(new MemoryBlocks());
  const assets=createAssetModule({
    gltfLoader:createHeadlessGLTFLoader(),manifestStore:null,libraryStore:null
  });
  const session=await attachNativeScene({
    ...host,assetModule:assets,autoStart:false,
    hostProjectId:'native-heavy-acceptance',hostRevision:'geometry-v1',
    walkableMesh:host.floor
  });
  try {
    const imported=await assets.importMechanicalDraft(industrialCabinetDraft());
    expect(imported.manifest.parts).toHaveProperty('left_door');
    const id='asset://sha256/'+imported.manifest.id.slice('asset_'.length);
    await session.scene.addModel({id:'native_machine',asset:id,position:[0,0,-2]});
    expect(session.world.physics.entries.get('native_machine').parts.size).toBe(4);
    const root=await session.scene.saveOverlay(storage);
    const prepared=await session.scene.prepareOverlay(storage,root,{
      gltfLoader:createHeadlessGLTFLoader()
    });
    try {
      expect(prepared.summary.entities).toBe(1);
      await session.world.spawn('chair',{id:'temporary',position:[0,0,1]});
      await prepared.commit();
    } finally {prepared.dispose();}
    expect(session.world.store.has('temporary')).toBe(false);
    expect(session.world.store.get('native_machine').manifest.parts).toHaveProperty('upper_drawer');
    expect(session.world.physics.entries.get('native_machine').parts.size).toBe(4);
  } finally {
    session.close();
    expect(host.scene.children).toEqual([host.floor]);
    host.floor.geometry.dispose();host.floor.material.dispose();
  }
},90000);