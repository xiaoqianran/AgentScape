import * as THREE from 'three';
import { expect, it } from 'vitest';
import { ArticulationVerifier } from '../src/validation/ArticulationVerifier.js';

const manifest = {
  id:'slider', type:'drawer', source:{kind:'builtin'}, actions:['open','close'],
  physics:{ body:'fixed', colliders:[{shape:'box',halfExtents:[.5,.5,.5]}] },
  parts:{
    drawer:{
      node:'Drawer', semantic:'drawer', actions:['open','close'], targets:{open:.5,close:0},
      physics:{body:'dynamic',mass:1,colliders:[{shape:'box',halfExtents:[.2,.1,.3]}]},
      joint:{type:'prismatic',axis:[1,0,0],limits:[0,.5],parentAnchor:[0,0,0],childAnchor:[0,0,0],motor:{stiffness:80,damping:12}}
    }
  }
};

it('verifies a prismatic part by executing both action targets in an isolated Rapier world', async () => {
  const assets = {
    getManifest:()=>manifest,
    instantiate:async()=>{
      const root = new THREE.Group();
      const drawer = new THREE.Group(); drawer.name='Drawer'; root.add(drawer); root.updateMatrixWorld(true);
      return { object:root, manifest };
    }
  };
  const report = await new ArticulationVerifier({ assets, steps:240 }).verify('slider');
  expect(report.ok).toBe(true);
  expect(report.parts[0].jointType).toBe('prismatic');
  expect(report.parts[0].actions).toHaveLength(2);
  expect(report.parts[0].actions.every((action) => action.moved && action.finite)).toBe(true);
});
