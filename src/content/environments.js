import { createMonumentHall } from './monumentHall.js';
import { createRuinedCourtyard } from './ruinedCourtyard.js';

export const ENVIRONMENTS = Object.freeze([
  Object.freeze({
    id:'monument-hall', number:'WORLD 01', title:'Monument Hall', headline:'Space for intelligence.',
    description:'A monumental 32 × 24 m world where physics, navigation and agent actions share the same reality.',
    facts:['RAPIER PHYSICS','RECAST / DETOUR','AGENT-READY ASSETS'], create:createMonumentHall,
    bootstrap:{ table:[5.2,0,4.2], cabinet:[-5.2,0,3.9], cup:[5.55,1.4,4.2] }
  }),
  Object.freeze({
    id:'ruined-courtyard', number:'WORLD 02', title:'Ruined Courtyard', headline:'Paths through memory.',
    description:'An open-air 36 × 30 m ruin of broken arcades, split-level terraces and reclaimed stone.',
    facts:['SPLIT-LEVEL NAVMESH','PHYSICAL RUINS','CC0 MATERIALS'], create:createRuinedCourtyard,
    bootstrap:{ table:[11.8,1.2,5.1], cabinet:[-11.6,.8,-5.8], cup:[12.1,2.6,5.1] }
  })
]);

const byId = new Map(ENVIRONMENTS.map((value) => [value.id, value]));
export const DEFAULT_ENVIRONMENT = ENVIRONMENTS[0];
export const resolveEnvironment = (id) => byId.get(id) || DEFAULT_ENVIRONMENT;
