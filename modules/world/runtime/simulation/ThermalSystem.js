import {
  thermalDefinitions,validateThermalStateForProfile
} from '../../../../foundation/simulation/SimulationProfile.js';

const fail=(code)=>Object.assign(new Error(code),{code});
const MAX_POWER_W=1e9;
const ROOT='root';
const SAMPLE_INTERVAL=0.1;
const MAX_SAMPLES=600;
const clone=structuredClone;

/**
 * An instance owns one or more independent lumped temperature nodes.
 * Declared internal links and solver-observed external body/part contacts
 * exchange energy symmetrically; nothing here claims chemical or phase change.
 */
export class ThermalSystem {
  constructor({physics=null,contactProvider=null,isActive=null}={}) {
    this.physics=physics;
    this.contactProvider=contactProvider;
    this.isActive=isActive||(()=>true);
    this.entries=new Map();
  }

  register(id,definition,{scale=1}={}) {
    if(!definition)return false;
    if(this.entries.has(id))throw fail('THERMAL_ENTITY_CONFLICT');
    const {profile,nodes,links}=thermalDefinitions(definition);
    const entry={
      profile,links,elapsedSec:0,samples:[],
      nodes:new Map(nodes.map(node=>[node.id,{
        ...node,baseMassKg:node.massKg,
        baseHeatCapacityJPerK:node.heatCapacityJPerK,
        temperatureK:node.thermal.initialTemperatureK,
        heatPowerW:node.thermal.heatPowerW
      }]))
    };
    this.entries.set(id,entry);
    try {this.setScale(id,scale);this._record(entry);}
    catch(error){this.entries.delete(id);throw error;}
    return true;
  }

  has(id){return this.entries.has(id);}
  list(){return [...this.entries].map(([id,entry])=>({
    id,model:entry.profile.model,nodeCount:entry.nodes.size,
    temperatureK:entry.nodes.get(ROOT).temperatureK
  }));}
  remove(id){return this.entries.delete(id);}
  clear(){this.entries.clear();}

  _node(id,nodeId=ROOT) {
    const node=this.entries.get(id)?.nodes.get(nodeId);
    if(!node)throw fail(this.entries.has(id)?'THERMAL_NODE_NOT_FOUND':'THERMAL_ENTITY_NOT_FOUND');
    return node;
  }

  assertScale(id,scale) {
    const entry=this.entries.get(id);
    if(!entry)return null;
    const volumeFactor=scale**3;
    const changes=[];
    for(const node of entry.nodes.values()){
      const massKg=node.baseMassKg*volumeFactor;
      const heatCapacityJPerK=node.baseHeatCapacityJPerK*volumeFactor;
      if(!Number.isFinite(massKg)||massKg<=0||!Number.isFinite(heatCapacityJPerK)
        ||heatCapacityJPerK<=0||heatCapacityJPerK>1e18)
        throw fail('THERMAL_SCALE_INVALID');
      changes.push({id:node.id,massKg,heatCapacityJPerK});
    }
    return changes;
  }

  setScale(id,scale) {
    const changes=this.assertScale(id,scale);
    if(!changes)return;
    for(const next of changes)Object.assign(this._node(id,next.id),{
      massKg:next.massKg,heatCapacityJPerK:next.heatCapacityJPerK
    });
  }

  readState(id,nodeId=ROOT){
    const node=this.entries.get(id)?.nodes.get(nodeId);
    if(!node)return null;
    return {
      temperatureK:node.temperatureK,
      internalEnergyJ:node.temperatureK*node.heatCapacityJPerK,
      massKg:node.massKg,
      heatCapacityJPerK:node.heatCapacityJPerK,
      heatPowerW:node.heatPowerW
    };
  }

  inspect(id){
    const entry=this.entries.get(id);
    if(!entry)return null;
    return {
      model:entry.profile.model,evidenceKind:'simulated-lumped-thermal',
      material:clone(entry.nodes.get(ROOT).material),
      state:this.readState(id),
      ...(entry.profile.schemaVersion===2 ? {nodes:[...entry.nodes.values()].map(node=>({
        id:node.id,partName:node.partName,material:clone(node.material),
        state:this.readState(id,node.id)
      })),links:clone(entry.links)} : {})
    };
  }

