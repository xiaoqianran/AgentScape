import {describe,it,expect} from 'vitest';
import {
  simulationProfileSchema,thermalDefinitions,thermalProperties,
  validateThermalStateForProfile
} from '../../foundation/simulation/SimulationProfile.js';
import {ThermalSystem} from '../../modules/world/runtime/simulation/ThermalSystem.js';
import {industrialCabinetDraft,mechanicalDraftSchema} from '../../modules/asset/model/MechanicalAssetDraft.js';
import {validateAssetManifest} from '../../modules/asset/model/schema.js';

const material=(name='test')=>({
  name,densityKgM3:1000,specificHeatJkgK:1000,provenance:'authored'
});
const thermal=(temperatureK=300,contactConductanceWPerK=0)=>({
  mass:{mode:'explicit',massKg:1},initialTemperatureK:temperatureK,
  heatPowerW:0,ambientTemperatureK:293.15,
  ambientConductanceWPerK:0,contactConductanceWPerK
});
const network=(links=[{from:'root',to:'door',conductanceWPerK:100}])=>({
  schema:'agentscape.simulation-profile',schemaVersion:2,
  model:'thermal-network-v1',
  nodes:[
    {id:'root',partName:'$root',material:material('body'),thermal:thermal(350,100)},
    {id:'door',partName:'door',material:material('door'),thermal:thermal(300,100)}
  ],
  links
});

describe('versioned thermal network contracts',()=>{
  it('preserves the v1 single-node model and requires uniquely named v2 part nodes',()=>{
    const legacy={schema:'agentscape.simulation-profile',schemaVersion:1,
      model:'lumped-thermal-v1',material:material(),thermal:thermal()};
    expect(thermalDefinitions(legacy).nodes).toHaveLength(1);
    expect(thermalDefinitions(legacy).nodes[0].id).toBe('root');
    expect(thermalProperties(network()).massKg).toBe(1);
    expect(simulationProfileSchema.safeParse(network()).success).toBe(true);
    const missingRoot=network();missingRoot.nodes[0].id='oops';
    expect(simulationProfileSchema.safeParse(missingRoot).success).toBe(false);
    const repeated=network();repeated.nodes[1].partName='$root';
    expect(simulationProfileSchema.safeParse(repeated).success).toBe(false);
    const missingLink=network();missingLink.links[0].to='unknown';
    expect(simulationProfileSchema.safeParse(missingLink).success).toBe(false);
    const repeatedLinks=network();repeatedLinks.links.push({from:'door',to:'root',conductanceWPerK:4});
    expect(simulationProfileSchema.safeParse(repeatedLinks).success).toBe(false);
  });

  it('rejects imaginary physics parts in both authored drafts and compiled manifests',()=>{
    const draft=industrialCabinetDraft();
    draft.simulation=network();
    expect(mechanicalDraftSchema.safeParse(draft).success).toBe(false);
    draft.simulation.nodes[1].partName='left_door';
    expect(mechanicalDraftSchema.safeParse(draft).success).toBe(true);
    const manifest={id:'machine',type:'machine',label:'machine',
      source:{kind:'builtin'},actions:['move'],
      physics:{body:'fixed',mass:1,friction:.5,colliders:[]},
      simulation:network()};
    expect(()=>validateAssetManifest(manifest)).toThrow('unknown physical part');
  });

  it('rejects snapshots with missing/extra/mismatched thermal nodes',()=>{
    const state={schema:'agentscape.thermal-state',schemaVersion:2,
      nodes:[{id:'root',temperatureK:350,heatPowerW:0},{id:'door',temperatureK:300,heatPowerW:0}]};
    expect(validateThermalStateForProfile(network(),state)).toEqual(state);
    expect(()=>validateThermalStateForProfile(network(),
      {...state,nodes:state.nodes.slice(0,1)})).toThrow('THERMAL_STATE_NODE_MISMATCH');
    expect(()=>validateThermalStateForProfile(network(),
      {...state,nodes:[state.nodes[0],{...state.nodes[1],id:'bogus'}]})).toThrow('THERMAL_STATE_NODE_MISMATCH');
  });
});

