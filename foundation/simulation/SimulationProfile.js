import * as z from 'zod/v4';

// Versioned SI contracts shared by Asset admission and World simulation.
// Material conductivity is descriptive metadata; interface conductance is a
// separate, explicitly authored parameter, not a derived physical certainty.
const positive=z.number().finite().positive().max(1e12);
const nonnegative=z.number().finite().min(0).max(1e12);
const temperature=z.number().finite().min(0).max(1e6);
const power=z.number().finite().min(-1e9).max(1e9);
const nodeId=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);

export const materialDefinitionSchema=z.object({
  name:z.string().trim().min(1).max(80),
  densityKgM3:positive,
  specificHeatJkgK:positive,
  conductivityWmK:nonnegative.optional(),
  provenance:z.enum(['authored','ai-estimated','reference']).default('authored')
}).strict();

const mass=z.discriminatedUnion('mode',[
  z.object({mode:z.literal('explicit'),massKg:positive}).strict(),
  z.object({mode:z.literal('density-volume'),volumeM3:positive}).strict()
]);
export const thermalDefinitionSchema=z.object({
  mass,
  initialTemperatureK:temperature.default(293.15),
  heatPowerW:power.default(0),
  ambientTemperatureK:temperature.default(293.15),
  ambientConductanceWPerK:nonnegative.default(0),
  contactConductanceWPerK:nonnegative.default(0)
}).strict();

export const simulationProfileV1Schema=z.object({
  schema:z.literal('agentscape.simulation-profile'),
  schemaVersion:z.literal(1),
  model:z.literal('lumped-thermal-v1'),
  material:materialDefinitionSchema,
  thermal:thermalDefinitionSchema
}).strict();

export const simulationProfileV2Schema=z.object({
  schema:z.literal('agentscape.simulation-profile'),
  schemaVersion:z.literal(2),
  model:z.literal('thermal-network-v1'),
  nodes:z.array(z.object({
    id:nodeId,
    partName:z.union([z.literal('$root'),nodeId]),
    material:materialDefinitionSchema,
    thermal:thermalDefinitionSchema
  }).strict()).min(1).max(32),
  links:z.array(z.object({
    from:nodeId,
    to:nodeId,
    conductanceWPerK:positive
  }).strict()).max(96).default([])
}).strict().superRefine((profile,ctx)=>{
  const ids=new Set(),parts=new Set();
  for(const node of profile.nodes){
    if(ids.has(node.id))ctx.addIssue({code:'custom',message:'Duplicate thermal node ID: '+node.id});
    if(parts.has(node.partName))ctx.addIssue({code:'custom',message:'Thermal nodes must have unique physical part names: '+node.partName});
    if((node.partName==='$root') !== (node.id==='root'))
      ctx.addIssue({code:'custom',message:'The physical root must use id "root" and partName "$root"'});
    ids.add(node.id);parts.add(node.partName);
  }
  if(!ids.has('root'))ctx.addIssue({code:'custom',message:'A root thermal node is required'});
  const edges=new Set();
  for(const link of profile.links){
    if(!ids.has(link.from)||!ids.has(link.to)||link.from===link.to)
      ctx.addIssue({code:'custom',message:'Thermal link references missing or identical nodes'});
    const key=[link.from,link.to].sort().join('|');
    if(edges.has(key))ctx.addIssue({code:'custom',message:'Duplicate thermal link: '+key});
    edges.add(key);
  }
});

export const simulationProfileSchema=z.discriminatedUnion('schemaVersion',[
  simulationProfileV1Schema,simulationProfileV2Schema
]);

const stateTemperature=z.number().finite().min(0).max(1e6);
const v1State=z.object({
  schema:z.literal('agentscape.thermal-state'),schemaVersion:z.literal(1),
  temperatureK:stateTemperature,heatPowerW:power
}).strict();
const v2State=z.object({
  schema:z.literal('agentscape.thermal-state'),schemaVersion:z.literal(2),
  nodes:z.array(z.object({
    id:nodeId,temperatureK:stateTemperature,heatPowerW:power
  }).strict()).min(1).max(32)
}).strict().superRefine((state,ctx)=>{
  if(new Set(state.nodes.map(node=>node.id)).size!==state.nodes.length)
    ctx.addIssue({code:'custom',message:'Duplicate saved thermal node IDs'});
});
export const thermalStateSchema=z.discriminatedUnion('schemaVersion',[v1State,v2State]);

const properties=(material,thermal)=>{
  const massKg=thermal.mass.mode==='explicit' ? thermal.mass.massKg
    : material.densityKgM3*thermal.mass.volumeM3;
  const heatCapacityJPerK=massKg*material.specificHeatJkgK;
  if(!Number.isFinite(massKg)||!Number.isFinite(heatCapacityJPerK)
    ||massKg<=0||heatCapacityJPerK<=0||heatCapacityJPerK>1e18)
    throw Object.assign(new RangeError('Thermal mass or heat capacity is not representable'),{
      code:'SIMULATION_PROFILE_INVALID'
    });
  return {massKg,heatCapacityJPerK};
};

export function thermalDefinitions(input){
  const profile=simulationProfileSchema.parse(input);
  const nodes=profile.schemaVersion===1
    ? [{id:'root',partName:'$root',material:profile.material,thermal:profile.thermal}]
    : profile.nodes;
  return {
    profile,
    nodes:nodes.map(node=>({...node,...properties(node.material,node.thermal)})),
    links:profile.schemaVersion===2 ? profile.links : []
  };
}

export function thermalProperties(input){
  const {profile,nodes}=thermalDefinitions(input);
  const root=nodes.find(node=>node.id==='root');
  return {profile,massKg:root.massKg,heatCapacityJPerK:root.heatCapacityJPerK};
}

export function validateSimulationProfile(input){
  if(input == null)return null;
  return thermalDefinitions(input).profile;
}

export function validateThermalStateForProfile(profileInput,stateInput) {
  const {profile,nodes}=thermalDefinitions(profileInput);
  const state=thermalStateSchema.parse(stateInput);
  if(state.schemaVersion!==profile.schemaVersion)
    throw new Error('THERMAL_STATE_VERSION_MISMATCH');
  if(state.schemaVersion===2){
    const expected=new Set(nodes.map(node=>node.id));
    if(state.nodes.length!==expected.size
      ||state.nodes.some(node=>!expected.delete(node.id)))
      throw new Error('THERMAL_STATE_NODE_MISMATCH');
  }
  return state;
}
