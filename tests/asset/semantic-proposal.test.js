import { it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { AssetCompiler } from '../../modules/asset/production/compiler/AssetCompiler.js';
import { compileRecipeGeometry } from '../../modules/asset/production/AssetRecipe.js';
import { normalizeWorldIR } from '../../modules/world/spec/WorldIR.js';
import { compileWorldBehaviorBundle, admitWorldBehavior } from '../../modules/world/compiler/WorldBehaviorCompiler.js';

const compiler = () => new AssetCompiler({store:{put:async()=>{}},version:'semantic-proposal-test'});

it('proposes carry for an unknown compact mesh but never fabricates physics or verified grasp',async()=>{
  const {bytes} = await compileRecipeGeometry({
    schema:'agentscape.asset-recipe',schemaVersion:1,id:'unknown_prop',
    parts:[{id:'body',geometry:{type:'box',size:[.2,.2,.2]}}]
  });
  const result = await compiler().proposeInteraction({bytes,sourceName:'random_opaque.glb'});
  expect(result.physics.body).toBeNull();
  expect(result.physics.mass).toBeNull();
  expect(result.operations).toEqual(expect.arrayContaining([
    expect.objectContaining({action:'pickup',executable:false,physicsVerified:false,requires:'reviewed-dynamic-body-mass-and-carry-geometry'}),
    expect.objectContaining({action:'place',executable:false,physicsVerified:false})
  ]));
  expect(result.missing).toContain('review-confirmation');
});

it('offers joint-backed semantic action suggestions while keeping all actions nonexecutable',async()=>{
  const bytes = new Uint8Array(await readFile('public/assets/cabinet.glb'));
  const result = await compiler().proposeInteraction({bytes,sourceName:'untitled_machine.glb'});
  expect(result.operations.some(x=>x.action==='open'&&x.executable===false&&x.physicsVerified===false)).toBe(true);
  expect(result.operations.some(x=>x.action==='close'&&x.requires==='semantic-review-and-verified-joint-target')).toBe(true);
  expect(result.parts.every(part=>part.executable===false)).toBe(true);
});

it('admits generic physical carry in WorldIR without a whitelist and rejects explicit opt-out',()=>{
  const world = normalizeWorldIR({
    schema:'agentscape.world-ir',schemaVersion:1,revision:{id:'carry-unknown'},
    provenance:{source:'test'},intent:{name:'Generic physical carry'},
    entities:[{id:'new_object',asset:{assetId:'unclassified'},capabilityIntent:['pickup']}],
    interactions:[{id:'pickup-unknown',targetId:'new_object',capability:'pickup'}]
  });
  const bundle = compileWorldBehaviorBundle(world);
  const generic = {id:'unclassified',type:'prop',source:{kind:'builtin'},actions:[],
    physics:{body:'dynamic',mass:1,colliders:[{shape:'box',halfExtents:[.12,.12,.12]}]}};
  const resolve = () => generic;
  const assets=[{id:'new_object',assetRef:{assetId:'unclassified'}}];
  expect(admitWorldBehavior(bundle,{resolvedAssets:assets,getManifest:resolve})).toEqual({status:'ready',issues:[]});
  generic.physics.carryable = false;
  expect(admitWorldBehavior(bundle,{resolvedAssets:assets,getManifest:resolve})).toMatchObject({status:'rejected'});
});

it('a carry opt-out must not disable an unrelated mechanical open capability',()=>{
  const world = normalizeWorldIR({schema:'agentscape.world-ir',schemaVersion:1,
    revision:{id:'door-optout'},provenance:{source:'test'},intent:{name:'Door is not movable by hand'},
    entities:[{id:'machine',asset:{assetId:'secure_machine'}}],
    interactions:[{id:'operate',targetId:'machine',capability:'open'}]});
  const manifest={actions:['open'],physics:{body:'fixed',carryable:false}};
  expect(admitWorldBehavior(compileWorldBehaviorBundle(world),{
    resolvedAssets:[{id:'machine',assetRef:{assetId:'secure_machine'}}],getManifest:()=>manifest
  })).toMatchObject({status:'ready',issues:[]});
});
