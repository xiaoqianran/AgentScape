import { thermalProperties } from '../../../../foundation/simulation/SimulationProfile.js';

const fail=(code,message=code)=>Object.assign(new Error(message),{code});
const MAX_POWER_W=1e9;
const clone=structuredClone;

/**
 * Independent per-instance lumped thermal model (zero Kelvin is the energy
 * reference). Physics contact authorizes energy transfer; it does not set an
 * arbitrary "isHot" semantic property. No phase changes or chemistry are claimed.
 */
export class ThermalSystem {
  constructor({physics=null,contactProvider=null,isActive=null}={}) {
    this.physics=physics;
    this.contactProvider=contactProvider;
    this.isActive=isActive || (()=>true);
    this.entries=new Map();
  }

  register(id,definition,{scale=1}={}) {
    if(!definition) return false;
    if(this.entries.has(id)) throw fail('THERMAL_ENTITY_CONFLICT');
    const {profile,massKg,heatCapacityJPerK}=thermalProperties(definition);
    this.entries.set(id,{
      profile,baseMassKg:massKg,baseHeatCapacityJPerK:heatCapacityJPerK,
      massKg,heatCapacityJPerK,
      temperatureK:profile.thermal.initialTemperatureK,
      heatPowerW:profile.thermal.heatPowerW
    });
    try { this.setScale(id,scale); }
    catch(error) { this.entries.delete(id); throw error; }
    return true;
  }

  assertScale(id,scale) {
    const entry=this.entries.get(id);
    if(!entry)return null;
    const massKg=entry.baseMassKg*scale**3;
    const heatCapacityJPerK=entry.baseHeatCapacityJPerK*scale**3;
    if(!Number.isFinite(massKg)||massKg<=0||!Number.isFinite(heatCapacityJPerK)
      ||heatCapacityJPerK<=0||heatCapacityJPerK>1e18)throw fail('THERMAL_SCALE_INVALID');
    return {massKg,heatCapacityJPerK};
  }

  setScale(id,scale) {
    const properties=this.assertScale(id,scale);
    if(properties)Object.assign(this.entries.get(id),properties);
  }

  has(id) { return this.entries.has(id); }
  remove(id) { return this.entries.delete(id); }
  clear() { this.entries.clear(); }

  readState(id) {
    const entry=this.entries.get(id);
    if(!entry)return null;
    return {
      temperatureK:entry.temperatureK,
      internalEnergyJ:entry.temperatureK*entry.heatCapacityJPerK,
      massKg:entry.massKg,
      heatCapacityJPerK:entry.heatCapacityJPerK,
      heatPowerW:entry.heatPowerW
    };
  }

  inspect(id) {
    const entry=this.entries.get(id);
    return entry ? {
      model:entry.profile.model,
      evidenceKind:'simulated-lumped-thermal',
      material:clone(entry.profile.material),
      state:this.readState(id)
    } : null;
  }

  setHeatPower(id,powerW) {
    const entry=this.entries.get(id);
    if(!entry) throw fail('THERMAL_ENTITY_NOT_FOUND');
    if(!Number.isFinite(powerW)||Math.abs(powerW)>MAX_POWER_W)throw fail('THERMAL_POWER_INVALID');
    entry.heatPowerW=powerW;
    return this.readState(id);
  }

  capture(id) {
    const entry=this.entries.get(id);
    return entry ? {
      schema:'agentscape.thermal-state',schemaVersion:1,
      temperatureK:entry.temperatureK,heatPowerW:entry.heatPowerW
    } : null;
  }

  validateState(id,state) {
    const entry=this.entries.get(id);
    if(!entry) throw fail('THERMAL_ENTITY_NOT_FOUND');
    if(!state||state.schema!=='agentscape.thermal-state'||state.schemaVersion!==1
      || Object.keys(state).some(key=>!['schema','schemaVersion','temperatureK','heatPowerW'].includes(key))
      || !Number.isFinite(state.temperatureK)||state.temperatureK<0||state.temperatureK>1e6
      || !Number.isFinite(state.heatPowerW)||Math.abs(state.heatPowerW)>MAX_POWER_W) {
      throw fail('THERMAL_STATE_INVALID');
    }
    return {temperatureK:state.temperatureK,heatPowerW:state.heatPowerW};
  }

  restore(id,state) {
    const validated=this.validateState(id,state);
    Object.assign(this.entries.get(id),validated);
  }

  contactPairs() {
    if(this.contactProvider)return this.contactProvider();
    // Only invoked when >=2 entries request contact transfer.
    return this.physics?.contactObjectPairs?.([...this.entries.keys()]) || [];
  }

  step(dt) {
    if(!Number.isFinite(dt)||dt<0)throw fail('THERMAL_STEP_INVALID');
    if(dt===0||!this.entries.size)return;
    const ids=[...this.entries.keys()].filter(id=>this.isActive(id)).sort();
    if(!ids.length)return;
    const values=ids.map(id=>this.entries.get(id));
    const index=new Map(ids.map((id,i)=>[id,i]));
    const edges=[];
    if(values.filter(entry=>entry.profile.thermal.contactConductanceWPerK>0).length>=2){
      const seen=new Set();
      for(const pair of this.contactPairs()) {
        const a=pair.sourceId ? index.get(pair.sourceId)
          : pair.source?.kind==='object' ? index.get(pair.source.objectId) : undefined;
        const b=pair.targetId ? index.get(pair.targetId)
          : pair.target?.kind==='object' ? index.get(pair.target.objectId) : undefined;
        if(a==null||b==null||a===b)continue;
        const key=[Math.min(a,b),Math.max(a,b)].join(':');
        if(seen.has(key))continue;
        seen.add(key);
        const ga=values[a].profile.thermal.contactConductanceWPerK;
        const gb=values[b].profile.thermal.contactConductanceWPerK;
        if(ga>0&&gb>0)edges.push({a,b,g:ga*gb/(ga+gb)});
      }
    }

    const rates=values.map(entry=>entry.profile.thermal.ambientConductanceWPerK);
    for(const {a,b,g} of edges){rates[a]+=g;rates[b]+=g;}
    const substeps=Math.max(1,Math.ceil(dt*Math.max(...values.map((entry,i)=>rates[i]/entry.heatCapacityJPerK))/0.25));
    if(substeps>1024) throw fail('THERMAL_STEP_TOO_STIFF');
    const h=dt/substeps;
    let temps=values.map(entry=>entry.temperatureK);
    for(let n=0;n<substeps;n++){
      const q=values.map((entry,i)=>{
        const t=entry.profile.thermal;
        return (entry.heatPowerW+t.ambientConductanceWPerK*(t.ambientTemperatureK-temps[i]))*h;
      });
      for(const {a,b,g} of edges) {
        const dq=g*(temps[b]-temps[a])*h;
        q[a]+=dq;
        q[b]-=dq;
      }
      const next=temps.map((t,i)=>t+q[i]/values[i].heatCapacityJPerK);
      if(next.some(t=>!Number.isFinite(t)||t<0||t>1e6))throw fail('THERMAL_STATE_OUT_OF_RANGE');
      temps=next;
    }
    for(let i=0;i<values.length;i++)values[i].temperatureK=temps[i];
  }
}
