import * as z from 'zod/v4';

// SI units only; these are declared model parameters, not measured material facts.
const positive = z.number().finite().positive().max(1e12);
const nonnegative = z.number().finite().min(0).max(1e12);
const temperature = z.number().finite().min(0).max(1e6);

export const materialDefinitionSchema = z.object({
  name:z.string().trim().min(1).max(80),
  densityKgM3:positive,
  specificHeatJkgK:positive,
  conductivityWmK:nonnegative.optional(),
  provenance:z.enum(['authored','ai-estimated','reference']).default('authored')
}).strict();

const mass = z.discriminatedUnion('mode', [
  z.object({mode:z.literal('explicit'),massKg:positive}).strict(),
  z.object({mode:z.literal('density-volume'),volumeM3:positive}).strict()
]);

export const simulationProfileSchema = z.object({
  schema:z.literal('agentscape.simulation-profile'),
  schemaVersion:z.literal(1),
  model:z.literal('lumped-thermal-v1'),
  material:materialDefinitionSchema,
  thermal:z.object({
    mass,
    initialTemperatureK:temperature.default(293.15),
    heatPowerW:z.number().finite().min(-1e9).max(1e9).default(0),
    ambientTemperatureK:temperature.default(293.15),
    ambientConductanceWPerK:nonnegative.default(0),
    contactConductanceWPerK:nonnegative.default(0)
  }).strict()
}).strict();

export function thermalProperties(input) {
  const profile=simulationProfileSchema.parse(input);
  const massKg=profile.thermal.mass.mode==='explicit'
    ? profile.thermal.mass.massKg
    : profile.material.densityKgM3 * profile.thermal.mass.volumeM3;
  const heatCapacityJPerK=massKg * profile.material.specificHeatJkgK;
  if(!Number.isFinite(massKg) || !Number.isFinite(heatCapacityJPerK)
    || massKg<=0 || heatCapacityJPerK<=0 || heatCapacityJPerK>1e18) {
    throw Object.assign(new RangeError('Thermal mass or heat capacity is not representable'),{
      code:'SIMULATION_PROFILE_INVALID'
    });
  }
  return {profile,massKg,heatCapacityJPerK};
}

export function validateSimulationProfile(input) {
  if(input == null) return null;
  return thermalProperties(input).profile;
}
