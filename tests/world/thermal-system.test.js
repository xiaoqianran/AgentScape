import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {simulationProfileSchema,thermalProperties} from '../../foundation/simulation/SimulationProfile.js';
import {ThermalSystem} from '../../modules/world/runtime/simulation/ThermalSystem.js';
import {industrialCabinetDraft,mechanicalDraftToManifest,mechanicalDraftSchema} from '../../modules/asset/model/MechanicalAssetDraft.js';

function profile({density=1000,capacity=1000,massKg=1,volumeM3=null,temperatureK=293.15,
  powerW=0,ambientTemperatureK=293.15,ambientConductance=0,contactConductance=0}={}) {
  return {
    schema:'agentscape.simulation-profile',schemaVersion:1,model:'lumped-thermal-v1',
    material:{name:'declared-test-material',densityKgM3:density,specificHeatJkgK:capacity,
      conductivityWmK:1,provenance:'authored'},
    thermal:{mass:volumeM3 == null ? {mode:'explicit',massKg} : {mode:'density-volume',volumeM3},
      initialTemperatureK:temperatureK,heatPowerW:powerW,ambientTemperatureK,
      ambientConductanceWPerK:ambientConductance,contactConductanceWPerK:contactConductance}
  };
}

describe('thermal simulation profile',()=>{
  it('calculates density-derived mass with SI units and rejects inconsistent values',()=>{
    const properties=thermalProperties(profile({volumeM3:0.001,density:8960,capacity:385}));
    expect(properties.massKg).toBeCloseTo(8.96,12);
    expect(properties.heatCapacityJPerK).toBeCloseTo(3449.6,10);
    for(const invalid of [
      {material:{densityKgM3:0}},
      {material:{specificHeatJkgK:-1}},
      {thermal:{initialTemperatureK:-10}},
      {thermal:{mass:{mode:'density-volume',volumeM3:0}}},
      {thermal:{heatPowerW:Infinity}},
      {thermal:{bogus:true}}
    ]) {
      const input=profile();
      for(const [key,value] of Object.entries(invalid))Object.assign(input[key],value);
      expect(simulationProfileSchema.safeParse(input).success).toBe(false);
    }
    expect(()=>thermalProperties(profile({density:1e12,volumeM3:1e12,capacity:1e12}))).toThrow('not representable');
  });

  it('accepts the publishable Asset Forge example without guessing volumes',()=>{
    const draft=JSON.parse(readFileSync('examples/asset-forge/thermal-block.json','utf8'));
    expect(mechanicalDraftSchema.safeParse(draft).success).toBe(true);
    const manifest=mechanicalDraftToManifest(draft);
    expect(manifest.physics.body).toBe('dynamic');
    expect(manifest.physics.mass).toBeCloseTo(8.96);
    expect(thermalProperties(manifest.simulation).heatCapacityJPerK).toBeCloseTo(3449.6);
  });

  it('preserves a thermal model in an authored mechanical asset, without changing legacy drafts',()=>{
    const draft=industrialCabinetDraft();
    expect(mechanicalDraftSchema.parse(draft).simulation).toBeUndefined();
    expect(mechanicalDraftSchema.parse(draft)).not.toHaveProperty('body');
    expect(mechanicalDraftToManifest(draft).simulation).toBeUndefined();
    draft.simulation=profile({massKg:20,temperatureK:300});
    const manifest=mechanicalDraftToManifest(draft);
    expect(manifest.simulation).toEqual(draft.simulation);
    expect(manifest.physics.mass).toBe(1); // articulated bodies own separate masses
  });
});

