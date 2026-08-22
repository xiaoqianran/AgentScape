import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { orderParts } from '../src/assets/parts.js';
import { validateAssetManifest } from '../src/assets/schema.js';
import { ObjectStore } from '../src/runtime/ObjectStore.js';
import { PhysicsSystem } from '../src/runtime/systems/PhysicsSystem.js';

const joint = (type, axis, limits) => ({ type, axis, limits, parentAnchor:[0,0,0], childAnchor:[0,0,0], motor:{stiffness:80,damping:12} });
const collider = { shape:'box', halfExtents:[.1,.1,.1] };

describe('part hierarchy', () => {
  it('orders parents before children and rejects cycles', () => {
    const parts = { handle:{node:'Handle',parent:'door'}, door:{node:'Door'} };
    expect(orderParts(parts).map(([name])=>name)).toEqual(['door','handle']);
    expect(() => orderParts({a:{node:'A',parent:'b'},b:{node:'B',parent:'a'}})).toThrow(/cycle/);
  });

  it('rejects unknown parent parts in manifests', () => {
    const manifest={id:'x',type:'x',source:{kind:'builtin'},actions:[],parts:{child:{node:'Child',parent:'missing'}}};
    expect(() => validateAssetManifest(manifest)).toThrow(/Unknown parent part/);
  });

  it('connects nested parts to their declared parent body', async () => {
    const manifest={
      id:'nested',type:'cabinet',source:{kind:'builtin'},actions:['open','close'],physics:{body:'fixed',colliders:[collider]},
      parts:{
        door:{node:'Door',actions:['open','close'],targets:{open:-.5,close:0},physics:{body:'dynamic',colliders:[collider]},joint:joint('revolute',[0,1,0],[-.5,0])},
        slider:{node:'Slider',parent:'door',actions:[],physics:{body:'dynamic',colliders:[collider]},joint:joint('prismatic',[1,0,0],[0,.2])}
      }
    };
    validateAssetManifest(manifest);
    const root=new THREE.Group(); const door=new THREE.Group(); door.name='Door'; const slider=new THREE.Group(); slider.name='Slider'; door.add(slider); root.add(door); root.updateMatrixWorld(true);
    const store=new ObjectStore(); store.add('n',{id:'n',assetId:'nested',object:root,manifest,state:{}});
    const physics=new PhysicsSystem(); await physics.init(); physics.attach('n',manifest,root);
    const entry=physics.entries.get('n');
    expect(entry.parts.get('slider').parentName).toBe('door');
    expect(entry.parts.get('slider').joint.body1().handle).toBe(entry.parts.get('door').body.handle);
    physics.dispose();
  });
});