describe('multi-node thermal solver',()=>{
  it('balances independent material nodes and conserves total energy on internal links',()=>{
    const system=new ThermalSystem({contactProvider:()=>[]});
    system.register('machine',network());
    const before=system.readState('machine','root').internalEnergyJ+
      system.readState('machine','door').internalEnergyJ;
    system.step(1);
    expect(system.readState('machine','root').temperatureK).toBeLessThan(350);
    expect(system.readState('machine','door').temperatureK).toBeGreaterThan(300);
    const after=system.readState('machine','root').internalEnergyJ+
      system.readState('machine','door').internalEnergyJ;
    expect(after).toBeCloseTo(before,6);
    expect(system.readState('machine').temperatureK).toBe(system.readState('machine','root').temperatureK);
    expect(system.inspect('machine').nodes[1]).toMatchObject({
      id:'door',partName:'door',material:{name:'door'}
    });
  });

  it('uses only a physical contact with matching part provenance',()=>{
    let contacts=[{sourceId:'machine',sourcePartName:'wrong_part',targetId:'block',targetPartName:'$root'}];
    const system=new ThermalSystem({contactProvider:()=>contacts});
    system.register('machine',network([]));
    const single={schema:'agentscape.simulation-profile',schemaVersion:1,
      model:'lumped-thermal-v1',material:material('block'),thermal:thermal(280,100)};
    system.register('block',single);
    system.step(1);
    expect(system.readState('machine','door').temperatureK).toBe(300);
    expect(system.readState('block').temperatureK).toBe(280);
    contacts=[{sourceId:'machine',sourcePartName:'door',targetId:'block',targetPartName:'$root'}];
    system.step(1);
    expect(system.readState('machine','door').temperatureK).toBeLessThan(300);
    expect(system.readState('block').temperatureK).toBeGreaterThan(280);
    expect(system.readState('machine','root').temperatureK).toBe(350);
  });

  it('skips costly physics contact probing when only one thermal object exists',()=>{
    let probes=0,ids=[];
    const system=new ThermalSystem({contactProvider:(objectIds)=>{probes++;ids=objectIds;return [];}});
    system.register('first',network([]));
    system.step(1);
    expect(probes).toBe(0);
    system.register('second',network([]));
    system.step(1);
    expect(probes).toBe(1);
    expect(ids).toEqual(['first','second']);
  });

  it('records bounded time series and restores independent temperatures/power',()=>{
    const system=new ThermalSystem({contactProvider:()=>[]});
    system.register('machine',network([]));
    system.setHeatPower('machine',100,{nodeId:'door'});
    for(let i=0;i<120;i++)system.step(1/60);
    const series=system.series('machine');
    expect(series.nodes.map(n=>n.id)).toEqual(['root','door']);
    expect(series.samples.length).toBeGreaterThan(5);
    expect(series.samples.at(-1).timeSec).toBeCloseTo(2);
    expect(series.samples.at(-1).nodes.door.temperatureK).toBeGreaterThan(300);
    expect(series.samples.at(-1).nodes.root.temperatureK).toBe(350);
    expect(system.series('machine',{nodeId:'door',limit:4}).samples).toHaveLength(4);
    expect(system.series('machine',{nodeId:'door',limit:4}).samples[0].nodes.root).toBeUndefined();
    const external=system.series('machine');
    external.samples[0].nodes.root.temperatureK=-1;
    expect(system.series('machine').samples[0].nodes.root.temperatureK).toBe(350);
    const saved=system.capture('machine');
    system.setHeatPower('machine',0,{nodeId:'door'});
    system.restore('machine',saved);
    expect(system.readState('machine','door').heatPowerW).toBe(100);
    expect(system.readState('machine','root').temperatureK).toBe(350);
    expect(system.series('machine').samples).toHaveLength(1);
    expect(()=>system.setHeatPower('machine',100,{nodeId:'invalid'})).toThrow('THERMAL_NODE_NOT_FOUND');
    expect(()=>system.series('machine',{limit:601})).toThrow('THERMAL_SERIES_LIMIT_INVALID');
  });
});
