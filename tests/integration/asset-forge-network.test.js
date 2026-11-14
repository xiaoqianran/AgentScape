import {it,expect} from 'vitest';
import {createSession} from '../../application/createSession.js';
import {createBlankWorld} from '../../modules/world/content/blankWorld.js';
import {createAssetModule} from '../../modules/asset/AssetModule.js';
import {createHeadlessGLTFLoader} from '../../apps/mcp-server/HeadlessGLTFLoader.js';
import {installHeadlessAssetIO} from '../../apps/mcp-server/HeadlessAssetIO.js';
import {industrialCabinetDraft} from '../../modules/asset/model/MechanicalAssetDraft.js';

const material=name=>({name,densityKgM3:1000,specificHeatJkgK:800,provenance:'authored'});
const thermal=(t,power=0)=>({
  mass:{mode:'explicit',massKg:3},initialTemperatureK:t,
  heatPowerW:power,ambientTemperatureK:293.15,
  ambientConductanceWPerK:0,contactConductanceWPerK:0
});
const draft=()=>{
  const input=industrialCabinetDraft();
  input.simulation={schema:'agentscape.simulation-profile',schemaVersion:2,model:'thermal-network-v1',
    nodes:[
      {id:'root',partName:'$root',material:material('steel-frame'),thermal:thermal(320)},
      {id:'left_door',partName:'left_door',material:material('composite-door'),thermal:thermal(280)}
    ],
    links:[{from:'root',to:'left_door',conductanceWPerK:18}]
  };
  return input;
};

it('builds multi-material articulated assets, runs Scene thermal experiments and restores v2 state',async()=>{
  installHeadlessAssetIO();
  const session=createSession(null,{
    assetModule:createAssetModule({gltfLoader:createHeadlessGLTFLoader()}),
    environmentFactory:()=>createBlankWorld({id:'asset-forge-network-world'})
  });
  await session.world.init();
  const {world,scene}=session;
  try{
    const imported=await world.assetModule.importMechanicalDraft(draft());
    expect(imported.manifest.simulation.schemaVersion).toBe(2);
    expect(imported.manifest.parts).toHaveProperty('left_door');
    const asset='asset://sha256/'+imported.manifest.id.slice('asset_'.length);
    await scene.addModel({id:'machine_a',asset,position:[0,0,0]});
    await scene.addModel({id:'machine_b',asset,position:[5,0,0]});
    const initial=await scene.thermalExperiment({operation:'list'});
    expect(initial.value).toEqual(expect.arrayContaining([
      expect.objectContaining({id:'machine_a',nodeCount:2}),
      expect.objectContaining({id:'machine_b',nodeCount:2})
    ]));
    const inspect=(await scene.thermalExperiment({operation:'inspect',targetId:'machine_a'})).value;
    expect(inspect.nodes.map(node=>node.partName)).toEqual(['$root','left_door']);
    expect(inspect.nodes.map(node=>node.material.name)).toEqual(['steel-frame','composite-door']);
    expect(inspect.nodes[0].state.temperatureK).toBe(320);
    expect(inspect.nodes[1].state.temperatureK).toBe(280);

    const heating=await scene.thermalExperiment({
      operation:'setPower',targetId:'machine_a',nodeId:'left_door',powerW:4000
    });
    expect(heating.value.heatPowerW).toBe(4000);
    const beforeTick=world.simulation.tick;
    const run=await scene.thermalExperiment({operation:'run',durationSec:2});
    expect(run.value).toMatchObject({frames:120,elapsedSec:2});
    expect(world.simulation.tick-beforeTick).toBe(120);
    const series=(await scene.thermalExperiment({
      operation:'series',targetId:'machine_a',limit:30
    })).value;
    expect(series.schema).toBe('agentscape.thermal-series');
    expect(series.nodes).toHaveLength(2);
    expect(series.samples.length).toBeGreaterThan(3);
    expect(series.samples.at(-1).nodes.left_door.temperatureK).toBeGreaterThan(280);
    expect(series.samples.at(-1).nodes.root.temperatureK).toBeLessThan(320);
    expect(world.thermal.readState('machine_b','left_door').heatPowerW).toBe(0);
    // The unpowered machine still warms through its own internal root-to-door
    // link; it must not inherit the external power assigned to machine_a.
    expect(world.thermal.readState('machine_b','left_door').temperatureK).toBeGreaterThan(280);
    expect(world.thermal.readState('machine_a','left_door').temperatureK)
      .toBeGreaterThan(world.thermal.readState('machine_b','left_door').temperatureK);

    const saved=world.serialize();
    const persisted=saved.objects.find(obj=>obj.id==='machine_a').simulation;
    expect(persisted).toMatchObject({
      schema:'agentscape.thermal-state',schemaVersion:2,
      nodes:expect.arrayContaining([expect.objectContaining({id:'left_door',heatPowerW:4000})])
    });
    const invalid=structuredClone(saved);
    invalid.objects.find(obj=>obj.id==='machine_a').simulation.nodes.pop();
    const beforeInvalid=world.thermal.readState('machine_a','left_door');
    await expect(world.restore(invalid)).rejects.toThrow('THERMAL_STATE_NODE_MISMATCH');
    expect(world.thermal.readState('machine_a','left_door')).toEqual(beforeInvalid);

    await scene.thermalExperiment({operation:'setPower',targetId:'machine_a',nodeId:'left_door',powerW:0});
    await world.restore(saved);
    expect(world.thermal.readState('machine_a','left_door').heatPowerW).toBe(4000);
    expect(world.thermal.readState('machine_a','left_door').temperatureK).toBeCloseTo(beforeInvalid.temperatureK,9);
    expect(world.thermal.series('machine_a').samples).toHaveLength(1);
    // Studio generated placed-object IDs can exceed the declarative project ID
    // limit; the live-world thermal API must accept those existing identities.
    const longId='asset_'+('a'.repeat(64))+'_12345678-1234-1234-1234-123456789abc';
    await world.spawn(imported.manifest.id,{id:longId,position:[10,0,0]});
    expect((await scene.thermalExperiment({operation:'series',targetId:longId})).value.nodes)
      .toHaveLength(2);
    const semantic=world.semantic.state('machine_a','temperatureK',{source:'simulation'});
    expect(semantic).toMatchObject({status:'known',source:'simulation'});
    expect(scene.inspect('machine_a').simulation.nodes[1].id).toBe('left_door');
  }finally{scene.close();world.dispose();}
},90000);
