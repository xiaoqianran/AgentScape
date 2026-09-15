import { describe, expect, it, vi } from 'vitest';
import { createMagicCabin } from '../../modules/world/content/magicCabin.js';
import { cabinCanvasHost } from '../helpers/cabinCanvasHost.js';
import { PhysicsSystem } from '../../modules/world/runtime/systems/PhysicsSystem.js';
import { RapierPhysicsBackend } from '../../modules/world/runtime/physics/RapierPhysicsBackend.js';
import { createRecastNavigationSystem } from '../helpers/createRecastNavigationSystem.js';
import { ObjectStore } from '../../modules/world/runtime/ObjectStore.js';

describe('migrated original magic cabin',()=>{
  it('constructs the original two-storey geometry and runs every interaction without the original page',()=>{
    const host=cabinCanvasHost();
    const cabin=createMagicCabin(host);
    try {
      expect(cabin.interactions.length).toBeGreaterThan(70);
      expect(cabin.colliders.length).toBeGreaterThan(50);
      const meshes=[];
      cabin.root.traverse(node=>{if(node.isMesh) meshes.push(node);});
      expect(meshes.length).toBeGreaterThan(1000);
      expect(meshes.some(mesh=>mesh.material?.isShaderMaterial)).toBe(false);
      expect(cabin.interactions.some(item=>item.label.includes('阁楼窗'))).toBe(true);
      for(let i=0;i<5;i++) cabin.step(1/60);
      const failures=[];
      for(const item of cabin.interactions) {
        try { item.activate(); for(let i=0;i<4;i++) cabin.step(1/60); }
        catch(error) { failures.push(`${item.label}: ${error.message}`); }
      }
      for(let i=0;i<120;i++) cabin.step(1/60);
      expect(failures).toEqual([]);
      host.editorHost.querySelector('#signInput').value='我们的世界';
      host.editorHost.querySelector('#signOk').listeners.get('click')();
      const saved=cabin.snapshot();
      expect(saved.text.sign).toBe('我们的世界');
      cabin.setCutaway(false);
      cabin.restore(saved);
      expect(cabin.snapshot()).toEqual(saved);
      for(const mesh of meshes) expect(mesh.position.toArray().every(Number.isFinite)).toBe(true);
    } finally {cabin.dispose();}
  },30000);

  it('admits its structural colliders and animated doors to production Rapier',async()=>{
    const cabin=createMagicCabin(cabinCanvasHost());
    const physics=new PhysicsSystem({backend:new RapierPhysicsBackend()});
    await physics.init();
    try {
      physics.addEnvironment(cabin.colliders,{id:cabin.id});
      cabin.step(1/60,{physics});
      const door=cabin.interactions.find(item=>item.label.includes('大门'));
      const before=door.object.rotation.y;
      door.activate();
      for(let i=0;i<90;i++) cabin.step(1/60,{physics});
      expect(Math.abs(door.object.rotation.y-before)).toBeGreaterThan(.5);
      let count=0;
      physics.world.forEachCollider(()=>count++);
      expect(count).toBeGreaterThan(cabin.colliders.length);
      const probe={physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.1,.1,.1]}]}};
      expect(physics.manifestPoseClear(probe,[2,3.08,0]).clear).toBe(false);
    } finally {physics.dispose();cabin.dispose();}
  },30000);

  it('preserves uploaded image data URLs and restores editable content',()=>{
    const urls=[];
    vi.stubGlobal('Image',class {width=16;height=16;set src(value){urls.push(value);this.onload?.();}});
    const host=cabinCanvasHost();
    const cabin=createMagicCabin(host);
    try {
      const data='data:image/png;base64,TEST';
      host.editorHost.querySelector('#picInput').value=data;
      host.editorHost.querySelector('#picOk').listeners.get('click')();
      expect(urls).toEqual([data]);
      expect(cabin.snapshot().text.picture).toBe(data);
    } finally {cabin.dispose();vi.unstubAllGlobals();}
  });

  it('opens the production navigation route into the house when the front door opens',async()=>{
    const cabin=createMagicCabin(cabinCanvasHost());
    const navigation=createRecastNavigationSystem({store:new ObjectStore(),environmentRoots:[cabin.root]});
    try {
      expect((await navigation.findPath([0,0,6],[0,0,2])).reachable).toBe(false);
      cabin.interactions.find(item=>item.label.includes('大门')).activate();
      for(let i=0;i<180;i++) cabin.step(1/60);
      navigation.invalidate('door-opened');
      expect((await navigation.findPath([0,0,6],[0,0,2])).reachable).toBe(true);
      expect((await navigation.findPath([0,0,6],[-2,3.12,0])).reachable).toBe(true);
      expect((await navigation.findPath([-2,3.12,0],[0,0,6])).reachable).toBe(true);
      expect((await navigation.findPath([2,3.12,-1],[-2,3.12,0])).reachable).toBe(true);
    } finally {navigation.dispose();cabin.dispose();}
  },30000);
});