  setHeatPower(id,powerW,{nodeId=ROOT}={}){
    if(!Number.isFinite(powerW)||Math.abs(powerW)>MAX_POWER_W)
      throw fail('THERMAL_POWER_INVALID');
    this._node(id,nodeId).heatPowerW=powerW;
    this._record(this.entries.get(id));
    return this.readState(id,nodeId);
  }

  capture(id){
    const entry=this.entries.get(id);
    if(!entry)return null;
    if(entry.profile.schemaVersion===1){
      const node=entry.nodes.get(ROOT);
      return {schema:'agentscape.thermal-state',schemaVersion:1,
        temperatureK:node.temperatureK,heatPowerW:node.heatPowerW};
    }
    return {schema:'agentscape.thermal-state',schemaVersion:2,
      nodes:[...entry.nodes.values()].map(node=>({
        id:node.id,temperatureK:node.temperatureK,heatPowerW:node.heatPowerW
      }))};
  }

  validateState(id,state){
    const entry=this.entries.get(id);
    if(!entry)throw fail('THERMAL_ENTITY_NOT_FOUND');
    try{return validateThermalStateForProfile(entry.profile,state);}
    catch(error){throw fail(error.message==='THERMAL_STATE_NODE_MISMATCH'?'THERMAL_STATE_NODE_MISMATCH':'THERMAL_STATE_INVALID');}
  }

  restore(id,state){
    const validated=this.validateState(id,state);
    const entry=this.entries.get(id);
    if(validated.schemaVersion===1){
      Object.assign(entry.nodes.get(ROOT),{
        temperatureK:validated.temperatureK,heatPowerW:validated.heatPowerW
      });
    } else for(const node of validated.nodes){
      Object.assign(entry.nodes.get(node.id),{
        temperatureK:node.temperatureK,heatPowerW:node.heatPowerW
      });
    }
    entry.elapsedSec=0;
    entry.samples=[];
    this._record(entry);
  }

  _record(entry) {
    const latest={
      timeSec:entry.elapsedSec,
      nodes:Object.fromEntries([...entry.nodes.values()].map(node=>[node.id,{
        temperatureK:node.temperatureK,
        internalEnergyJ:node.temperatureK*node.heatCapacityJPerK,
        heatPowerW:node.heatPowerW
      }]))
    };
    if(entry.samples.at(-1)?.timeSec===entry.elapsedSec)entry.samples[entry.samples.length-1]=latest;
    else entry.samples.push(latest);
    if(entry.samples.length>MAX_SAMPLES)entry.samples.shift();
  }

  series(id,{limit=240,nodeId=null}={}){
    const entry=this.entries.get(id);
    if(!entry)throw fail('THERMAL_ENTITY_NOT_FOUND');
    if(!Number.isInteger(limit)||limit<1||limit>MAX_SAMPLES)throw fail('THERMAL_SERIES_LIMIT_INVALID');
    if(nodeId!=null)this._node(id,nodeId);
    const nodes=[...entry.nodes.values()].filter(node=>nodeId==null||node.id===nodeId)
      .map(node=>({id:node.id,partName:node.partName,material:clone(node.material)}));
    const samples=[...entry.samples];
    if(samples.length && samples.at(-1).timeSec<entry.elapsedSec){
      samples.push({timeSec:entry.elapsedSec,
        nodes:Object.fromEntries([...entry.nodes.values()].map(node=>[node.id,{
          temperatureK:node.temperatureK,
          internalEnergyJ:node.temperatureK*node.heatCapacityJPerK,
          heatPowerW:node.heatPowerW
        }]))});
    }
    return {schema:'agentscape.thermal-series',schemaVersion:1,targetId:id,
      model:entry.profile.model,units:{timeSec:'s',temperatureK:'K',internalEnergyJ:'J',heatPowerW:'W'},
      nodes,samples:samples.slice(-limit).map(sample=>({
        timeSec:sample.timeSec,
        nodes:Object.fromEntries(nodes.map(node=>[node.id,clone(sample.nodes[node.id])]))
      }))
    };
  }