describe('ThermalSystem',()=>{
  it('applies declared power and ambient exchange in Joules without claiming physical measurement',()=>{
    const thermal=new ThermalSystem();
    expect(thermal.register('heater',profile({powerW:1000}))).toBe(true);
    thermal.step(1);
    expect(thermal.readState('heater').temperatureK).toBeCloseTo(294.15,8);
    expect(thermal.inspect('heater').evidenceKind).toBe('simulated-lumped-thermal');
    const snapshot=thermal.capture('heater');
    thermal.setHeatPower('heater',0);
    thermal.step(1);
    expect(thermal.readState('heater').temperatureK).toBeCloseTo(294.15,8);
    thermal.restore('heater',snapshot);
    expect(thermal.readState('heater').heatPowerW).toBe(1000);
    expect(()=>thermal.restore('heater',{...snapshot,temperatureK:-1})).toThrow('THERMAL_STATE_INVALID');
    expect(thermal.readState('heater').temperatureK).toBeCloseTo(294.15,8);
  });

  it('only transfers heat between verified contacting bodies, conserving thermal energy',()=>{
    let contacts=[];
    const thermal=new ThermalSystem({contactProvider:()=>contacts});
    thermal.register('hot',profile({temperatureK:350,contactConductance:200}));
    thermal.register('cold',profile({temperatureK:300,contactConductance:200}));
    const energyBefore=thermal.readState('hot').internalEnergyJ+thermal.readState('cold').internalEnergyJ;
    thermal.step(1);
    expect(thermal.readState('hot').temperatureK).toBe(350);
    expect(thermal.readState('cold').temperatureK).toBe(300);
    contacts=[{source:{kind:'object',objectId:'hot'},target:{kind:'object',objectId:'cold'}}];
    thermal.step(1);
    expect(thermal.readState('hot').temperatureK).toBeLessThan(350);
    expect(thermal.readState('cold').temperatureK).toBeGreaterThan(300);
    const energyAfter=thermal.readState('hot').internalEnergyJ+thermal.readState('cold').internalEnergyJ;
    expect(energyAfter).toBeCloseTo(energyBefore,7);
    // Colliders can have multiple contacts; they still form one thermal link.
    const both=new ThermalSystem({contactProvider:()=>[...contacts,...contacts]});
    both.register('hot',profile({temperatureK:350,contactConductance:200}));
    both.register('cold',profile({temperatureK:300,contactConductance:200}));
    both.step(1);
    expect(both.readState('hot').temperatureK).toBeCloseTo(thermal.readState('hot').temperatureK,10);
  });

  it('scales heat capacity with volume and suspends dormant entities',()=>{
    const active=new Set(['a','b']);
    const thermal=new ThermalSystem({isActive:id=>active.has(id)});
    thermal.register('a',profile({massKg:2,powerW:2000}),{scale:2});
    thermal.register('b',profile({powerW:1000}));
    expect(thermal.readState('a').massKg).toBe(16);
    expect(thermal.readState('a').heatCapacityJPerK).toBe(16000);
    active.delete('a');
    thermal.step(1);
    expect(thermal.readState('a').temperatureK).toBe(293.15);
    expect(thermal.readState('b').temperatureK).toBe(294.15);
    active.add('a');
    thermal.step(1);
    expect(thermal.readState('a').temperatureK).toBeCloseTo(293.275);
    thermal.setScale('a',1);
    expect(thermal.readState('a').massKg).toBe(2);
    expect(thermal.readState('a').temperatureK).toBeCloseTo(293.275);
  });

  it('isolates instances, rejects unstable steps before mutation and never invents contact',()=>{
    const thermal=new ThermalSystem({contactProvider:()=>[]});
    thermal.register('a',profile({powerW:1000}));
    thermal.register('b',profile({powerW:0}));
    thermal.step(1);
    expect(thermal.readState('b').temperatureK).toBe(293.15);
    expect(thermal.readState('a').temperatureK).toBe(294.15);
    const hot=profile({capacity:0.001,ambientConductance:1e9});
    thermal.register('stiff',hot);
    const before=thermal.capture('a');
    expect(()=>thermal.step(1)).toThrow('THERMAL_STEP_TOO_STIFF');
    expect(thermal.capture('a')).toEqual(before);
    expect(()=>thermal.setHeatPower('b',Infinity)).toThrow('THERMAL_POWER_INVALID');
    expect(thermal.remove('b')).toBe(true);
    expect(thermal.readState('b')).toBeNull();
  });
});
