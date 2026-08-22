import { expect, it, vi } from 'vitest';
import { SkillRegistry } from '../src/skills/SkillRegistry.js';
import { registerCoreSkills } from '../src/skills/registerCoreSkills.js';

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