  contactPairs(ids) {
    if(this.contactProvider)return this.contactProvider(ids);
    if(this.physics?.contactPartPairs)return this.physics.contactPartPairs(ids);
    return this.physics?.contactObjectPairs?.(ids)||[];
  }

  step(dt){
    if(!Number.isFinite(dt)||dt<0)throw fail('THERMAL_STEP_INVALID');
    if(dt===0||!this.entries.size)return;
    const active=[...this.entries].filter(([id])=>this.isActive(id)).sort(([a],[b])=>a.localeCompare(b));
    if(!active.length)return;
    const values=[],index=new Map(),partIndex=new Map();
    for(const [objectId,entry] of active){
      for(const node of entry.nodes.values()){
        const slot=values.length;
        values.push({objectId,entry,node});
        index.set(objectId+'\u0000'+node.id,slot);
        partIndex.set(objectId+'\u0000'+node.partName,slot);
      }
    }

    const edges=[];
    for(const [objectId,entry] of active){
      for(const link of entry.links)edges.push({
        a:index.get(objectId+'\u0000'+link.from),
        b:index.get(objectId+'\u0000'+link.to),
        g:link.conductanceWPerK
      });
    }

    const contactOwners=new Set(values.filter(({node})=>node.thermal.contactConductanceWPerK>0)
      .map(({objectId})=>objectId));
    if(contactOwners.size>=2){
      const seen=new Set();
      for(const pair of this.contactPairs([...contactOwners])){
        const a=partIndex.get((pair.sourceId||pair.source?.objectId)+'\u0000'+
          (pair.sourcePartName||pair.source?.partName||'$root'));
        const b=partIndex.get((pair.targetId||pair.target?.objectId)+'\u0000'+
          (pair.targetPartName||pair.target?.partName||'$root'));
        if(a==null||b==null||a===b||values[a].objectId===values[b].objectId)continue;
        const key=[Math.min(a,b),Math.max(a,b)].join(':');
        if(seen.has(key))continue;
        seen.add(key);
        const ga=values[a].node.thermal.contactConductanceWPerK;
        const gb=values[b].node.thermal.contactConductanceWPerK;
        if(ga>0&&gb>0)edges.push({a,b,g:ga*gb/(ga+gb)});
      }
    }

    const rates=values.map(({node})=>node.thermal.ambientConductanceWPerK);
    for(const {a,b,g} of edges){rates[a]+=g;rates[b]+=g;}
    const substeps=Math.max(1,Math.ceil(dt*Math.max(...values.map(({node},i)=>
      rates[i]/node.heatCapacityJPerK))/0.25));
    if(substeps>1024)throw fail('THERMAL_STEP_TOO_STIFF');
    const h=dt/substeps;
    let temps=values.map(({node})=>node.temperatureK);
    for(let n=0;n<substeps;n++){
      const q=values.map(({node},i)=>{
        const t=node.thermal;
        return (node.heatPowerW+t.ambientConductanceWPerK*(t.ambientTemperatureK-temps[i]))*h;
      });
      for(const {a,b,g} of edges){
        const dq=g*(temps[b]-temps[a])*h;
        q[a]+=dq;q[b]-=dq;
      }
      const next=temps.map((t,i)=>t+q[i]/values[i].node.heatCapacityJPerK);
      if(next.some(t=>!Number.isFinite(t)||t<0||t>1e6))throw fail('THERMAL_STATE_OUT_OF_RANGE');
      temps=next;
    }
    for(let i=0;i<values.length;i++)values[i].node.temperatureK=temps[i];
    for(const [,entry] of active){
      entry.elapsedSec+=dt;
      if(entry.elapsedSec-(entry.samples.at(-1)?.timeSec??0)>=SAMPLE_INTERVAL-1e-8)
        this._record(entry);
    }
  }
}
