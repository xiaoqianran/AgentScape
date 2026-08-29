import { expect, it, vi } from 'vitest';
import { SkillRegistry } from '../agent/skills/SkillRegistry.js';
import { registerCoreSkills } from '../agent/skills/registerCoreSkills.js';

it('writes articulation verification back and promotes readiness when it was the last advisory', async () => {
  const manifest = {
    id:'cab', type:'cabinet', source:{kind:'builtin'}, actions:['open'],
    parts:{door:{node:'Door',actions:['open'],targets:{open:-1},physics:{body:'dynamic',colliders:[{shape:'box',halfExtents:[1,1,1]}]},joint:{type:'revolute',axis:[0,1,0],limits:[-1,0]}}},
    compiler:{ quality:{ status:'provisional', hard:[], advisory:[{code:'ARTICULATION_UNVERIFIED'}] } }
  };
  let current = structuredClone(manifest);
  const runtime = {
    articulationVerifier:{ verify:vi.fn(async()=>({ok:true,assetId:'cab',tested:1,parts:[]})) },
    assets:{
      getManifest:()=>current,
      registerManifest:(next)=>{ current=structuredClone(next); }
    },
    events:{emit:vi.fn()}
  };
  const registry = registerCoreSkills(new SkillRegistry({ runtime }), runtime);
  const result = await registry.get('verifyAssetArticulation').handler({assetId:'cab'});
  expect(result.readiness).toBe('ready');
  expect(current.verification.articulation.ok).toBe(true);
  expect(current.compiler.quality.status).toBe('ready');
  expect(current.compiler.quality.advisory).toEqual([]);
});

it('persists staged motion verification failures and keeps the asset provisional', async () => {
  const manifest={
    id:'cab',type:'cabinet',source:{kind:'builtin'},actions:['open'],
    parts:{door:{node:'Door',actions:['open'],targets:{open:-1},physics:{body:'dynamic',colliders:[{shape:'box',halfExtents:[1,1,1]}]},joint:{type:'revolute',axis:[0,1,0],limits:[-1,0]}}},
    compiler:{quality:{status:'provisional',hard:[],advisory:[{code:'ARTICULATION_UNVERIFIED'}]}}
  };
  const verification={
    ok:false,assetId:'cab',tested:1,
    parts:[{part:'door',ok:false,actions:[{action:'open',ok:false,failures:[{stage:'EXECUTION',code:'COLLISION_REGRESSION'}]}]}]
  };
  let current=structuredClone(manifest);
  const runtime={
    articulationVerifier:{verify:vi.fn(async()=>verification)},
    assets:{getManifest:()=>current,registerManifest:(next)=>{current=structuredClone(next);}},
    events:{emit:vi.fn()}
  };
  const registry=registerCoreSkills(new SkillRegistry({runtime}),runtime);
  const result=await registry.get('verifyAssetArticulation').handler({assetId:'cab'});
  expect(result.readiness).toBe('provisional');
  expect(current.verification.articulation.parts[0].actions[0].failures[0]).toEqual({stage:'EXECUTION',code:'COLLISION_REGRESSION'});
  expect(current.compiler.quality.advisory.map((item)=>item.code)).toEqual(['ARTICULATION_VERIFICATION_FAILED']);
});


it('syncs only verification metadata into already-spawned records after verification', async () => {
  const manifest={
    id:'cab',type:'cabinet',source:{kind:'compiled',key:'cab'},actions:['open'],
    parts:{door:{node:'Door',actions:['open'],targets:{open:-1},physics:{body:'dynamic',colliders:[{shape:'box',halfExtents:[1,1,1]}]},joint:{type:'revolute',axis:[0,1,0],limits:[-1,0]}}},
    compiler:{quality:{status:'provisional',hard:[],advisory:[{code:'ARTICULATION_UNVERIFIED'}]}}
  };
  let current=structuredClone(manifest);
  const liveManifest=structuredClone(manifest);
  const liveObject={userData:{manifest:structuredClone(manifest)}};
  const runtime={
    articulationVerifier:{verify:vi.fn(async()=>({ok:true,assetId:'cab',tested:1,parts:[{part:'door',ok:true,actions:[{action:'open',ok:true}],reversibility:{ok:true}}]}))},
    assets:{getManifest:()=>current,registerManifest:(next)=>{current=structuredClone(next);}},
    store:{values:()=>[{assetId:'cab',manifest:liveManifest,object:liveObject}]},
    events:{emit:vi.fn()}
  };
  const registry=registerCoreSkills(new SkillRegistry({runtime}),runtime);
  await registry.get('verifyAssetArticulation').handler({assetId:'cab'});
  expect(liveManifest.verification.articulation.ok).toBe(true);
  expect(liveManifest.compiler.quality.status).toBe('ready');
  expect(liveObject.userData.manifest.verification.articulation.ok).toBe(true);
  expect(liveManifest.parts).toEqual(manifest.parts);
});


it('runtime articulation success removes only runtime blocker and preserves provider provisional admission', async () => {
  const manifest={
    id:'cab',type:'cabinet',source:{kind:'compiled',key:'cab'},actions:['open'],
    parts:{door:{node:'Door',actions:['open'],targets:{open:-1},physics:{body:'dynamic',colliders:[{shape:'box',halfExtents:[1,1,1]}]},joint:{type:'revolute',axis:[0,1,0],limits:[-1,0]}}},
    provenance:{provider:'embodiedgen',admission:{status:'provisional',reasons:['UNVERIFIED_PROVIDER_SEMANTICS']}},
    compiler:{quality:{status:'provisional',hard:[],advisory:[{code:'ARTICULATION_UNVERIFIED'}]}}
  };
  let current=structuredClone(manifest);
  const runtime={
    articulationVerifier:{verify:vi.fn(async()=>({ok:true,assetId:'cab',tested:1,parts:[]}))},
    assets:{getManifest:()=>current,registerManifest:(next)=>{current=structuredClone(next);}},
    events:{emit:vi.fn()}
  };
  const registry=registerCoreSkills(new SkillRegistry({runtime}),runtime);
  const result=await registry.get('verifyAssetArticulation').handler({assetId:'cab'});
  expect(current.compiler.quality.status).toBe('ready');
  expect(result.readiness).toBe('provisional');
  expect(result.admission).toMatchObject({
    status:'provisional',reasons:['UNVERIFIED_PROVIDER_SEMANTICS'],
    layers:{provider:{status:'provisional'},compiler:{status:'ready'},runtime:{status:'ready'}}
  });
});
