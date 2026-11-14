import {it,expect} from 'vitest';
import {createSession} from '../../application/createSession.js';
import {createBlankWorld} from '../../modules/world/content/blankWorld.js';
import {createAssetModule} from '../../modules/asset/AssetModule.js';
import {createHeadlessGLTFLoader} from '../../apps/mcp-server/HeadlessGLTFLoader.js';
import {installHeadlessAssetIO} from '../../apps/mcp-server/HeadlessAssetIO.js';

const profile = ({temperatureK,powerW=0}={})=>({
  schema:'agentscape.simulation-profile',schemaVersion:1,model:'lumped-thermal-v1',
  material:{name:'fabricated-material',densityKgM3:1000,specificHeatJkgK:1000,provenance:'authored'},
  thermal:{mass:{mode:'density-volume',volumeM3:0.001},
    initialTemperatureK:temperatureK,heatPowerW:powerW,
    ambientTemperatureK:293.15,ambientConductanceWPerK:0,
    contactConductanceWPerK:250}
});
const block = ({type,body,temperatureK,powerW=0}={})=>({
  schema:'agentscape.mechanical-draft',schemaVersion:1,
  name:'锻造试验材料',type,body,
  components:[{id:'Block',parent:null,shape:'box',position:[0,0.25,0],
    size:[0.5,0.5,0.5],color:'#d98556',collision:true}],
  motions:[],simulation:profile({temperatureK,powerW})
});

it('compiles thermal assets, simulates independently, and restores heat states',async()=>{
  installHeadlessAssetIO();
  const session=createSession(null,{assetModule:createAssetModule({gltfLoader:createHeadlessGLTFLoader()}),
    environmentFactory:()=>createBlankWorld({id:'asset-forge-thermal-world'})});
  await session.world.init();
  const {scene,world}=session;
  try {
    const hotDraft=block({type:'hot',body:'fixed',temperatureK:350,powerW:100});
    const coldDraft=block({type:'cold',body:'dynamic',temperatureK:293.15});
    const hot=await world.assetModule.importMechanicalDraft(hotDraft);
    const cold=await world.assetModule.importMechanicalDraft(coldDraft);
    expect(hot.manifest.simulation.material.name).toBe('fabricated-material');
    expect(hot.manifest.simulation.thermal.mass.mode).toBe('density-volume');
    expect(hot.manifest.physics.mass).toBe(1);
    expect(cold.manifest.physics.body).toBe('dynamic');
    const ref=id=>'asset://sha256/'+id.slice('asset_'.length);
    await scene.addModel({id:'hot_01',asset:ref(hot.manifest.id),position:[0,0,0]});
    await scene.addModel({id:'cold_01',asset:ref(cold.manifest.id),position:[0.45,0,0]});
    await scene.addModel({id:'cold_02',asset:ref(cold.manifest.id),position:[4,0,0]});
    expect(world.thermal.has('hot_01')).toBe(true);
    expect(world.semantic.state('hot_01','temperatureK',{source:'simulation'})).toMatchObject({
      source:'simulation',status:'known',value:350
    });
    expect(scene.observe().affordances.entities.find(e=>e.id==='hot_01').simulation.state.temperatureK).toBe(350);
    expect(scene.observe({limit:2}).objects.find(e=>e.id==='hot_01')?.simulation?.state.temperatureK).toBe(350);
    expect(scene.inspect('hot_01').simulation).toMatchObject({
      model:'lumped-thermal-v1',evidenceKind:'simulated-lumped-thermal',
      state:{massKg:1,heatCapacityJPerK:1000,temperatureK:350}
    });

    let sawContact=false;
    const firstCold=world.thermal.readState('cold_01').temperatureK;
    for(let i=0;i<240;i++){
      world.stepSimulation(1/60);
      if(i%10===0) {
        const contacts=world.physics.debugSnapshot({nativeGeometry:false,contacts:true}).contacts;
        if(contacts.some(pair=>{
          const a=pair.source?.objectId,b=pair.target?.objectId;
          return (a==='hot_01'&&b==='cold_01')||(a==='cold_01'&&b==='hot_01');
        }))sawContact=true;
      }
    }
    expect(sawContact).toBe(true);
    const after=world.thermal.readState('cold_01');
    expect(after.temperatureK).toBeGreaterThan(firstCold);
    expect(world.thermal.readState('cold_02').temperatureK).toBe(293.15);
    world.applyObjectTransform('cold_02',{scale:2});
    expect(world.thermal.readState('cold_02').massKg).toBe(8);
    expect(world.thermal.readState('hot_01').temperatureK).toBeGreaterThan(293.15);

    const saved=world.serialize();
    const invalid=structuredClone(saved);
    invalid.objects.find(item=>item.id==='cold_01').simulation.temperatureK=-12;
    await expect(world.restore(invalid)).rejects.toThrow('Invalid entity thermal state');
    expect(world.thermal.readState('cold_01').temperatureK).toBe(after.temperatureK);
    const stateBefore=world.thermal.readState('cold_01');
    expect(saved.objects.find(item=>item.id==='cold_01').simulation).toMatchObject({
      schema:'agentscape.thermal-state',temperatureK:stateBefore.temperatureK
    });
    world.thermal.setHeatPower('cold_01',200);
    world.stepSimulation(1/60);
    expect(world.thermal.readState('cold_01').heatPowerW).toBe(200);

    await world.restore(saved);
    expect(world.thermal.readState('cold_01').temperatureK).toBeCloseTo(stateBefore.temperatureK,8);
    expect(world.thermal.readState('cold_01').heatPowerW).toBe(0);
    expect(world.semantic.state('cold_01','internalEnergyJ',{source:'simulation'})).toMatchObject({
      status:'known',source:'simulation'
    });
    expect(world.thermal.readState('cold_02').temperatureK).toBe(293.15);
    expect(world.thermal.readState('cold_02').massKg).toBe(8);
    await scene.remove({id:'cold_01'});
    expect(world.thermal.has('cold_01')).toBe(false);
  }finally{
    scene.close();world.dispose();
  }
},90000);
